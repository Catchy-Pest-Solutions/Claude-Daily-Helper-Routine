const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const C = require('../lib/commission');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
const period = C.payPeriod({ today: '2026-11-19' });

test('pay period: Thursday run covers Friday-Thursday', () => {
  assert.deepEqual([period.from, period.thru, period.label], ['2026-11-13', '2026-11-19', 'Fri Nov 13 – Thu Nov 19']);
});

test('pay period: holiday week run a day early (Wednesday) covers Friday-Wednesday', () => {
  const p = C.payPeriod({ today: '2026-11-25' });
  assert.deepEqual([p.from, p.thru], ['2026-11-20', '2026-11-25']);
  assert.deepEqual([C.payPeriod({ today: '2026-11-24', thru: '2026-11-25' }).from], ['2026-11-20']);
});

test('pay period: a Friday needs --from', () => {
  assert.throws(() => C.payPeriod({ today: '2026-11-20' }), /Friday/);
  assert.equal(C.payPeriod({ today: '2026-11-20', from: '2026-11-13' }).from, '2026-11-13');
});

test('durations and clock times', () => {
  assert.equal(C.parseDuration('8h 22m'), 502);
  assert.equal(C.parseDuration('47m'), 47);
  assert.equal(C.parseDuration('8:05'), 485);
  assert.equal(C.parseDuration('–'), null);
  assert.equal(C.parseClock('12:44pm') - C.parseClock('8:05am'), 279);
});

const v = (o) => ({ statusId: 'SVC_TICK_COMPLETED', appointmentTypeName: 'Regular', serviceCategoryName: 'HomeShield - Signature Pest Control', customerFirstName: 'Pat', customerLastName: 'Lee', tca: 0, sca: 0, ...o });

const visits = [
  v({ appointmentId: '1', appointmentDate: '2026-11-13', primaryTechnicianId: '17907', tca: 442 }),
  v({ appointmentId: '2', appointmentDate: '2026-11-13', primaryTechnicianId: '15724', tca: 960, appointmentTypeName: 'Initial', sca: 341.8, salesRepId: '16195' }),
  v({ appointmentId: '3', appointmentDate: '2026-11-13', primaryTechnicianId: '12883', tca: 85, appointmentTypeName: 'Inspection / Consultation', serviceCategoryName: 'Inspection / Consultation', sca: 146.76, salesRepId: '16635' }),
  v({ appointmentId: '4', appointmentDate: '2026-11-16', primaryTechnicianId: '15724', tca: 100, appointmentTypeName: 'Initial / One Time Visit', serviceCategoryName: 'One Time Service ', sca: 147.75, salesRepId: '16635' }),
  v({ appointmentId: '5', appointmentDate: '2026-11-16', primaryTechnicianId: '15724', tca: 500, statusId: 'SVC_TICK_CANCELLED' }),
  v({ appointmentId: '6', appointmentDate: '2026-11-16', primaryTechnicianId: '17907', statusId: 'SVC_TICK_ACTIVE' }),
  v({ appointmentId: '7', appointmentDate: '2026-11-16', primaryTechnicianId: '18677', statusId: 'SVC_TICK_ACTIVE', appointmentTypeName: 'Place Holder' }),
  v({ appointmentId: '8', appointmentDate: '2026-11-16', primaryTechnicianId: '15724', appointmentTypeName: 'Initial', serviceCategoryName: 'Wildlife / Rodent Trapping Service' }),
  v({ appointmentId: '9', appointmentDate: '2026-11-17', primaryTechnicianId: '99999', primaryTechnicianFirstName: 'New', primaryTechnicianLastName: 'Tech', tca: 50 }),
];

test('summarize: every completed visit counts for the tech; Daniel, cancelled and open visits do not', () => {
  const s = C.summarize(visits, config, period);
  const by = Object.fromEntries(s.techs.map((t) => [t.name, t.production]));
  assert.equal(by['Max R.'], 442);
  assert.equal(by['Sidney M.'], 1060);
  assert.equal(s.teamProduction, 1502);
  assert.equal(s.ignoredVisits, 1);
  assert.ok(s.flags.some((f) => /Still open.*Max R\./.test(f)));
  assert.ok(!s.flags.some((f) => /Still open.*Place Holder/.test(f)));
  assert.ok(s.flags.some((f) => /New Tech \(Briostack ID 99999\).*NOT in the team production/.test(f)));
  assert.ok(s.flags.some((f) => /1 initial visit\(s\) with \$0 sales commissionable have no sales rep/.test(f)));
});

test('summarize: office commission is 4% of sales commissionable on initial types, by the service sales rep, whoever the tech', () => {
  const s = C.summarize(visits, config, period);
  const by = Object.fromEntries(s.office.map((r) => [r.name, r]));
  assert.equal(by['Shelley'].sales, 341.8);
  assert.equal(by['Shelley'].commission, 13.67);
  assert.equal(by['Steve B'].sales, 294.51);
  assert.equal(by['Steve B'].commission, 11.78);
  assert.deepEqual(by['Steve B'].initials.map((l) => l.appointmentId), ['3', '4']);
});

test('summarize: office commission counts the one sale type per service category (Nov 26, 2026)', () => {
  const sales = [
    v({ appointmentId: 't1', appointmentDate: '2026-11-23', primaryTechnicianId: '15724', tca: 210, appointmentTypeName: 'Treatment', serviceCategoryName: 'Carolina TermiteShield', sca: 640.25, salesRepId: '16635' }),
    v({ appointmentId: 't2', appointmentDate: '2026-11-23', primaryTechnicianId: '15724', appointmentTypeName: 'Maintenance & Inspection', serviceCategoryName: 'Carolina TermiteShield', sca: 50, salesRepId: '16635' }),
    v({ appointmentId: 'w1', appointmentDate: '2026-11-20', primaryTechnicianId: '17907', tca: 175, appointmentTypeName: 'WDIR Inspection', serviceCategoryName: 'WDIR', sca: 270.88, salesRepId: '16635' }),
    v({ appointmentId: 'r1', appointmentDate: '2026-11-24', primaryTechnicianId: '19570', tca: 125, appointmentTypeName: 'Regular', serviceCategoryName: 'Commercial - General Pest Control', sca: 99, salesRepId: '16635' }),
    v({ appointmentId: 'i1', appointmentDate: '2026-11-24', primaryTechnicianId: '19570', appointmentTypeName: 'Initial', serviceCategoryName: 'Treatment', sca: 0 }),
    v({ appointmentId: 'q1', appointmentDate: '2026-11-24', primaryTechnicianId: '19570', appointmentTypeName: 'Initial', serviceCategoryName: 'Leads Marketing', sca: 20, salesRepId: '16635' }),
    v({ appointmentId: 'n1', appointmentDate: '2026-11-24', primaryTechnicianId: '19570', appointmentTypeName: 'Initial', serviceCategoryName: 'Gutter Guard', sca: 300, salesRepId: '16195' }),
  ];
  assert.equal(C.isSale(sales[0], config), true);
  assert.equal(C.isSale(sales[1], config), false);
  assert.equal(C.isSale(v({ appointmentTypeName: 'Treatment' }), config), false);
  const s = C.summarize(sales, config, period);
  const steve = s.office.find((r) => r.name === 'Steve B');
  assert.deepEqual(steve.initials.map((l) => l.appointmentId), ['w1', 't1']);
  assert.equal(steve.sales, 911.13);
  assert.equal(s.office.find((r) => r.name === 'Shelley').sales, 0);
  assert.ok(s.flags.some((f) => /"Gutter Guard" isn't in commissionTypes.*\$300\.00/.test(f)));
  assert.ok(!s.flags.some((f) => /Leads Marketing/.test(f)));
});

test('hours split: pooled production shared by clock hours (last week: $28,799 over 241.15 h)', () => {
  const summary = {
    period,
    teamProduction: 28799,
    techs: [
      ['15724', 'Sidney M.', 5509],
      ['15783', 'Aaron W.', 4609],
      ['17047', 'Steve H.', 4659],
      ['17829', 'Dustin M.', 4151],
      ['17907', 'Max R.', 5150],
      ['19570', 'Joey J.', 4721],
    ].map(([id, name, production]) => ({ id, name, production, byDay: {} })),
    office: [],
    flags: [],
  };
  const minutes = { 15724: 2534, 15783: 2499, 17047: 2570, 17829: 2021, 17907: 2375, 19570: 2470 };
  const s = C.split(summary, { minutes, days: {} }, config);
  const by = Object.fromEntries(s.rows.map((r) => [r.name, r.commission]));
  assert.deepEqual(by, { 'Sidney M.': 302.62, 'Aaron W.': 298.44, 'Steve H.': 306.92, 'Dustin M.': 241.36, 'Max R.': 283.63, 'Joey J.': 294.98 });
  assert.equal(s.teamHours, 241.15);
  assert.equal(s.perHour, 119.42);
  assert.ok(Math.abs(s.totalCommission - 0.06 * 28799) < 0.05);
});

test('sumHours: adds split shifts, skips entries with no total, ignores office staff, rejects unknown names', () => {
  const entries = [
    { date: '2026-11-18', name: 'Aaron K. White', in: '3:45pm', out: '4:32pm', total: '47m' },
    { date: '2026-11-18', name: 'Aaron K. White', in: '7:55am', out: '3:30pm', total: '7h 35m' },
    { date: '2026-11-19', name: 'Robert S. Hayden', in: '', out: '5:08pm', total: '–' },
    { date: '2026-11-19', name: 'Robert S. Hayden', in: '8:20am', out: '5:07pm', total: '8h 47m' },
    { date: '2026-11-19', name: 'Steve Barona', in: '10:05am', out: '5:08pm', total: '7h 03m' },
    { date: '2026-11-19', name: 'Maxim W. Rockwell', in: '8:02am', out: '3:03pm', total: '7h 10m' },
  ];
  const h = C.sumHours(entries, config, period);
  assert.equal(h.minutes['15783'], 502);
  assert.equal(h.minutes['17047'], 527);
  assert.equal(h.errors.length, 0);
  assert.ok(h.flags.some((f) => /Skipped Steve H\. Thu Nov 19/.test(f)));
  assert.ok(h.flags.some((f) => /Max R\. Thu Nov 19: 8:02am–3:03pm is 421 min/.test(f)));
  assert.ok(h.flags.some((f) => /No time clock entries at all for Fri Nov 13/.test(f)));
  const bad = C.sumHours([{ date: '2026-11-19', name: 'Someone New', total: '8h' }], config, period);
  assert.equal(bad.errors.length, 1);
});

test('DMs: tech DM has no own-production line; office DM lists every initial', () => {
  const t = C.techDm({ first: 'Sidney', hours: 42.23, commission: 302.62 }, { teamProduction: 28799, teamHours: 241.15, perHour: 119.42 }, config, period);
  assert.match(t, /Hi Sidney, here's your production commission for Fri Nov 13 – Thu Nov 19/);
  assert.match(t, /6% × \$119\.42 × 42\.23 = \*\$302\.62\*/);
  assert.doesNotMatch(t, /You completed/);
  assert.match(t, /– Daniel$/);
  const s = C.summarize(visits, config, period);
  const steve = s.office.find((r) => r.name === 'Steve B');
  const o = C.officeDm({ ...steve, first: 'Steve' }, config, period);
  assert.match(o, /2 completed initial visits/);
  assert.match(o, /Nov 13 — Pat Lee — Inspection \/ Consultation \(Inspection \/ Consultation\) — \$146\.76/);
  assert.match(o, /4% × \$294\.51 = \*\$11\.78\*/);
});
