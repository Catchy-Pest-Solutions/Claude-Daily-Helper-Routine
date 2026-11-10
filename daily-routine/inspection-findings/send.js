#!/usr/bin/env node
// Steps 4-8 of the inspection findings routine (ROUTINE_PROMPT.md).
//
//   node send.js --posts $S/posts.json --decisions $S/decisions.json [--preview] [--no-sheet]
//
// For each decision:
//   quote          email now, text(s) scheduled for config.textSendTime
//                  (10 AM Eastern) through Textable sendAt, two
//                  [INSPECTION FINDINGS] entries on the customer's
//                  Communications tab (the PDF on the email entry), a
//                  BID_FOLLOWUP task, and a Leads sheet row.
//   commercial     task to price it (no message to the customer), sheet row
//                  (the tech still earns the bonus).
//   custom_quote   same, for a custom job on a customer we'd otherwise
//                  skip (bats on a Critter Control customer: bats aren't
//                  covered); the tech earns the bonus.
//   quote_request  task for the office to quote it, sheet row ($0 bonus).
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
  const body = { to, from, message, ...(mediaUrl ? { media: [mediaUrl] } : {}), ...(sendAtMs ? { sendAt: sendAtMs } : {}) };
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

function emailHtml({ decision, model, subject, photos, config, infographic }) {
  return fill('email.html', {
    subject,
    logoCid: 'catchy-logo',
    intro: (decision.email.intro || []).map(para),
    photos: photos.map((p, i) => ({ cid: `photo-${i + 1}`, caption: p.caption || '' })),
    body: (decision.email.body || []).map(para),
    why: decision.why || [],
    hasWhy: (decision.why || []).length > 0,
    ...model,
    closing: (decision.email.closing || []).map(para),
    infographic: infographic ? { infographicCid: 'infographic' } : null,
    company: config.company,
    officePhone: config.officePhone,
    officePhoneDigits: `+1${normalizePhone(config.officePhone)}`,
  });
}

function emailPlain(decision, model) {
  return [
    ...(decision.email.intro || []),
    ...(decision.email.body || []),
    ...(decision.why?.length ? ['Why it matters:', ...decision.why.map((w) => `- ${w}`)] : []),
    `The fix: ${model.fixLine}${model.credit ? ` Includes your ${model.credit} credit, good through ${model.creditExpiresLong}.` : ''}`,
    ...(model.coversDetails.length ? ['How we fix it:', ...model.coversDetails] : []),
    ...model.finePrint,
    `Details: ${model.planName}, 12-month plan, billed every 4 weeks. No annual commitment: ${model.noAnnualInitial} initial, same monthly fee. The full quote is attached as a PDF.`,
    ...(decision.email.closing || []),
    `Short video about ${model.planName}: ${model.video}`,
  ].join('\n\n');
}

function logBody({ prefix, kind, key, model, post, status, recipient, whenMs, sendAtMs, message, subject, pdfUrl, today, alsoLinks = [] }) {
  const when = status === 'scheduled' && sendAtMs ? `scheduled for ${cal.formatDay(sendAtMs)} ${cal.formatTime(sendAtMs)}` : `${cal.formatDay(whenMs)} ${cal.formatTime(whenMs)}`;
  return [
    `${prefix} ${kind} ${status}${prefix === TEST_LOG_PREFIX && ['sent', 'scheduled'].includes(status) ? ` to the test ${kind === 'Text' ? 'phone' : 'inbox'} only` : ''}`,
    `Customer ${prefix === TEST_LOG_PREFIX ? 'contact' : 'to'}: ${recipient}`,
    `When: ${when}`,
    `Found by: ${model.techName} (Slack post ${post.link}${alsoLinks.length ? `, also ${alsoLinks.join(', ')}` : ''})`,
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
function taskDescription({ decision, post, model, results, action, sentAtMs }) {
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
  return blocks.map((b) => b.join('\n')).join('\n\n');
}

// The sheet's Post ID always has a ":" so Google Sheets keeps it as text:
// a bare Slack ts ("1794243334.617239") is read as a number and rounded,
// and collect.js would no longer see the post as handled.
const sheetPostId = (decision) => {
  const key = Q.leadKey(decision);
  return key.includes(':') ? key : `${key}:none`;
};

function sheetRow({ decision, post, model, status, counted, reason, bonus, config }) {
  const labels = (decision.findings || []).map((k) => config.findings.find((f) => f.key === k)?.label || k);
  const planKey = decision.plan || model?.plan || '';
  return {
    'Visit date': model?.visitDate || post.visit?.date || post.postDate,
    Tech: post.tech?.fullName || post.slackUser,
    Customer: model?.customerName || [post.customer?.firstName, post.customer?.lastName].filter(Boolean).join(' '),
    'Customer ID': post.customer?.id || post.customerIdPosted || '',
    Finding: labels.join('; '),
    Plan: planKey ? `${config.plans[planKey]?.name || planKey}${model?.exclusion === false ? ' (no exclusion)' : ''}` : '',
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
    const errs = [...Q.checkDecision(d, post, config, collected.posts), ...Q.checkMerges(d, decisions, config)];
    if (d.action === 'quote' && !errs.length) {
      const m = Q.quoteModel(d, post, config, { today });
      const e1 = Q.checkTextPrice(d.text.body, m) || Q.checkTextCovers(d.text.body, m);
      const e2 = Q.checkDayNames([d.text.body, ...(d.email.intro || []), ...(d.email.body || []), ...(d.email.closing || [])], m);
      if (e1) errs.push(e1);
      if (e2) errs.push(e2);
      if (!rendered.find((r) => r.key === m.key)) errs.push('not rendered yet (run render.js)');
      else if (!args.preview && !rendered.find((r) => r.key === m.key).cardUrl) errs.push('rendered with --no-upload; run render.js again without it');
    }
    if (errs.length) problems.push(`${Q.leadKey(d)}: ${errs.join('; ')}`);
  }
  if (problems.length) throw new Error(`fix decisions.json first: ${problems.join(' | ')}`);

  const brio = args.preview ? null : createBriostack();
  const results = [];
  const rows = [];
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

    // Duplicate protection: this lead already logged on the customer.
    if (brio && d.action === 'quote' && !args.resend) {
      const comms = await brio.listCommunications(post.customer.id);
      let dup = false;
      for (const c of comms.filter((x) => String(x.subject || '').startsWith('[INSPECTION FINDINGS'))) {
        const full = await brio.getCommunication(post.customer.id, c.communicationId);
        if (String(full?.content || '').includes(`Lead: ${key}\n`)) dup = true;
      }
      if (dup) {
        r.text = r.email = r.log = r.task = 'already_sent';
        continue;
      }
    }

    if (d.action === 'quote') {
      const who = model.customerName || `customer ${post.customer.id}`;
      const numbers = textNumbers(post);
      const sendAtMs = textSendAt(nowMs, config);
      r.textAt = sendAtMs ? `${cal.formatDay(sendAtMs)} ${cal.formatTime(sendAtMs)}` : 'now';
      r.textAtMs = sendAtMs || nowMs;
      const subjectBase = model.request ? `Your quote for ${model.street}` : `What I found at ${model.street}`;
      const subject = test ? `[TEST for ${who}] ${subjectBase}` : subjectBase;
      const photos = rend.photos;
      const infoPath = config.infographics?.[d.infographic || config.findings.find((f) => f.key === Q.allFindings(d)[0])?.infographic];
      const infographic = infoPath && fs.existsSync(path.join(__dirname, infoPath)) ? path.join(__dirname, infoPath) : null;
      const html = emailHtml({ decision: d, model, subject, photos, config, infographic });
      const textBody = d.text.body.trim();
      const textMessage = test ? `TEST for ${who} (${numbers.map(formatPhone).join(', ') || 'no phone'}):\n${textBody}` : textBody;
      const emailTo = post.customer.email;

      if (args.preview) {
        const dir = path.join(outDir, 'preview');
        fs.mkdirSync(dir, { recursive: true });
        const safe = key.replace(/[^\w]/g, '_');
        fs.writeFileSync(path.join(dir, `${safe}-text.txt`), `To: ${test ? config.testPhone : numbers.join(', ')}\nSend at: ${r.textAt}\nPicture: ${rend.cardPath}\n\n${textMessage}\n`);
        let prev = html.replace('cid:catchy-logo', `file://${LOGO}`);
        photos.forEach((p, i) => (prev = prev.replace(`cid:photo-${i + 1}`, `file://${p.path}`)));
        fs.writeFileSync(path.join(dir, `${safe}-email.html`), prev);
        r.text = r.email = 'preview';
        continue;
      }

      // Text(s): primary and secondary only; one test text in test mode.
      const targets = test ? (numbers.length ? [`+1${normalizePhone(config.testPhone)}`] : []) : numbers.map((n) => `+1${n}`);
      if (test && targets.some((t) => t !== `+1${normalizePhone(config.testPhone)}`)) throw new Error('test mode guard: text recipient is not testPhone');
      const textResults = [];
      for (const to of targets) textResults.push(await sendText({ to, message: textMessage, mediaUrl: rend.cardUrl, sendAtMs, from: config.textFrom }));
      r.text = textResults.length ? [...new Set(textResults)].join(', ') : 'skipped (no number)';

      // Email.
      if (emailTo) {
        const to = test ? config.testEmail : emailTo;
        try {
          const inline = [{ cid: 'catchy-logo', filename: 'catchy-pest-solutions.png', mimeType: 'image/png', data: fs.readFileSync(LOGO) }];
          photos.forEach((p, i) => inline.push({ cid: `photo-${i + 1}`, filename: `photo-${i + 1}.jpg`, mimeType: 'image/jpeg', data: fs.readFileSync(p.path) }));
          if (infographic) inline.push({ cid: 'infographic', filename: 'example.jpg', mimeType: infographic.endsWith('.png') ? 'image/png' : 'image/jpeg', data: fs.readFileSync(infographic) });
          await google.sendMail({
            fromName: `${model.techName} at ${config.company.name}`,
            fromEmail: config.senderEmail,
            to,
            subject,
            text: emailPlain(d, model),
            html,
            inline,
            attachments: [{ filename: `Catchy Pest Solutions - What I found at ${model.street}.pdf`.replace(/[\\/:*?"<>|]/g, ''), mimeType: 'application/pdf', data: fs.readFileSync(rend.pdfPath) }],
          });
          r.email = 'sent';
        } catch (err) {
          r.email = `failed: ${err.message}`;
        }
      } else r.email = 'skipped (no address)';

      // Log (even when a send failed, so a re-run can't double-send).
      try {
        const customer = await brio.getCustomer(post.customer.id);
        const unknownId = await findUnknownContactMethod(brio, post.customer.id);
        const phoneId = customer.primaryPhone?.contactMethodId;
        const emailId = customer.primaryEmail?.contactMethodId;
        const date = cal.easternIso(nowMs);
        const common = { prefix, key, model, post, today, pdfUrl: rend.pdfUrl, alsoLinks: (d.alsoPosts || []).map((a) => collected.posts.find((x) => x.ts === a.ts)?.link).filter(Boolean) };
        if (targets.length || numbers.length) {
          await createLogEntry(brio, post.customer.id, { subject: `${prefix} Text`, communicationTypeId: 'SMS', date, content: logBody({ ...common, kind: 'Text', status: r.text, recipient: numbers.map(formatPhone).join(', '), whenMs: nowMs, sendAtMs, message: textBody }) }, phoneId || emailId);
        }
        const entry = await createLogEntry(brio, post.customer.id, { subject: `${prefix} Email`, communicationTypeId: 'EMAIL_COMMUNICATION', date, content: logBody({ ...common, kind: 'Email', status: r.email, recipient: emailTo || 'no email', whenMs: nowMs, message: emailPlain(d, model), subject: subjectBase }) }, emailId || phoneId);
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

    // Task.
    if (args.preview) {
      r.task = 'preview';
    } else {
      try {
        const title = d.action === 'quote'
          ? `${test ? 'TEST ' : ''}Inspection finding: ${model.planName} quote — ${model.customerName}`
          : `${test ? 'TEST ' : ''}${{ commercial: 'Price inspection finding (business)', custom_quote: 'Custom quote needed (inspection finding)' }[d.action] || 'Quote request from tech'} — ${[post.customer?.firstName, post.customer?.lastName].filter(Boolean).join(' ')}`;
        const created = await brio.createTask({
          title: title.slice(0, 120),
          taskTypeId: config.taskTypeId,
          statusId: 'ORDER_REQMNT_CREATED',
          description: taskDescription({ decision: d, post, model, results: r, action: d.action, sentAtMs: nowMs }),
          employeeId: String(assignee.employeeId),
          partyId: String(post.customer.id),
          startDate: cal.easternIso(nowMs),
          dueDate: taskDue(nowMs, config),
        });
        r.task = `created ${created?.taskId || ''} for ${assignee.name}`.trim();
      } catch (err) {
        r.task = `failed: ${err.message}`;
      }
    }

    const bonus = d.action === 'quote' ? model.bonus : ['commercial', 'custom_quote'].includes(d.action) ? require('./lib/pricing').bonusFor(d.findings, { visitCategory: post.visit?.category }, config).total : 0;
    const missing = (d.missingSteps || []).filter(Boolean);
    rows.push(sheetRow({
      decision: d, post, model,
      status: d.action === 'quote' ? 'quoted' : ['commercial', 'custom_quote'].includes(d.action) ? 'task for office' : 'quote request',
      counted: d.action !== 'quote_request' && !missing.length,
      reason: missing.length ? `no bonus: missing ${missing.join(', ')}` : d.reason || (model?.request ? 'quote request (no bonus)' : ''),
      bonus: missing.length ? 0 : bonus,
      config,
    }));

    rows.push(...mergedRows({ decision: d, model, posts: collected.posts, config }));
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
  process.stdout.write(`${JSON.stringify({ results, testMode: test })}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stdout.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  });
}

module.exports = { textSendAt, taskDue, textNumbers, logBody, taskDescription, mergedRows, sheetPostId };
