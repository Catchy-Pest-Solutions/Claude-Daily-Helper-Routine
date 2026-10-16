#!/usr/bin/env node
// ATS (Voice for Pest) calls and their AI transcripts for one day.
//
// Usage: node src/atsTranscripts.js [--date YYYY-MM-DD] [--phone NUMBER]
//          [--direction inbound|outbound] [--out FILE]
//
// --date is an Eastern date (default today). --phone keeps only calls to or
// from that number. Prints one short block per call (time, direction,
// number, who handled it, menu choice, the AI summary) and writes every
// call, full transcript included, as JSON to --out (default
// ats-transcripts-<date>.json in the system temp directory; it holds
// customer conversations, so keep it out of the repo). Full transcripts are
// left out of the printout on purpose: read them from the file only for the
// calls that need them.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

try {
  process.loadEnvFile(path.join(__dirname, '..', '..', '.env'));
} catch {
  // .env not present; rely on already-exported env vars.
}

const cal = require('./callReview/calendar');
const config = require('./callReview/config');
const { createAtsClient } = require('./callReview/atsClient');
const { groupCalls, classifyCall, normalizePhone, formatPhone, OUTCOME_TEXT } = require('./callReview/callAnalysis');

const MENU = { new: 'pressed 1 (new customer)', current: 'pressed 2 (current customer)' };

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(date|phone|direction|out)$/.exec(argv[i]);
    if (!m || argv[i + 1] === undefined) throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    args[m[1]] = argv[++i];
  }
  if (args.date && !/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error('--date must be YYYY-MM-DD');
  if (args.phone && !normalizePhone(args.phone)) throw new Error('--phone must be a 10-digit US number');
  if (args.direction && !['inbound', 'outbound'].includes(args.direction)) throw new Error('--direction must be inbound or outbound');
  return args;
}

// One call as the JSON file stores it.
function callRecord(c, transcript) {
  const staffExt = c.agent || null;
  return {
    callId: c.id,
    direction: c.direction,
    start: cal.easternIso(c.startMs),
    phone: c.phone,
    callerIdName: c.direction === 'inbound' ? c.callerName : null,
    staff: staffExt ? config.staff[staffExt]?.name || `ext ${staffExt}` : null,
    menuChoice: c.direction === 'inbound' ? c.callerType : null,
    answered: c.direction === 'inbound' ? c.answered : null,
    outcome: c.answered === false ? OUTCOME_TEXT[c.outcome] : null,
    talkSec: c.talkSec || 0,
    end: cal.easternIso(c.endMs),
    transcript: transcript
      ? { id: transcript.id, callTimeUtc: transcript.call_time, summary: transcript.summary, transcription: transcript.transcription }
      : null,
  };
}

function describe(r, nowMs) {
  const head = [
    cal.formatTime(Date.parse(r.start)),
    r.direction.padEnd(8),
    formatPhone(r.phone),
    r.callerIdName,
    r.direction === 'inbound' ? (r.answered ? `answered by ${r.staff}` : `missed, ${r.outcome}`) : `by ${r.staff || 'office'}`,
    r.talkSec ? cal.formatDuration(r.talkSec) : null,
    r.direction === 'inbound' && r.menuChoice ? MENU[r.menuChoice] : null,
    `call ${r.callId}`,
  ].filter(Boolean);
  let body;
  if (r.transcript) body = `  Summary: ${r.transcript.summary}`;
  else if (r.talkSec && nowMs - Date.parse(r.end) < 30 * 60 * 1000) {
    body = `  No transcript yet (call ended ${Math.round((nowMs - Date.parse(r.end)) / 60000)} min ago; they take a few minutes).`;
  }
  else body = '  No transcript (no conversation was recorded).';
  return `${head.join(' | ')}\n${body}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const nowMs = Date.now();
  const date = args.date || cal.toEastern(nowMs).date;
  const startMs = cal.easternToMs(date);
  const endMs = Math.min(cal.easternToMs(cal.addDays(date, 1)), nowMs);
  if (endMs <= startMs) throw new Error(`${date} hasn't started yet in Eastern time`);

  const ats = createAtsClient({ username: process.env.ATS_USERNAME, password: process.env.ATS_PASSWORD, customerId: config.atsCustomerId });
  const calls = groupCalls(await ats.searchCalls(startMs, endMs))
    .map((c) => classifyCall(c, config))
    .filter((c) => c.direction !== 'internal');
  const { transcripts, complete, pages } = await ats.searchTranscripts(startMs);
  const byCallId = new Map(transcripts.filter((t) => cal.parseAtsUtc(t.call_time) < endMs).map((t) => [t.cdr_id, t]));

  const phone = args.phone && normalizePhone(args.phone);
  const records = calls
    .filter((c) => !phone || c.phone === phone)
    .filter((c) => !args.direction || c.direction === args.direction)
    .map((c) => callRecord(c, byCallId.get(c.id)));

  const out = path.resolve(args.out || path.join(os.tmpdir(), `ats-transcripts-${date}.json`));
  fs.writeFileSync(out, JSON.stringify({ date, generatedAt: cal.easternIso(nowMs), transcriptFeedComplete: complete, calls: records }, null, 2) + '\n');

  const lines = [
    `ATS calls for ${cal.formatDay(startMs)}${phone ? ` with ${formatPhone(phone)}` : ''}${args.direction ? ` (${args.direction} only)` : ''}: ` +
      `${records.length} call${records.length === 1 ? '' : 's'}, ${records.filter((r) => r.transcript).length} with transcripts.`,
    `Full data and transcripts saved to ${out}`,
    complete ? null : `WARNING: stopped after ${pages} transcript pages before reaching the start of ${date}; some transcripts may be missing.`,
    '',
    ...records.map((r) => describe(r, nowMs)),
  ].filter((l) => l !== null);
  process.stdout.write(lines.join('\n') + '\n');
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`atsTranscripts failed: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { parseArgs, callRecord };
