#!/usr/bin/env node
// Step 1 of the weekly commission payroll: pull the pay period's visits
// from Briostack and total technician production and office sales.
//
//   node payroll/collect.js --out $S [--thru YYYY-MM-DD] [--from YYYY-MM-DD] [--today YYYY-MM-DD]
//
// Period: Friday through --thru (default today, Eastern). Run a day early
// for a holiday with --thru <that day> (the default when run that day).
//
// Calls: ~4 list pages for the period, one GET appointments/{id} per done
// visit (only the detail record has technicianCommissionableAmount and
// salesCommissionableAmount, Nov 24, 2026), and one customers/{id}/services
// per customer with a commission-type visit (config.commissionTypes) (the sales rep is on the service).
// About 350 calls / 3 minutes for a normal week. Writes $S/production.json
// and prints one JSON line. Sends nothing.
require('../lead-followup/lib/proxy');
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('../lead-followup/lib/env');
const { createBriostack } = require('../lead-followup/lib/briostack');
const cal = require('../src/callReview/calendar');
const C = require('./lib/commission');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

async function main() {
  const args = parseArgs(process.argv.slice(2), { values: ['out', 'thru', 'from', 'today'] });
  if (!args.out) throw new Error('--out is required');
  fs.mkdirSync(args.out, { recursive: true });
  const period = C.payPeriod({ today: args.today || cal.toEastern(Date.now()).date, from: args.from, thru: args.thru });
  const bs = createBriostack({ pauseMs: 250 });

  const list = [];
  for (let start = 0; start < 5000; start += 100) {
    const page = await bs.listAppointmentsBetween(period.from, period.thru, start);
    list.push(...page);
    if (page.length < 100) break;
  }
  const done = new Set(config.doneStatuses);
  const visits = list.filter((a) => a.appointmentDate >= period.from && a.appointmentDate <= period.thru);

  for (const a of visits) {
    if (!done.has(a.statusId)) continue;
    const d = await bs.getAppointment(a.appointmentId);
    if (!d || d.appointmentId !== a.appointmentId) throw new Error(`appointment ${a.appointmentId}: unexpected detail response`);
    a.tca = Number(d.technicianCommissionableAmount) || 0;
    a.sca = Number(d.salesCommissionableAmount) || 0;
  }

  const needRep = visits.filter((a) => done.has(a.statusId) && C.isSale(a, config));
  const services = {};
  for (const cid of [...new Set(needRep.map((a) => a.customerId))]) {
    for (const s of await bs.getServices(cid)) services[s.serviceId] = s;
  }
  for (const a of needRep) {
    const s = services[a.serviceId];
    a.salesRepId = s?.primarySalesRepId || '';
    a.salesRepName = s?.primarySalesRepName || '';
  }

  const summary = C.summarize(visits, config, period);
  fs.writeFileSync(path.join(args.out, 'production.json'), JSON.stringify({ summary, visits }, null, 2));
  console.log(
    JSON.stringify({
      period: period.label,
      from: period.from,
      thru: period.thru,
      teamProduction: summary.teamProduction,
      techs: Object.fromEntries(summary.techs.map((t) => [t.name, t.production])),
      office: Object.fromEntries(summary.office.map((r) => [r.name, { initials: r.initials.length, sales: r.sales, commission: r.commission }])),
      flags: summary.flags,
      briostackCalls: bs.requestCount(),
    }),
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
