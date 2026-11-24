#!/usr/bin/env node
// Step 3 of the weekly commission payroll: split technician production by
// clock hours and draft the Slack DMs.
//
//   node payroll/split.js --out $S
//
// Reads $S/production.json (collect.js) and $S/hours.json: the time clock
// screenshots read into [{"date":"YYYY-MM-DD","name":"Aaron K. White",
// "in":"7:55am","out":"3:30pm","total":"7h 35m"}, ...], one per row, office
// staff included (they're ignored). Writes $S/payroll.md (the summary for
// Daniel) and $S/dms.json ([{to, slack, amount, text}]), prints one JSON
// line. Exits 2 with {"errors": [...]} when a clock row can't be used.
// Sends nothing.
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('../lead-followup/lib/env');
const C = require('./lib/commission');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

function main() {
  const args = parseArgs(process.argv.slice(2), { values: ['out'] });
  if (!args.out) throw new Error('--out is required');
  const { summary } = JSON.parse(fs.readFileSync(path.join(args.out, 'production.json'), 'utf8'));
  const entries = JSON.parse(fs.readFileSync(path.join(args.out, 'hours.json'), 'utf8'));
  const hours = C.sumHours(entries, config, summary.period);
  if (hours.errors.length) {
    console.log(JSON.stringify({ errors: hours.errors }));
    process.exit(2);
  }
  const s = C.split(summary, hours, config);
  const { markdown, dms, flags } = C.report(summary, s, hours, config);
  fs.writeFileSync(path.join(args.out, 'payroll.md'), markdown);
  fs.writeFileSync(path.join(args.out, 'dms.json'), JSON.stringify(dms, null, 2));
  console.log(
    JSON.stringify({
      period: summary.period.label,
      teamProduction: s.teamProduction,
      teamHours: s.teamHours,
      ratePerHour: s.ratePerHour,
      techCommission: Object.fromEntries(s.rows.map((r) => [r.name, r.commission])),
      techTotal: s.totalCommission,
      officeCommission: Object.fromEntries(summary.office.map((r) => [r.name, r.commission])),
      dms: dms.length,
      flags: flags.length,
    }),
  );
}

try {
  main();
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
