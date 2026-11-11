#!/usr/bin/env node
// After send.js: the reply for each tech's post, read from the Leads sheet
// so the bonus and the week total match what payroll will pay.
//
//   node tech-notes.js --posts $S/posts.json --decisions $S/decisions.json
//
// Prints {"notes": [{ts, tech, text}]}. One note per post:
//   counted   "Quote sent to Karen Gerry (TermiteShield, $399). $2 bonus
//              added, thank you Aaron! Your bonuses this pay week (Nov 5 -
//              Nov 11): $8."
//   no bonus  the same "Quote sent" line, then the decision's techMessage
//              (what was missing) and the week total.
//   skip/ask  the decision's techMessage as written.
// Posts nothing: the routine replies in each post's thread with Slack.
require('../lead-followup/lib/proxy');
const fs = require('node:fs');
const { parseArgs } = require('../lead-followup/lib/env');
const { loadConfig } = require('./lib/common');
const sheet = require('./lib/sheet');

const money = (n) => `$${(Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0)}`;
const SHORT_PLAN = { signature: 'Signature', critter: 'Critter Control', termite: 'TermiteShield', bat: 'Bat Remediation' };

function notesFor({ decisions, posts, rows }) {
  const byPost = (ts) => rows.filter((r) => String(r['Post ID']).split(':')[0] === ts);
  const weekTotal = (tech, week) => rows.filter((r) => r.Tech === tech && r['Pay week'] === week && r.Counted === 'yes').reduce((s, r) => s + sheet.toNumber(r.Bonus), 0);
  const notes = [];
  const seen = new Set();
  const add = (ts, d, merged) => {
    if (seen.has(ts)) return;
    seen.add(ts);
    const post = posts.find((p) => p.ts === ts);
    if (!post) return;
    const first = post.tech?.name || 'there';
    if (d.action === 'skip' || d.action === 'ask') {
      if (d.techMessage) notes.push({ ts, tech: post.tech?.fullName, text: d.techMessage });
      return;
    }
    if (d.action === 'quote' && d.plan === 'bat' && !d.bat?.approved) {
      notes.push({ ts, tech: post.tech?.fullName, text: `Thanks ${first}! The bat quote is with Daniel for approval; your bonus is added when it goes out to the customer.` });
      return;
    }
    const mine = byPost(ts);
    if (!mine.length) return; // not on the sheet (send failed or already_sent from an older run)
    const bonus = mine.filter((r) => r.Counted === 'yes').reduce((s, r) => s + sheet.toNumber(r.Bonus), 0);
    const week = mine[0]['Pay week'] || sheet.payWeekOf(mine[0]['Visit date']);
    const tech = mine[0].Tech;
    const quoted = mine.find((r) => r.Quote);
    const what = d.action === 'quote'
      ? `Quote sent to ${mine[0].Customer}${quoted ? ` (${SHORT_PLAN[d.plan] || quoted.Plan}, ${quoted.Quote})` : merged ? ' (same quote as your other post)' : ''}.`
      : `Sent to the office to price for ${mine[0].Customer}.`;
    const pay = bonus > 0 ? `${money(bonus)} bonus added, thank you ${first}!` : (merged?.techMessage || d.techMessage || 'No bonus on this one.');
    notes.push({ ts, tech, text: `${what} ${pay} Your bonuses this pay week (${week.replace(/, \d{4}$/, '')}): ${money(weekTotal(tech, week))}.` });
  };
  for (const d of decisions) {
    add(d.ts, d, null);
    for (const a of d.alsoPosts || []) add(a.ts, d, a);
  }
  return notes;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { values: ['posts', 'decisions'] });
  if (!args.posts || !args.decisions) throw new Error('usage: tech-notes.js --posts posts.json --decisions decisions.json');
  const config = loadConfig();
  const sheetId = config.testMode !== false ? config.sheet.testId : config.sheet.liveId;
  const { posts } = JSON.parse(fs.readFileSync(args.posts, 'utf8'));
  const { decisions } = JSON.parse(fs.readFileSync(args.decisions, 'utf8'));
  const rows = (await sheet.readSheet(sheetId)).items.map((r) => ({ ...r, 'Pay week': r['Pay week'] || sheet.payWeekOf(r['Visit date']) }));
  process.stdout.write(`${JSON.stringify({ notes: notesFor({ decisions, posts, rows }) })}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stdout.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  });
}

module.exports = { notesFor };
