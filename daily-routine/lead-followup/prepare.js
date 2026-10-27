#!/usr/bin/env node
// Step 1 of the new-customer follow-up (ROUTINE_PROMPT.md).
//
//   node prepare.js --payload $S/payload.json --out $S
//
// Reads the Briostack webhook payload, then checks every 2 minutes (stopping
// by 9 minutes) until the customer's call transcript is in and a service is
// on the record. Writes $S/lead.json (and $S/transcript.txt) and prints
// exactly one status line:
//   already_sent | no_call | no_contact | waiting | ready | error: ...
//
// Run it again with the same --out to keep waiting: it remembers the ATS
// feed position and run count in $S/prepare-state.json. A re-run after a
// "ready" with booked false waits up to 9 minutes for a booked service to
// appear (ROUTINE_PROMPT Step 2, item 4).
//
// Testing options: --once (one check, no waiting), --as-of ISO (treat that
// moment as "now" for the call search, e.g. for a customer from last week).
require('./lib/proxy');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, parseArgs, requireEnv } = require('./lib/env');
const { createBriostack, parseAtsCommunication } = require('./lib/briostack');
const lead = require('./lib/lead');
const { schedule } = require('./lib/schedule');
const cal = require('../src/callReview/calendar');
const officeConfig = require('../src/callReview/config');
const { createAtsClient } = require('../src/callReview/atsClient');
const { groupCalls, classifyCall } = require('../src/callReview/callAnalysis');

const MIN = 60000;
// A second call's transcript is worth waiting for only this long after it
// ended (the slowest seen in testing took 15.7 minutes).
const OTHER_CALL_WAIT_MS = 20 * MIN;
// Briostack's copy of an ATS call is dated at the call start.
const COMM_MATCH_MS = 3 * MIN;
// Before giving up with no_contact, give the office time to finish typing.
const NO_CONTACT_AFTER_MS = 5 * MIN;

let printed = false;
function finish(status) {
  if (printed) return;
  printed = true;
  process.stdout.write(`${status}\n`);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2), { values: ['payload', 'out', 'as-of'], flags: ['once'] });
  if (!args.payload || !args.out) throw new Error('usage: prepare.js --payload payload.json --out DIR');
  const config = loadConfig();
  const t = config.timing;
  const out = path.resolve(args.out);
  fs.mkdirSync(out, { recursive: true });
  const asOfMs = args['as-of'] ? Date.parse(args['as-of']) : null;
  if (args['as-of'] && !Number.isFinite(asOfMs)) throw new Error('--as-of must be an ISO date/time');
  const clockOffset = asOfMs ? asOfMs - startedAt : 0;
  const now = () => Date.now() + clockOffset;

  const rawPayload = fs.readFileSync(args.payload, 'utf8');
  const customerId = lead.customerIdFromPayload(rawPayload);
  if (!customerId) throw new Error('payload has no customer ID');
  const initiatorId = lead.initiatorFromPayload(rawPayload);

  const statePath = path.join(out, 'prepare-state.json');
  const state = readJson(statePath, { runs: 0, feedCursor: null, feedStartMs: null, comms: {}, feed: {} });
  state.runs += 1;
  const waitForBooked = Boolean(state.waitForBooked || (state.lastStatus === 'ready' && state.lastBooked === false));
  state.waitForBooked = waitForBooked;

  const env = requireEnv(['ATS_USERNAME', 'ATS_PASSWORD']);
  const brio = createBriostack();
  const ats = createAtsClient({ username: env.ATS_USERNAME, password: env.ATS_PASSWORD, customerId: officeConfig.atsCustomerId });

  const writeLead = (data) => {
    fs.writeFileSync(path.join(out, 'lead.json'), `${JSON.stringify(data, null, 2)}\n`);
    fs.writeFileSync(statePath, `${JSON.stringify(state)}\n`);
  };

  // Transcripts we already have, by ATS call ID: { summary, transcription, ext, source }.
  const transcripts = new Map();

  // Who created the record (from the payload). Office staff map from
  // src/callReview/config.js; anyone else is looked up once. "Leads Nurture"
  // (website and Google leads) isn't a person.
  async function whoCreated() {
    if (!initiatorId) return null;
    if (state.createdBy && state.createdBy.employeeId === initiatorId) return state.createdBy;
    const staff = Object.values(officeConfig.staff).find((x) => String(x.briostackEmployeeId) === initiatorId);
    let name = staff?.name || null;
    if (!name) {
      const e = (await brio.listEmployees().catch(() => [])).find((x) => String(x.employeeId) === initiatorId);
      name = e ? [e.firstName, e.lastName].map((x) => String(x || '').trim()).filter(Boolean).join(' ') : null;
    }
    const automatic = (config.automaticEmployeeIds || []).includes(initiatorId);
    state.createdBy = { employeeId: initiatorId, name, person: !automatic };
    return state.createdBy;
  }

  async function check() {
    const nowMs = now();
    const customer = await brio.getCustomer(customerId);
    if (!customer || !customer.customerId) throw new Error(`customer ${customerId} not found in Briostack`);
    const info = lead.customerInfo({ ...customer, customerId: customer.customerId || customerId });

    const comms = await brio.listCommunications(customerId);
    if (lead.alreadySent(comms)) return { status: 'already_sent', info };

    const [services, appointments] = [await brio.getServices(customerId), await brio.getAppointments(customerId)];
    const svc = lead.servicesInfo(services, appointments, config.notBookedCategories);
    const createdMs = lead.creationMs(customer.dateAcquired, services, appointments) ?? nowMs;
    info.createdAt = cal.easternIso(createdMs);

    // Calls with this customer's number: today, and at least the 3 hours
    // before the record was created.
    const dayStart = cal.easternToMs(cal.toEastern(createdMs).date);
    const windowStart = Math.min(dayStart, createdMs - t.callLookbackHours * 60 * MIN);
    const legs = await ats.searchCalls(windowStart, nowMs + MIN);
    const calls = groupCalls(legs)
      .map((c) => classifyCall(c, officeConfig))
      .filter((c) => c.direction !== 'internal' && info.phones10.includes(c.phone) && c.startMs <= nowMs)
      .filter(lead.isConversation);
    const recent = calls.filter((c) => c.startMs >= createdMs - t.callLookbackHours * 60 * MIN);
    const main = lead.pickMainCall(recent, createdMs);

    // Transcripts: Briostack's copy first, then the ATS feed.
    for (const m of comms.filter((x) => x.communicationTypeId === 'PHONE_COMMUNICATION' && x.createdBy === 'system')) {
      if (!state.comms[m.communicationId]) {
        const d = await brio.getCommunication(customerId, m.communicationId);
        const parsed = parseAtsCommunication(d?.content);
        state.comms[m.communicationId] = parsed ? { ...parsed, dateMs: Date.parse(m.date) } : { none: true };
      }
    }
    // Each Briostack copy goes to the call closest to its date, one to one
    // (two calls minutes apart must not share a transcript). ATS labels its
    // copies "Incoming Call" even for outbound calls, so only time is used.
    transcripts.clear();
    const pairs = [];
    for (const c of calls) {
      for (const [cid, x] of Object.entries(state.comms)) {
        const dt = x.none ? Infinity : Math.abs(x.dateMs - c.startMs);
        if (dt <= COMM_MATCH_MS) pairs.push({ c, cid, x, dt });
      }
    }
    const usedComms = new Set();
    for (const p of pairs.sort((a, b) => a.dt - b.dt)) {
      if (transcripts.has(p.c.id) || usedComms.has(p.cid)) continue;
      usedComms.add(p.cid);
      transcripts.set(p.c.id, { ...p.x, source: 'briostack' });
    }
    for (const c of calls) {
      if (!transcripts.has(c.id) && state.feed[c.id]) transcripts.set(c.id, { ...state.feed[c.id], source: 'ats' });
    }
    const missing = calls.filter((c) => !transcripts.has(c.id));
    if (missing.length) {
      // The feed's call_time can be a little before the call's first leg.
      const earliest = Math.min(...missing.map((c) => c.startMs)) - 15 * MIN;
      let rows;
      if (state.feedCursor == null || earliest < state.feedStartMs) {
        const r = await ats.searchTranscripts(earliest);
        rows = r.transcripts;
        state.feedCursor = r.headId;
        state.feedStartMs = earliest;
      } else {
        const r = await ats.transcriptsAfter(state.feedCursor);
        rows = r.transcripts;
        state.feedCursor = r.cursor;
      }
      const wanted = new Set(missing.map((c) => c.id));
      for (const row of rows) {
        if (!wanted.has(row.cdr_id)) continue;
        state.feed[row.cdr_id] = { summary: row.summary || '', transcription: row.transcription || '', ext: null };
        transcripts.set(row.cdr_id, { ...state.feed[row.cdr_id], source: 'ats' });
      }
    }

    // What we're still waiting for.
    const waitingFor = [];
    if (!main) waitingFor.push('a call with this phone number');
    else if (!transcripts.has(main.id)) waitingFor.push('the call transcript');
    for (const c of recent) {
      if (main && c.id !== main.id && !transcripts.has(c.id) && nowMs - c.endMs < OTHER_CALL_WAIT_MS) waitingFor.push(`the transcript of the ${cal.formatTime(c.startMs)} call`);
    }
    if (!svc.services.length) waitingFor.push('a service on the record');
    if (waitForBooked && !svc.booked) waitingFor.push('a booked service (re-check)');

    const mainT = main ? transcripts.get(main.id) : null;
    const staff = main ? lead.staffName(main.agent, officeConfig) || lead.staffName(mainT?.ext, officeConfig) : null;
    let transcript = null;
    if (main && mainT) {
      const file = path.join(out, 'transcript.txt');
      fs.writeFileSync(file, lead.transcriptText(calls, main.id, transcripts, officeConfig));
      transcript = { summary: mainT.summary || null, path: file };
    }

    const createdBy = await whoCreated();
    const { contactMethodIds, phones10, ...customerOut } = info;
    const data = {
      customer: customerOut,
      services: svc.services,
      booked: svc.booked,
      call: main ? { staff, start: cal.easternIso(main.startMs), end: cal.easternIso(main.endMs), direction: main.direction, talkSec: main.talkSec || 0, callId: main.id } : null,
      calls: calls.map((c) => lead.callSummary(c, officeConfig, transcripts.get(c.id))),
      transcript,
      createdBy,
      schedule: (({ textSendAt, closeDays }) => ({ textSendAt, closeDays }))(
        schedule(Date.now(), { createdByStaff: Boolean(createdBy?.person), quiet: config.textQuietHours }),
      ),
      contactMethodIds,
      waitingFor,
    };

    if (!info.mobile && !info.email) {
      if (nowMs - createdMs >= NO_CONTACT_AFTER_MS) return { status: 'no_contact', data };
      data.waitingFor.push('a phone number or email');
      return { status: 'waiting', data };
    }
    if (!main && nowMs - createdMs >= t.noCallAfterMinutes * MIN) return { status: 'no_call', data };
    if (waitingFor.length) return { status: 'waiting', data };
    return { status: 'ready', data };
  }

  const stopBy = startedAt + t.stopByMinutes * MIN;
  const every = t.checkEveryMinutes * MIN;
  // Hard stop: whatever happens, print by 9 minutes.
  const watchdog = setTimeout(() => {
    finish('waiting');
    process.exit(0);
  }, stopBy - startedAt);

  let result;
  let longestCheck = 30000;
  for (let checkStart = Date.now(); ; ) {
    result = await check();
    longestCheck = Math.max(longestCheck, Date.now() - checkStart);
    if (result.status !== 'waiting' || args.once) break;
    const next = checkStart + every;
    if (next + longestCheck + 15000 > stopBy) break;
    await new Promise((r) => setTimeout(r, Math.max(0, next - Date.now())));
    checkStart = Date.now();
  }
  clearTimeout(watchdog);

  state.lastStatus = result.status;
  state.lastBooked = result.data ? result.data.booked : null;
  if (result.data) writeLead({ status: result.status, run: state.runs, checkedAt: cal.easternIso(Date.now()), ...result.data });
  else writeLead({ status: result.status, run: state.runs, checkedAt: cal.easternIso(Date.now()), customer: { id: customerId, name: result.info?.name || null } });
  finish(result.status);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      finish(`error: ${String(err.message || err).replace(/\s+/g, ' ').slice(0, 200)}`);
      process.exit(1);
    });
}
