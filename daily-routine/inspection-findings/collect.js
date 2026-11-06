#!/usr/bin/env node
// Step 1-2 of the inspection findings routine (ROUTINE_PROMPT.md).
//
//   node collect.js --out $S [--now ISO] [--post TS[,TS...]] [--no-sheet]
//
// Reads #inspection-findings posts from the last config.lookbackDays days
// that the Leads sheet hasn't settled yet (no row, or a "waiting" row whose
// thread may have a new answer), downloads their photos, and gathers the
// Briostack facts the routine needs to judge each one: the customer and
// whether the name matches, the tech's visit, active plans on every record
// with the customer's phone number, what's already covered, earlier
// [INSPECTION FINDINGS] offers still open, and the price of every plan.
// Writes $S/posts.json and prints one JSON line: {"posts": N, "path": ...}.
// --post limits it to those Slack ts values (testing). Sends nothing.
require('../lead-followup/lib/proxy');
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('../lead-followup/lib/env');
const { createBriostack } = require('../lead-followup/lib/briostack');
const cal = require('../src/callReview/calendar');
const { createSlack, parsePost, plainText } = require('./lib/slack');
const sheet = require('./lib/sheet');
const pricing = require('./lib/pricing');
const { loadConfig, TEST_LOG_PREFIX } = require('./lib/common');

const PHOTO_TYPES = /^image\/(jpeg|png|heic|heif|webp)$/;

function nameMatch(posted, customer) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  const want = norm(posted);
  const have = norm(`${customer.firstName || ''} ${customer.lastName || ''}`);
  if (!want.length || !have.length) return 'unknown';
  const close = (a, b) => a === b || (Math.abs(a.length - b.length) <= 2 && editDistance(a, b) <= Math.max(1, Math.floor(b.length / 5)));
  const last = have[have.length - 1];
  if (want.join(' ') === have.join(' ')) return 'exact';
  if (want.some((w) => close(w, last))) return 'close';
  if (want.some((w) => have.some((h) => close(w, h)))) return 'partial';
  return 'none';
}
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

// The tech's appointment this post belongs to: completed (or still open) on
// the post day or up to lateDays before it, by this tech. Test mode can fall
// back to the customer's latest completed visit (testAllowAnyVisit).
function findVisit(appointments, { tech, postDate, config, test }) {
  const ids = tech ? [tech.employeeId, ...(tech.otherEmployeeIds || [])] : [];
  const earliest = cal.addDays(postDate, -config.lateDays);
  const real = appointments
    .filter((a) => ['SVC_TICK_COMPLETED', 'SVC_TICK_ACTIVE', 'SVC_TICK_RESOLVED'].includes(a.statusId))
    .filter((a) => a.appointmentDate >= earliest && a.appointmentDate <= postDate)
    .filter((a) => !ids.length || ids.includes(String(a.primaryTechnicianId)))
    .sort((a, b) => b.appointmentDate.localeCompare(a.appointmentDate));
  const pick = (a, waived) => ({
    appointmentId: a.appointmentId,
    date: waived ? postDate : a.appointmentDate,
    actualDate: a.appointmentDate,
    category: String(a.serviceCategoryId || ''),
    categoryName: String(a.serviceCategoryName || '').trim(),
    technicianId: a.primaryTechnicianId ? String(a.primaryTechnicianId) : null,
    status: a.statusId,
    serviceAddress: a.serviceAddress || null,
    waived,
  });
  if (real.length) return pick(real[0], false);
  if (test && config.testAllowAnyVisit) {
    const latest = appointments.filter((a) => a.statusId === 'SVC_TICK_COMPLETED').sort((a, b) => b.appointmentDate.localeCompare(a.appointmentDate))[0];
    if (latest) return pick(latest, true);
  }
  return null;
}

// "[INSPECTION FINDINGS] ... Plan: X ... Credit good through: YYYY-MM-DD"
function parseOfferLog(entry) {
  const text = `${entry.subject || ''}\n${entry.content || ''}`;
  const test = String(entry.subject || '').startsWith(TEST_LOG_PREFIX);
  const plan = /Plan key:\s*(\w+)/.exec(text)?.[1] || null;
  const until = /Credit good through:\s*(\d{4}-\d{2}-\d{2})/.exec(text)?.[1] || null;
  const quoted = /Quote date:\s*(\d{4}-\d{2}-\d{2})/.exec(text)?.[1] || String(entry.date || '').slice(0, 10);
  return { plan, until, quoted, test, communicationId: entry.communicationId };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { values: ['out', 'now', 'post'], flags: ['no-sheet'] });
  if (!args.out) throw new Error('usage: collect.js --out DIR [--now ISO] [--post TS,...] [--no-sheet]');
  const config = loadConfig();
  const test = config.testMode !== false;
  const nowMs = args.now ? Date.parse(args.now) : Date.now();
  const today = cal.toEastern(nowMs).date;
  const out = path.resolve(args.out);
  fs.mkdirSync(out, { recursive: true });

  const slack = createSlack();
  const brio = createBriostack({ pauseMs: 800 });
  const sheetId = test ? config.sheet.testId : config.sheet.liveId;
  const sheetRows = sheetId && !args['no-sheet'] ? (await sheet.readSheet(sheetId)).items : [];
  // Rows are keyed "<ts>:<plan>" (or "<ts>"); a post is settled once it has
  // rows and none of them is "waiting".
  const postOf = (id) => String(id || '').split(':')[0];
  const waitingPosts = new Set(sheetRows.filter((r) => r.Status === 'waiting').map((r) => postOf(r['Post ID'])));
  const settled = new Set(sheetRows.map((r) => postOf(r['Post ID'])).filter((ts) => !waitingPosts.has(ts)));
  const team = await slack.team();

  const oldest = (nowMs - config.lookbackDays * 86400000) / 1000;
  let messages = await slack.history(config.channelId, oldest);
  messages = messages.filter((m) => m.type === 'message' && !m.subtype && !m.bot_id);
  if (args.post) {
    const want = new Set(args.post.split(','));
    messages = messages.filter((m) => want.has(m.ts));
  } else messages = messages.filter((m) => !settled.has(m.ts));

  const posts = [];
  for (const m of messages) {
    const parsed = parsePost(m.text);
    const postMs = Math.round(Number(m.ts) * 1000);
    const postDate = cal.toEastern(postMs).date;
    const dir = path.join(out, 'posts', m.ts.replace('.', '_'));
    fs.mkdirSync(dir, { recursive: true });
    const photos = [];
    for (const f of m.files || []) {
      if (!PHOTO_TYPES.test(f.mimetype || '')) continue;
      const dest = path.join(dir, `${photos.length + 1}-${String(f.name || 'photo').replace(/[^\w.-]/g, '_')}`);
      await slack.download(f, dest);
      photos.push({ fileId: f.id, name: f.name, path: dest, mimetype: f.mimetype, bytes: fs.statSync(dest).size });
    }
    const thread = m.reply_count ? (await slack.replies(config.channelId, m.ts)).map((r) => ({ ts: r.ts, user: r.user, fromDaniel: r.user === config.danielSlackUserId, text: plainText(r.text) })) : [];

    const poster = config.technicians[m.user] || null;
    const post = {
      ts: m.ts,
      link: `${team.url}archives/${config.channelId}/p${m.ts.replace('.', '')}`,
      postedAt: cal.easternIso(postMs),
      postDate,
      postTime: cal.formatTime(postMs),
      slackUser: m.user,
      postedByDaniel: m.user === config.danielSlackUserId,
      tech: poster,
      text: parsed.text,
      customerIdPosted: parsed.customerId,
      namePosted: parsed.name,
      quoteRequest: parsed.quoteRequest,
      photos,
      thread,
      sheetRows: sheetRows.filter((r) => postOf(r['Post ID']) === m.ts),
      checks: {},
      problems: [],
    };
    posts.push(post);
    if (!parsed.customerId) {
      // Daniel's own chatter in the channel isn't a post to judge.
      if (post.postedByDaniel && !photos.length) {
        posts.pop();
        continue;
      }
      post.problems.push('no customer ID in the post');
      continue;
    }

    let customer;
    try {
      customer = await brio.getCustomer(parsed.customerId);
    } catch (err) {
      post.problems.push(`customer #${parsed.customerId} not found in Briostack (${err.status || err.message})`);
      continue;
    }
    const services = (await brio.getServices(parsed.customerId)).map((s) => ({ ...s, customerId: String(parsed.customerId) }));
    const appointments = await brio.getAppointments(parsed.customerId);

    // Other properties: other customer records with the same primary phone.
    const otherRecords = [];
    const phone = customer.primaryPhone?.number;
    if (phone) {
      try {
        for (const c of await brio.findCustomersByPhone(phone)) {
          if (String(c.customerId) === String(parsed.customerId)) continue;
          const s = await brio.getServices(c.customerId);
          otherRecords.push({ customerId: String(c.customerId), name: `${c.firstName || ''} ${c.lastName || ''}`.trim(), services: s.length });
          services.push(...s.map((x) => ({ ...x, customerId: String(c.customerId) })));
        }
      } catch (err) {
        post.problems.push(`couldn't check for other properties (${err.message})`);
      }
    }

    // Who did the visit: the poster, or (Daniel's test posts) the visit's tech.
    let visit = findVisit(appointments, { tech: poster, postDate, config, test });
    let tech = poster;
    if (!tech && post.postedByDaniel && visit) {
      tech = Object.values(config.technicians).find((t) => [t.employeeId, ...(t.otherEmployeeIds || [])].includes(visit.technicianId)) || null;
      if (!tech) visit = { ...visit, note: 'visit tech is not on config.technicians' };
    }
    post.tech = tech;

    const analysis = pricing.analyzeServices(services, config, { todayDate: today });
    const comms = await brio.listCommunications(parsed.customerId);
    // The list leaves out content; open each of our entries for its details.
    const ours = comms.filter((c) => String(c.subject || '').startsWith('[INSPECTION FINDINGS'));
    const offers = [];
    for (const c of ours) offers.push(parseOfferLog({ ...c, ...(await brio.getCommunication(parsed.customerId, c.communicationId)) }));
    const priorOffers = [
      ...offers.filter((o) => o.plan && o.until && o.until >= today && (test || !o.test)).map((o) => ({ source: 'briostack', ...o })),
      ...sheetRows
        .filter((r) => r['Customer ID'] === String(parsed.customerId) && r.Status === 'quoted' && r['Credit expires'] >= today && postOf(r['Post ID']) !== m.ts)
        .map((r) => ({ source: 'sheet', plan: r.Plan, until: r['Credit expires'], quoted: r.Posted })),
    ];

    const addr = visit?.serviceAddress || customer.primaryAddress || {};
    post.customer = {
      id: String(parsed.customerId),
      firstName: String(customer.firstName || '').trim() || null,
      lastName: String(customer.lastName || '').trim() || null,
      accountType: customer.accountTypeId || null,
      status: customer.statusId,
      phones: [customer.primaryPhone, customer.secondaryPhone].filter((p) => p && p.number).map((p) => ({ number: p.number, textNotifications: p.textNotifications, contactMethodId: p.contactMethodId })),
      email: customer.primaryEmail?.address || null,
      emailContactMethodId: customer.primaryEmail?.contactMethodId || null,
      street: addr.address || null,
      serviceAddress: [addr.address, addr.city, addr.stateOrProvince].filter(Boolean).join(', ') || null,
      otherRecords,
    };
    post.visit = visit;
    post.plans = analysis;
    post.priorOffers = priorOffers;
    post.prices = pricing.allPrices(analysis, config);
    post.creditExpires = pricing.creditExpiry(today, config);

    const nm = nameMatch(parsed.name, customer);
    post.checks = {
      nameMatch: nm,
      techMapped: Boolean(tech),
      visitFound: Boolean(visit),
      visitWaived: Boolean(visit?.waived),
      commercial: customer.accountTypeId === 'ACCOUNT_TYPE_COMMERCIAL' || analysis.commercialPlan,
      catchyClub: analysis.catchyClub,
      covered: analysis.covered,
      priorOfferPlans: [...new Set(priorOffers.map((o) => o.plan))],
      inspectionVisit: Boolean(visit && config.inspectionCategories.includes(visit.category)),
    };
    if (nm === 'none') post.problems.push(`name "${parsed.name}" doesn't match Briostack (${customer.firstName} ${customer.lastName})`);
    if (!tech) post.problems.push(poster ? 'poster is not mapped to a technician' : 'Slack user is not on config.technicians');
    if (!visit) post.problems.push(`no appointment by ${tech?.fullName || 'this tech'} on ${postDate} or up to ${config.lateDays} day(s) before`);
    if (!post.customer.phones.length && !post.customer.email) post.problems.push('customer has no phone or email');
  }

  const file = path.join(out, 'posts.json');
  fs.writeFileSync(file, JSON.stringify({ collectedAt: cal.easternIso(nowMs), today, testMode: test, sheetId, posts }, null, 2));
  process.stdout.write(`${JSON.stringify({ posts: posts.length, path: file, testMode: test })}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stdout.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  });
}

module.exports = { nameMatch, findVisit, parseOfferLog };
