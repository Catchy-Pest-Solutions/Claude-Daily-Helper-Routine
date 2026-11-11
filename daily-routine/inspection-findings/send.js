#!/usr/bin/env node
// Steps 4-8 of the inspection findings routine (ROUTINE_PROMPT.md).
//
//   node send.js --posts $S/posts.json --decisions $S/decisions.json [--preview] [--no-sheet]
//
// For each decision:
//   quote          one email and one text per customer, sent right away
//                  (the routine runs at 9 AM; Textable's sendAt sent
//                  texts early on Nov 11, so nothing is scheduled), two
//                  [INSPECTION FINDINGS] entries on the customer's
//                  Communications tab (the PDF on the email entry), a
//                  BID_FOLLOWUP task, and a Leads sheet row.
//   bat quote      (plan "bat", Daniel hasn't approved it yet): a draft.
//                  Nothing to the customer, Briostack or Steve; the
//                  draft message for Daniel goes in $S/bat-drafts.json
//                  for the routine to post in the post's thread, and the
//                  sheet row is "waiting" until he replies "approve".
//   commercial     task to price it (no message to the customer), sheet row
//                  (the tech still earns the bonus).
//   custom_quote   same, for a custom job on a customer we'd otherwise
//                  skip (bats on a Critter Control customer: bats aren't
//                  covered); the tech earns the bonus.
//   quote_request  task for the office to quote it, sheet row ($2 bonus).
//   skip / ask     sheet row only ("didn't count" / "waiting"); the routine
//                  sends the tech's note in Slack itself.
// Re-running is safe: a lead whose key ("Lead: <ts>:<plan>") is already on
// the customer's Communications tab is skipped ("already_sent").
//
// Test mode (config.json "testMode": true, the default): every text goes to
// testPhone with "TEST for <name> (<numbers>):" on top, every email to
// testEmail with "[TEST for <name>]" before the subject, tasks go to
// testTaskAssignee (Daniel W) instead of Steve B, log entries start
// "[INSPECTION FINDINGS — TEST, not sent to customer]", and rows go to the
// test sheet. --preview writes the messages next to decisions.json and
// sends, logs and creates nothing. --resend (test mode only) skips the
// duplicate check so a test can go out again.
//
// Prints one JSON line: {"results": [{key, action, text, email, log, task, sheet}], "testMode": ...}
require('../lead-followup/lib/proxy');
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('../lead-followup/lib/env');
const { renderString, escapeHtml } = require('../lead-followup/lib/template');
const google = require('../lead-followup/lib/google');
const { createBriostack } = require('../lead-followup/lib/briostack');
const { createLogEntry, findUnknownContactMethod } = require('../lead-followup/send');
const cal = require('../src/callReview/calendar');
const { normalizePhone, formatPhone } = require('../src/callReview/callAnalysis');
const { loadConfig, LOG_PREFIX, TEST_LOG_PREFIX } = require('./lib/common');
const Q = require('./lib/quote');
const sheet = require('./lib/sheet');

const LOGO = path.join(__dirname, '..', 'lead-followup', 'assets', 'logo-email.png');
const TEXTABLE = 'https://atscall-txb.textable.app/api/send';
const fill = (name, data) => renderString(fs.readFileSync(path.join(__dirname, 'templates', name), 'utf8'), [data]);
const para = (s) => escapeHtml(String(s).trim()).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}" style="color:#11960B;">${u}</a>`).replace(/\n/g, '<br>');

function envAny(...names) {
  const wanted = names.map((n) => n.toLowerCase());
  const key = Object.keys(process.env).find((k) => wanted.includes(k.toLowerCase()) && String(process.env[k]).trim());
  return key ? String(process.env[key]).trim() : null;
}

async function sendText({ to, message, mediaUrl, sendAtMs, from }) {
  const uid = envAny('TEXTABLE_USER_ID', 'TEXTABLE_ACCOUNT_UID');
  const token = envAny('TEXTABLE_API_TOKEN', 'TEXTABLE_TOKEN');
  const auth = uid && token ? { Authorization: `Bearer ${uid}:${token}` } : {};
  const body = { to, from, message, ...([].concat(mediaUrl || []).filter(Boolean).length ? { media: [].concat(mediaUrl).filter(Boolean) } : {}), ...(sendAtMs ? { sendAt: sendAtMs } : {}) };
  let res;
  try {
    res = await fetch(TEXTABLE, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (err) {
    return `failed: no response from Textable (it may have gone through): ${err.message}`;
  }
  const j = await res.json().catch(() => ({}));
  if (res.status === 451) return 'opted_out';
  if (res.ok && j.status === true) return sendAtMs ? 'scheduled' : 'sent';
  return `failed: Textable ${res.status} ${String(j.message || j.error || '').slice(0, 120)}`.trim();
}

// 10 AM Eastern today, or null (send now) once that's past.
function textSendAt(nowMs, config) {
  const at = cal.easternToMs(cal.toEastern(nowMs).date, config.textSendTime || '10:00');
  return at > nowMs + 60000 ? at : null;
}

// 1 PM Eastern the day the quote goes out; Saturday (and any non-business
// day) moves to the next business day unless the office works Saturdays.
function taskDue(nowMs, config) {
  const today = cal.toEastern(nowMs).date;
  const sat = cal.weekdayOf(today) === 6;
  const day = cal.isBusinessDay(today) || (sat && config.officeWorksSaturday) ? today : cal.nextBusinessDay(today);
  return cal.easternIso(cal.easternToMs(day, config.taskDueTime || '13:00'));
}

function textNumbers(post) {
  const seen = new Set();
  return (post.customer?.phones || []).map((p) => normalizePhone(p.number)).filter((n) => n && !seen.has(n) && seen.add(n)).slice(0, 2);
}

// One email for all of a customer's quotes: the primary decision's intro
// and closing around one section per quote (parts: [{ decision, model,
// photos: [{ cid, caption }], infographicCid }]). A single quote reads
// exactly like before; with two or more each section gets a numbered
// heading and its own example picture and video.
function emailHtml({ intro, closing, parts, subject, config }) {
  const multi = parts.length > 1;
  const quotes = parts.map((p, i) => ({
    ...p.model,
    multi,
    number: i + 1,
    headline: p.decision.headline,
    fixTitle: multi ? `The fix: ${p.model.planName}` : 'The fix',
    photos: p.photos,
    body: (p.decision.email.body || []).map(para),
    why: p.decision.why || [],
    hasWhy: (p.decision.why || []).length > 0,
    infographic: p.infographicCid ? { infographicCid: p.infographicCid } : null,
  }));
  return fill('email.html', {
    subject,
    logoCid: 'catchy-logo',
    intro: (intro || []).map(para),
    quotes,
    single: multi ? null : quotes[0],
    closing: (closing || []).map(para),
    company: config.company,
    officePhone: config.officePhone,
    officePhoneDigits: `+1${normalizePhone(config.officePhone)}`,
  });
}

function emailPlain({ intro, closing, parts }) {
  const multi = parts.length > 1;
  return [
    ...(intro || []),
    ...parts.flatMap(({ decision, model }, i) => [
      ...(multi ? [`${i + 1}. ${decision.headline}`] : []),
      ...(decision.email.body || []),
      ...(decision.why?.length ? ['Why it matters:', ...decision.why.map((w) => `- ${w}`)] : []),
      `The fix: ${model.fixLine}${model.credit ? ` Includes your ${model.credit} ${model.creditLabel}, good through ${model.creditExpiresLong}.` : ''}`,
      ...(model.coversDetails.length ? ['How we fix it:', ...model.coversDetails] : []),
      ...model.finePrint,
      model.detailsLine,
    ]),
    ...(closing || []),
    ...parts.map(({ model }) => `Short video about ${model.planName}: ${model.video}`),
  ].join('\n\n');
}

function logBody({ prefix, kind, key, model, post, status, recipient, whenMs, sendAtMs, message, subject, pdfUrl, today, alsoLinks = [], together = [] }) {
  const when = status === 'scheduled' && sendAtMs ? `scheduled for ${cal.formatDay(sendAtMs)} ${cal.formatTime(sendAtMs)}` : `${cal.formatDay(whenMs)} ${cal.formatTime(whenMs)}`;
  return [
    `${prefix} ${kind} ${status}${prefix === TEST_LOG_PREFIX && ['sent', 'scheduled'].includes(status) ? ` to the test ${kind === 'Text' ? 'phone' : 'inbox'} only` : ''}`,
    `Customer ${prefix === TEST_LOG_PREFIX ? 'contact' : 'to'}: ${recipient}`,
    `When: ${when}`,
    ...(together.length ? [`Sent in the same ${kind.toLowerCase()} as: ${together.join(', ')}`] : []),
    `Found by: ${post.tech?.name || model.techName} (Slack post ${post.link}${alsoLinks.length ? `, also ${alsoLinks.join(', ')}` : ''})`,
    `Plan: ${model.planName}${model.exclusion === false ? ' (no exclusion)' : model.exclusion ? ' (with exclusion)' : ''}`,
    `Plan key: ${model.plan}`,
    `Price: ${model.initial} initial (12-month plan), then ${model.monthly} a month. No annual commitment: ${model.noAnnualInitial}.`,
    `Credit: ${model.credit || 'none'}${model.credit ? ` (${model.price.reason})` : ''}`,
    `Credit good through: ${model.creditExpiresYmd}`,
    `Quote date: ${today}`,
    `Lead: ${key}`,
    `Quote PDF: ${pdfUrl || 'none'}`,
    ...(subject ? [`Subject: ${subject}`] : []),
    '',
    'Message:',
    message,
  ].join('\n');
}

// The Briostack task the office reads before calling: short lines, the
// customer ID first (to paste into Briostack search), only what the call
// needs.
function taskBlocks({ decision, post, model, results, action, sentAtMs }) {
  const name = [post.customer?.firstName, post.customer?.lastName].filter(Boolean).join(' ');
  const phones = (post.customer?.phones || []).map((p) => formatPhone(normalizePhone(p.number))).filter(Boolean);
  const sentences = (decision.found || [post.text]).join(' ').split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
  const visitDay = model ? `${model.visitDay.slice(0, 3)}, ${Q.shortDate(model.visitDate)}` : Q.shortDate(post.visit?.date || post.postDate);
  const blocks = [
    [`Customer ID: ${post.customer?.id || post.customerIdPosted}`, name, ...phones],
    [model?.request ? `Asked ${post.tech?.name || 'the tech'} for a quote on ${visitDay}:` : `Found by ${post.tech?.name || 'the tech'} on ${visitDay}:`, ...sentences],
  ];
  const notes = String(decision.customerNotes || '').split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  if (notes.length) blocks.push(['Customer notes:', ...notes]);
  if (String(decision.officeAlert || '').trim()) blocks.push(['Custom quote needed:', String(decision.officeAlert).trim()]);
  if (action === 'quote') {
    blocks.push(
      [
        'Quote:',
        `${model.planName}${model.exclusion === false ? ' (no exclusion)' : model.exclusion ? ' (with exclusion)' : ''}`,
        `${model.initial} to start, then ${model.monthly} a month.`,
        `No annual commitment: ${model.noAnnualInitial} to start.`,
      ],
      model.credit ? [`Credit: ${model.credit}, good through ${model.creditExpires}.`, `(${model.creditReasonOffice[0].toUpperCase()}${model.creditReasonOffice.slice(1)}.)`] : ['No credit on this one.'],
      [
        'Sent:',
        `Email: ${results.email === 'sent' ? cal.formatTime(sentAtMs) : results.email}.`,
        `Text: ${['sent', 'scheduled'].includes(results.text) ? cal.formatTime(results.textAtMs || sentAtMs) : results.text}.`,
      ],
      ['Next:', '1. Check for a YES reply first.', '2. Call to close it.', '3. Note what happened here and close the task.'],
    );
  } else if (action === 'custom_quote') {
    blocks.push(['Custom quote: no automatic price.', 'Nothing was sent to the customer.'], ['Next:', '1. Price it (see the Slack post and photos).', '2. Call the customer.', '3. Note what happened here and close the task.']);
  } else if (action === 'commercial') {
    blocks.push(['Business: no automatic price.', 'Nothing was sent to the customer.'], ['Next:', '1. Price it.', '2. Call the customer.', '3. Note what happened here and close the task.']);
  } else {
    blocks.push([`They asked about: ${decision.request || 'see above'}.`, 'Nothing was sent to the customer.'], ['Next:', '1. Call and quote it.', '2. Note what happened here and close the task.']);
  }
  return blocks;
}

const joinBlocks = (blocks) => blocks.map((b) => b.join('\n')).join('\n\n');

function taskDescription(item) {
  return joinBlocks(taskBlocks(item));
}

// What a task is about, for its title: "TermiteShield quote".
function taskLabel({ decision, model }) {
  if (decision.action === 'quote') return `${model.planName} quote`;
  return { commercial: 'business to price', custom_quote: 'custom quote' }[decision.action] || 'quote request';
}

// One Briostack task per customer (Daniel, Nov 11): everything the run
// found or quoted for that customer, under one header and one "Next".
function groupTask(items, { test }) {
  const name = items[0].model?.customerName || [items[0].post.customer?.firstName, items[0].post.customer?.lastName].filter(Boolean).join(' ');
  const t = test ? 'TEST ' : '';
  if (items.length === 1) {
    const { decision: d } = items[0];
    const title = d.action === 'quote'
      ? `${t}Inspection finding: ${items[0].model.planName} quote — ${name}`
      : `${t}${{ commercial: 'Price inspection finding (business)', custom_quote: 'Custom quote needed (inspection finding)' }[d.action] || 'Quote request from tech'} — ${name}`;
    return { title, description: taskDescription(items[0]) };
  }
  const all = items.map((it) => taskBlocks(it));
  const nextOf = (blocks) => blocks.find((b) => b[0] === 'Next:');
  const quoted = items.findIndex((it) => it.decision.action === 'quote');
  const next = nextOf(all[quoted >= 0 ? quoted : 0]);
  const blocks = [all[0][0]];
  items.forEach((it, i) => {
    const body = all[i].slice(1).filter((b) => b !== nextOf(all[i]));
    body[0] = [`${i + 1}. ${taskLabel(it)[0].toUpperCase()}${taskLabel(it).slice(1)}`, ...body[0]];
    blocks.push(...body);
  });
  const names = items.filter((it) => it.decision.action === 'quote').map((it) => it.model.planName);
  if (names.length > 1) blocks.push([`Sent as one text and one email with ${names.length} quotes.`]);
  blocks.push(next);
  return { title: `${t}Inspection findings: ${items.map(taskLabel).join(' + ')} — ${name}`, description: joinBlocks(blocks) };
}

// The Slack reply (in the bat post's thread) that shows Daniel a bat quote
// before it goes out. He answers in the thread: "approve" sends it at this
// price, "approve $1,795" at his price; anything else is a change to make.
function batDraftMessage({ decision, post, model, rend, config }) {
  const b = decision.bat || {};
  return [
    `*Bat quote draft for ${model.customerName} #${post.customer.id}* (${post.tech?.name || 'tech'}, ${model.visitDay.slice(0, 3)} ${Q.shortDate(model.visitDate)}). Nothing has gone to the customer yet.`,
    `*Price: ${model.initial}* (shown as ${Q.money(model.price.regularInitial)} minus the ${model.credit} ${model.creditLabel})`,
    `How: ${model.bat.steps.join('; ')}.`,
    `Home: ${b.stories}-story, about ${Number(b.sqft).toLocaleString('en-US')} sq ft (${b.sqftSource}); ${b.exterior}${b.attic ? `; attic: ${b.attic}` : ''}.`,
    `Quote card: ${rend?.cardUrl || 'not uploaded'}`,
    `Quote PDF: ${rend?.pdfUrl || 'not uploaded'}`,
    `Text: "${String(decision.text?.body || '').trim()}"`,
    '',
    `Reply *approve* to send it at ${model.initial}, or *approve $1,795* (your price) to change it. Anything else: tell me what to fix and I'll send a new draft.`,
  ].join('\n');
}

// The sheet's Post ID always has a ":" so Google Sheets keeps it as text:
// a bare Slack ts ("1794243334.617239") is read as a number and rounded,
// and collect.js would no longer see the post as handled.
const sheetPostId = (decision) => {
  const key = Q.leadKey(decision);
  return key.includes(':') ? key : `${key}:none`;
};

function sheetRow({ decision, post, model, status, counted, reason, bonus, config }) {
  const finding = (k) => config.findings.find((f) => f.key === k);
  const labels = (decision.findings || []).map((k) => finding(k)?.sheetLabel || finding(k)?.label || k);
  const planKey = decision.plan || model?.plan || '';
  return {
    'Visit date': model?.visitDate || post.visit?.date || post.postDate,
    Tech: post.tech?.fullName || post.slackUser,
    Customer: model?.customerName || [post.customer?.firstName, post.customer?.lastName].filter(Boolean).join(' '),
    'Customer ID': post.customer?.id || post.customerIdPosted || '',
    Finding: labels.join('; '),
    Plan: planKey ? `${config.plans[planKey]?.name || (planKey === 'bat' ? config.batRemediation.name : planKey)}${model?.exclusion === false ? ' (no exclusion)' : ''}` : '',
    Quote: model ? model.price.initial : '',
    Credit: model ? model.price.credit : '',
    Bonus: bonus ?? 0,
    Counted: counted ? 'yes' : 'no',
    Notes: reason || '',
    Status: status,
    'Credit good through': model ? model.creditExpiresYmd : '',
    'Post ID': sheetPostId(decision),
  };
}

// Posts merged into a quote (alsoPosts): one sheet row each, so each post
// is settled and its tech is paid for its own findings. The quote and
// credit stay on the first post's row only, so totals don't double count.
function mergedRows({ decision: d, model, posts, config }) {
  return (d.alsoPosts || []).map((a) => {
    const other = posts.find((x) => x.ts === a.ts);
    const missing = (a.missingSteps || []).filter(Boolean);
    const plan = model?.plan || d.plan || config.findings.find((f) => f.key === a.findings[0])?.plan;
    const bonus = require('./lib/pricing').bonusFor(a.findings, { visitCategory: other.visit?.category }, config).perPlan[plan] ?? 0;
    const row = sheetRow({
      decision: { ...d, ts: a.ts, findings: a.findings, plan },
      post: other,
      model: model && { ...model, visitDate: other.visit?.date || other.postDate },
      status: d.action === 'quote' ? 'quoted' : 'task for office',
      counted: !missing.length,
      reason: [`same quote as post ${d.ts}`, missing.length ? `no bonus: missing ${missing.join(', ')}` : ''].filter(Boolean).join('; '),
      bonus: missing.length ? 0 : bonus,
      config,
    });
    return { ...row, Quote: '', Credit: '' };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { values: ['posts', 'decisions', 'now'], flags: ['preview', 'no-sheet', 'resend'] });
  if (args.resend && loadConfig().testMode === false) throw new Error('--resend only works in test mode');
  if (!args.posts || !args.decisions) throw new Error('usage: send.js --posts posts.json --decisions decisions.json [--preview] [--no-sheet]');
  const config = loadConfig();
  const test = config.testMode !== false;
  if (test && (!config.testPhone || !config.testEmail || !config.testTaskAssignee?.employeeId)) throw new Error('testMode is on but the test phone/email are missing: set INSPECTION_TEST_PHONE and INSPECTION_TEST_EMAIL in the environment');
  const collected = JSON.parse(fs.readFileSync(args.posts, 'utf8'));
  const { decisions } = JSON.parse(fs.readFileSync(args.decisions, 'utf8'));
  const outDir = path.dirname(path.resolve(args.decisions));
  const renderedFile = path.join(outDir, 'rendered.json');
  const rendered = fs.existsSync(renderedFile) ? JSON.parse(fs.readFileSync(renderedFile, 'utf8')).rendered : [];
  const nowMs = args.now ? Date.parse(args.now) : Date.now();
  const today = collected.today || cal.toEastern(nowMs).date;
  const prefix = test ? TEST_LOG_PREFIX : LOG_PREFIX;
  const assignee = test ? config.testTaskAssignee : config.taskAssignee;
  const sheetId = test ? config.sheet.testId : config.sheet.liveId;

  // Validate everything before anything goes out.
  const problems = [];
  for (const d of decisions) {
    const post = collected.posts.find((p) => p.ts === d.ts);
    const secondary = d.action === 'quote' && Q.customerGroups(decisions, collected.posts).get(Q.leadKey(d))?.primary === false;
    const errs = [...Q.checkDecision(d, post, config, collected.posts, { secondary }), ...Q.checkMerges(d, decisions, config)];
    if (d.action === 'quote' && !errs.length) {
      const m = Q.quoteModel(d, post, config, { today });
      errs.push(...Q.checkQuoteMessages(d, post, config, decisions, collected.posts, { today }));
      if (!rendered.find((r) => r.key === m.key)) errs.push('not rendered yet (run render.js)');
      else if (!args.preview && !rendered.find((r) => r.key === m.key).cardUrl) errs.push('rendered with --no-upload; run render.js again without it');
    }
    if (errs.length) problems.push(`${Q.leadKey(d)}: ${errs.join('; ')}`);
  }
  if (problems.length) throw new Error(`fix decisions.json first: ${problems.join(' | ')}`);


  const brio = args.preview ? null : createBriostack();

  // Duplicate protection: a lead already logged on the customer isn't sent
  // again. Checked up front so a customer's one text and email only cover
  // the quotes that are actually new.
  const dupKeys = new Set();
  if (brio && !args.resend) {
    for (const d of decisions.filter((x) => x.action === 'quote')) {
      const post = collected.posts.find((p) => p.ts === d.ts);
      const comms = await brio.listCommunications(post.customer.id);
      for (const c of comms.filter((x) => String(x.subject || '').startsWith('[INSPECTION FINDINGS'))) {
        const full = await brio.getCommunication(post.customer.id, c.communicationId);
        if (String(full?.content || '').includes(`Lead: ${Q.leadKey(d)}\n`)) dupKeys.add(Q.leadKey(d));
      }
    }
  }
  // One text and one email per customer: lead key -> { primary, group }.
  const groups = Q.customerGroups(decisions.filter((d) => !dupKeys.has(Q.leadKey(d))), collected.posts);
  const groupSent = new Map(); // primary lead key -> what went out

  const results = [];
  const rows = [];
  const taskItems = new Map(); // customer ID -> [task items]
  const batDrafts = [];
  for (const d of decisions) {
    const post = collected.posts.find((p) => p.ts === d.ts);
    const key = Q.leadKey(d);
    const r = { key, action: d.action };
    results.push(r);

    if (d.action === 'skip' || d.action === 'ask') {
      rows.push(sheetRow({ decision: d, post, status: d.action === 'ask' ? 'waiting' : 'not counted', counted: false, reason: d.reason || d.techMessage, bonus: 0, config }));
      continue;
    }

    const model = d.action === 'quote' ? Q.quoteModel(d, post, config, { today }) : null;
    const rend = model ? rendered.find((x) => x.key === model.key) : null;

    // Bat quotes wait for Daniel: a draft for him, nothing to the customer.
    if (Q.isBatDraft(d)) {
      r.text = r.email = r.log = r.task = 'draft for Daniel';
      batDrafts.push({ ts: d.ts, key, customer: model.customerName, message: batDraftMessage({ decision: d, post, model, rend, config }) });
      rows.push(sheetRow({ decision: d, post, model, status: 'waiting', counted: false, reason: 'bat quote: draft sent to Daniel for approval', bonus: 0, config }));
      continue;
    }

    if (dupKeys.has(key)) {
      r.text = r.email = r.log = r.task = 'already_sent';
      continue;
    }

    if (d.action === 'quote') {
      const who = model.customerName || `customer ${post.customer.id}`;
      const numbers = textNumbers(post);
      const sendAtMs = null; // sent now: Textable's sendAt isn't reliable
      const { group } = groups.get(key);
      const primaryKey = Q.leadKey(group[0]);
      const together = group.map((x) => Q.leadKey(x)).filter((k) => k !== key);
      const subjectBase = model.request && group.length === 1 ? `Your quote for ${model.street}` : `${model.signed ? 'What I found' : 'What we found'} at ${model.street}`;
      const subject = test ? `[TEST for ${who}] ${subjectBase}` : subjectBase;
      const emailTo = post.customer.email;
      const textBody = group[0].text.body.trim();
      const textMessage = test ? `TEST for ${who} (${numbers.map(formatPhone).join(', ') || 'no phone'}):\n${textBody}` : textBody;
      // Every quote in the customer's group: its model, rendered card/PDF,
      // photos and example picture, numbered for the email's content IDs.
      const parts = group.map((x, qi) => {
        const m = Q.quoteModel(x, collected.posts.find((p) => p.ts === x.ts), config, { today });
        const rx = rendered.find((y) => y.key === m.key);
        const infoPath = config.infographics?.[x.infographic || config.findings.find((f) => f.key === Q.allFindings(x)[0])?.infographic];
        const infographic = infoPath && fs.existsSync(path.join(__dirname, infoPath)) ? path.join(__dirname, infoPath) : null;
        const pre = group.length > 1 ? `q${qi + 1}-` : '';
        return { decision: x, model: m, rend: rx, infographic, infographicCid: infographic ? `${pre}infographic` : null, photos: rx.photos.map((ph, i) => ({ ...ph, cid: `${pre}photo-${i + 1}` })) };
      });
      const intro = group[0].email.intro;
      const closing = group[0].email.closing;
      const html = emailHtml({ intro, closing, parts, subject, config });
      const plain = emailPlain({ intro, closing, parts });

      if (args.preview) {
        r.textAt = 'now';
        if (key === primaryKey) {
          const dir = path.join(outDir, 'preview');
          fs.mkdirSync(dir, { recursive: true });
          const safe = `customer_${post.customer.id}`;
          fs.writeFileSync(path.join(dir, `${safe}-text.txt`), `To: ${test ? config.testPhone : numbers.join(', ')}\nPictures: ${parts.map((p) => p.rend.cardPath).join(', ')}\n\n${textMessage}\n`);
          let prev = html.replace('cid:catchy-logo', `file://${LOGO}`);
          for (const p of parts) {
            p.photos.forEach((ph) => (prev = prev.replace(`cid:${ph.cid}`, `file://${ph.path}`)));
            if (p.infographicCid) prev = prev.replace(`cid:${p.infographicCid}`, `file://${p.infographic}`);
          }
          fs.writeFileSync(path.join(dir, `${safe}-email.html`), prev);
        }
        r.text = r.email = key === primaryKey ? 'preview' : `preview (with ${primaryKey})`;
        const pc = String(post.customer.id);
        if (!taskItems.has(pc)) taskItems.set(pc, []);
        taskItems.get(pc).push({ decision: d, post, model, results: { ...r, text: 'sent', email: 'sent' }, action: d.action, sentAtMs: nowMs, previewOf: r });
        continue;
      }

      // One text and one email for the customer, sent with the group's
      // first quote; the others reuse what happened.
      const targets = test ? (numbers.length ? [`+1${normalizePhone(config.testPhone)}`] : []) : numbers.map((n) => `+1${n}`);
      if (test && targets.some((t) => t !== `+1${normalizePhone(config.testPhone)}`)) throw new Error('test mode guard: text recipient is not testPhone');
      if (key === primaryKey) {
        const sent = { textAtMs: Date.now() };
        // Text(s): primary and secondary phone only; every quote card attached.
        const textResults = [];
        for (const to of targets) textResults.push(await sendText({ to, message: textMessage, mediaUrl: parts.map((p) => p.rend.cardUrl), sendAtMs, from: config.textFrom }));
        sent.text = textResults.length ? [...new Set(textResults)].join(', ') : 'skipped (no number)';
        // Email: every quote's photos inline and every PDF attached.
        if (emailTo) {
          const to = test ? config.testEmail : emailTo;
          try {
            const inline = [{ cid: 'catchy-logo', filename: 'catchy-pest-solutions.png', mimeType: 'image/png', data: fs.readFileSync(LOGO) }];
            for (const p of parts) {
              p.photos.forEach((ph) => inline.push({ cid: ph.cid, filename: `${ph.cid}.jpg`, mimeType: 'image/jpeg', data: fs.readFileSync(ph.path) }));
              if (p.infographic) inline.push({ cid: p.infographicCid, filename: `${p.infographicCid}.jpg`, mimeType: p.infographic.endsWith('.png') ? 'image/png' : 'image/jpeg', data: fs.readFileSync(p.infographic) });
            }
            await google.sendMail({
              fromName: model.signed ? `${model.techName} at ${config.company.name}` : config.company.name,
              fromEmail: config.senderEmail,
              to,
              subject,
              text: plain,
              html,
              inline,
              attachments: parts.map((p) => ({ filename: `Catchy Pest Solutions - ${p.model.planName} quote for ${p.model.street}.pdf`.replace(/[\\/:*?"<>|]/g, ''), mimeType: 'application/pdf', data: fs.readFileSync(p.rend.pdfPath) })),
            });
            sent.email = 'sent';
          } catch (err) {
            sent.email = `failed: ${err.message}`;
          }
        } else sent.email = 'skipped (no address)';
        groupSent.set(primaryKey, sent);
      }
      const sent = groupSent.get(primaryKey);
      r.text = sent.text;
      r.email = sent.email;
      r.textAt = 'now';
      r.textAtMs = sent.textAtMs;
      if (together.length) r.together = together;

      // Log (even when a send failed, so a re-run can't double-send).
      try {
        const customer = await brio.getCustomer(post.customer.id);
        const unknownId = await findUnknownContactMethod(brio, post.customer.id);
        const phoneId = customer.primaryPhone?.contactMethodId;
        const emailId = customer.primaryEmail?.contactMethodId;
        const date = cal.easternIso(nowMs);
        const common = { prefix, key, model, post, today, together, pdfUrl: rend.pdfUrl, alsoLinks: (d.alsoPosts || []).map((a) => collected.posts.find((x) => x.ts === a.ts)?.link).filter(Boolean) };
        if (targets.length || numbers.length) {
          await createLogEntry(brio, post.customer.id, { subject: `${prefix} Text`, communicationTypeId: 'SMS', date, content: logBody({ ...common, kind: 'Text', status: r.text, recipient: numbers.map(formatPhone).join(', '), whenMs: nowMs, sendAtMs, message: textBody }) }, phoneId || emailId);
        }
        const entry = await createLogEntry(brio, post.customer.id, { subject: `${prefix} Email`, communicationTypeId: 'EMAIL_COMMUNICATION', date, content: logBody({ ...common, kind: 'Email', status: r.email, recipient: emailTo || 'no email', whenMs: nowMs, message: plain, subject: subjectBase }) }, emailId || phoneId);
        r.log = 'logged';
        if (entry?.communicationId) {
          try {
            await brio.uploadDocument(post.customer.id, entry.communicationId, { filename: 'Inspection findings quote.pdf', mimeType: 'application/pdf', data: fs.readFileSync(rend.pdfPath) });
          } catch (err) {
            r.log = `logged (PDF not attached: ${err.status || err.message})`;
          }
        }
      } catch (err) {
        r.log = `failed: ${err.message}`;
      }
    }

    // Task: one per customer, created after the loop.
    const cid = String(post.customer?.id || post.customerIdPosted || d.ts);
    if (!taskItems.has(cid)) taskItems.set(cid, []);
    taskItems.get(cid).push({ decision: d, post, model, results: r, action: d.action, sentAtMs: nowMs });

    const bonus = d.action === 'quote' ? model.bonus : require('./lib/pricing').bonusFor(d.action === 'quote_request' ? ['quote_request'] : d.findings, { visitCategory: post.visit?.category }, config).total;
    const missing = (d.missingSteps || []).filter(Boolean);
    rows.push(sheetRow({
      decision: d, post, model,
      status: d.action === 'quote' ? 'quoted' : ['commercial', 'custom_quote'].includes(d.action) ? 'task for office' : 'quote request',
      counted: !missing.length,
      reason: missing.length ? `no bonus: missing ${missing.join(', ')}` : d.reason || (model?.request || d.action === 'quote_request' ? 'quote request' : ''),
      bonus: missing.length ? 0 : bonus,
      config,
    }));

    rows.push(...mergedRows({ decision: d, model, posts: collected.posts, config }));
  }

  // One Briostack task per customer for Steve, covering all their quotes.
  for (const items of taskItems.values()) {
    if (args.preview) {
      const { title, description } = groupTask(items, { test });
      fs.mkdirSync(path.join(outDir, 'preview'), { recursive: true });
      fs.writeFileSync(path.join(outDir, 'preview', `customer_${items[0].post.customer?.id || items[0].decision.ts}-task.txt`), `${title}\n\n${description}\n`);
      items.forEach((it) => ((it.previewOf || it.results).task = 'preview'));
      continue;
    }
    try {
      const { title, description } = groupTask(items, { test });
      const created = await brio.createTask({
        title: title.slice(0, 120),
        taskTypeId: config.taskTypeId,
        statusId: 'ORDER_REQMNT_CREATED',
        description,
        employeeId: String(assignee.employeeId),
        partyId: String(items[0].post.customer.id),
        startDate: cal.easternIso(nowMs),
        dueDate: taskDue(nowMs, config),
      });
      const done = `created ${created?.taskId || ''} for ${assignee.name}`.trim();
      items.forEach((it, i) => (it.results.task = i === 0 ? done : `${done} (same task as ${items[0].results.key})`));
    } catch (err) {
      items.forEach((it) => (it.results.task = `failed: ${err.message}`));
    }
  }

  if (!args.preview && !args['no-sheet'] && sheetId && rows.length) {
    try {
      await sheet.upsertRows(sheetId, rows);
      results.forEach((r) => (r.sheet = 'saved'));
    } catch (err) {
      results.forEach((r) => (r.sheet = `failed: ${err.message}`));
    }
  } else results.forEach((r) => (r.sheet = sheetId ? 'skipped' : 'skipped (no sheet in config)'));
  fs.writeFileSync(path.join(outDir, 'sheet-rows.json'), JSON.stringify(rows, null, 2));
  fs.writeFileSync(path.join(outDir, 'bat-drafts.json'), JSON.stringify({ drafts: batDrafts }, null, 2));
  process.stdout.write(`${JSON.stringify({ results, testMode: test })}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stdout.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  });
}

module.exports = { batDraftMessage, groupTask, textSendAt, taskDue, textNumbers, logBody, taskDescription, mergedRows, sheetPostId };
