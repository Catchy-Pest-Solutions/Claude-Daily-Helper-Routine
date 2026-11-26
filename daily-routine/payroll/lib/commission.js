// Pure math for the weekly commission payroll (no API calls), so it can be
// tested. See payroll/README.md for the rules and where they came from.
const cal = require('../../src/callReview/calendar');

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n) => `$${round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (ymd) => `${MON[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}`;
const dayDate = (ymd) => `${DAY[cal.weekdayOf(ymd)]} ${shortDate(ymd)}`;
const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

// Pay period is Friday through Thursday. thru defaults to today (Eastern);
// from is the Friday on or before thru. A holiday week run early (e.g. on
// Wednesday) just passes an earlier thru; the next period still starts on
// the following Friday.
function payPeriod({ today, from, thru } = {}) {
  const end = thru || today;
  if (!isYmd(end)) throw new Error(`bad date: ${end}`);
  let start = from;
  if (!start) {
    if (cal.weekdayOf(end) === 5) throw new Error(`${end} is a Friday (the first day of a pay period); pass --from to say which period you mean`);
    start = end;
    while (cal.weekdayOf(start) !== 5) start = cal.addDays(start, -1);
  }
  if (!isYmd(start) || start > end) throw new Error(`bad pay period ${start} .. ${end}`);
  return { from: start, thru: end, label: `${dayDate(start)} – ${dayDate(end)}` };
}

const custName = (a) =>
  [a.customerFirstName, a.customerLastName]
    .filter((x) => x && x !== 'null')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || `customer ${a.customerId}`;

// Office commission counts one appointment type per service category
// (config.commissionTypes, Daniel Nov 26, 2026): Treatment for TermiteShield,
// WDIR Inspection for WDIR, Initial for most. Category names are trimmed.
const category = (a) => String(a.serviceCategoryName || '').trim();
const isSale = (a, config) => {
  const t = config.commissionTypes[category(a)];
  return !!t && t === a.appointmentTypeName;
};

// visits: list records for the period, each merged with its detail record's
// technicianCommissionableAmount / salesCommissionableAmount (as tca / sca)
// and, for initial types, the service's primary sales rep (salesRepId,
// salesRepName). Returns the production and office summaries plus flags.
function summarize(visits, config, period) {
  const techById = Object.fromEntries(config.techs.map((t) => [t.id, t]));
  const repById = Object.fromEntries(config.officeReps.map((r) => [r.id, r]));
  const done = new Set(config.doneStatuses);
  const noCommission = new Set(config.noCommissionCategories || []);
  const unknownCategories = {};
  const flags = [];

  const techs = Object.fromEntries(config.techs.map((t) => [t.id, { id: t.id, name: t.name, production: 0, visits: 0, byDay: {} }]));
  const office = Object.fromEntries(config.officeReps.map((r) => [r.id, { id: r.id, name: r.name, sales: 0, initials: [] }]));
  const unknownTechs = {};
  const noRep = [];
  const otherRep = [];
  const openVisits = [];
  const notCompleted = [];
  let ignored = 0;

  for (const a of visits) {
    const techId = a.primaryTechnicianId || '';
    if (a.statusId === config.openStatus) {
      if (techById[techId] && a.appointmentTypeName !== 'Place Holder') openVisits.push(a);
      continue;
    }
    if (!done.has(a.statusId)) continue;
    if (a.statusId !== 'SVC_TICK_COMPLETED') notCompleted.push(a);
    const tca = Number(a.tca) || 0;
    const sca = Number(a.sca) || 0;

    if (techById[techId]) {
      const t = techs[techId];
      t.production += tca;
      t.visits++;
      t.byDay[a.appointmentDate] = (t.byDay[a.appointmentDate] || 0) + tca;
    } else if (config.ignoreTechIds[techId]) {
      ignored++;
    } else {
      const k = techId || 'unassigned';
      const u = (unknownTechs[k] ||= { id: techId, name: `${a.primaryTechnicianFirstName || ''} ${a.primaryTechnicianLastName || ''}`.trim() || 'no technician', production: 0, visits: 0 });
      u.production += tca;
      u.visits++;
    }

    if (!config.commissionTypes[category(a)] && !noCommission.has(category(a)) && sca > 0) {
      const u = (unknownCategories[category(a) || '(no category)'] ||= { visits: 0, sca: 0, types: new Set() });
      u.visits++;
      u.sca += sca;
      u.types.add(a.appointmentTypeName);
    }
    if (isSale(a, config)) {
      const line = { date: a.appointmentDate, appointmentId: a.appointmentId, customer: custName(a), type: a.appointmentTypeName, category: (a.serviceCategoryName || '').trim(), sca };
      if (repById[a.salesRepId]) {
        office[a.salesRepId].sales += sca;
        office[a.salesRepId].initials.push(line);
      } else if (a.salesRepId) {
        otherRep.push({ ...line, rep: a.salesRepName || a.salesRepId });
      } else {
        noRep.push(line);
      }
    }
  }

  for (const t of Object.values(techs)) t.production = round2(t.production);
  const teamProduction = round2(Object.values(techs).reduce((s, t) => s + t.production, 0));
  for (const r of Object.values(office)) {
    r.sales = round2(r.sales);
    r.commission = round2(r.sales * config.officeRate);
    r.initials.sort((x, y) => (x.date + x.appointmentId).localeCompare(y.date + y.appointmentId));
  }

  for (const u of Object.values(unknownTechs)) {
    if (u.production > 0 || u.id) flags.push(`${u.name}${u.id ? ` (Briostack ID ${u.id})` : ''} completed ${u.visits} visit(s) worth ${money(u.production)} but isn't in payroll/config.json, so it's NOT in the team production. Ask Daniel whether to add them.`);
  }
  for (const a of openVisits) flags.push(`Still open (not completed, not counted): ${dayDate(a.appointmentDate)} ${custName(a)}, ${a.appointmentTypeName}, ${techById[a.primaryTechnicianId].name} (appt ${a.appointmentId}). If it was done, have it completed in Briostack and run again; it won't count in a later week.`);
  if (notCompleted.length) flags.push(`${notCompleted.length} visit(s) are ${[...new Set(notCompleted.map((a) => a.statusId))].join('/')} rather than Completed; counted as done.`);
  for (const l of noRep) {
    if (l.sca > 0) flags.push(`No primary sales rep on the service: ${shortDate(l.date)} ${l.customer}, ${l.category} ${l.type}, ${money(l.sca)} sales commissionable (appt ${l.appointmentId}). Not paid to anyone; set the rep in Briostack and run again.`);
  }
  const zeroNoRep = noRep.filter((l) => !(l.sca > 0)).length;
  if (zeroNoRep) flags.push(`${zeroNoRep} initial visit(s) with $0 sales commissionable have no sales rep (no effect on pay).`);
  for (const [c, u] of Object.entries(unknownCategories)) flags.push(`Service category "${c}" isn't in commissionTypes in payroll/config.json: ${u.visits} completed visit(s) (${[...u.types].join(', ')}) with ${money(u.sca)} sales commissionable NOT paid to anyone. Ask Daniel which appointment type is the sale for it.`);
  for (const l of otherRep) flags.push(`Sales rep ${l.rep} isn't an office rep: ${shortDate(l.date)} ${l.customer}, ${l.category} ${l.type}, ${money(l.sca)} (appt ${l.appointmentId}). Not paid.`);

  return { period, teamProduction, techs: config.techs.map((t) => techs[t.id]), office: config.officeReps.map((r) => office[r.id]), ignoredVisits: ignored, flags };
}

// "8h 22m", "47m", "8:22", "8h" -> minutes. Returns null for "–" / blank.
function parseDuration(s) {
  const str = String(s ?? '').trim();
  let m = str.match(/^(\d+):(\d{2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = str.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/i);
  if (m && (m[1] || m[2])) return Number(m[1] || 0) * 60 + Number(m[2] || 0);
  return null;
}

// "8:05am" -> minutes after midnight.
function parseClock(s) {
  const m = String(s ?? '').trim().match(/^(\d{1,2}):(\d{2})\s*([ap])m$/i);
  if (!m) return null;
  return ((Number(m[1]) % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0)) * 60 + Number(m[2]);
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

// entries: [{date, name, in, out, total}] read off the time clock
// screenshots. Sums minutes per field tech, checks each total against
// in/out, and flags anything odd. Office staff entries are ignored.
function sumHours(entries, config, period) {
  const byClock = {};
  for (const t of config.techs) for (const n of t.clock) byClock[norm(n)] = t;
  const officeNames = new Set(config.officeClockNames.map(norm));
  const minutes = Object.fromEntries(config.techs.map((t) => [t.id, 0]));
  const days = Object.fromEntries(config.techs.map((t) => [t.id, new Set()]));
  const flags = [];
  const errors = [];
  const seenDates = new Set();

  for (const e of entries) {
    const t = byClock[norm(e.name)];
    if (!isYmd(e.date) || e.date < period.from || e.date > period.thru) {
      errors.push(`Clock entry outside the pay period ${period.from}..${period.thru}: ${JSON.stringify(e)}`);
      continue;
    }
    seenDates.add(e.date);
    if (!t) {
      if (!officeNames.has(norm(e.name))) errors.push(`Unknown name on the time clock: "${e.name}" (${e.date}). Add it to a tech's "clock" names or to officeClockNames in payroll/config.json.`);
      continue;
    }
    const total = parseDuration(e.total);
    const span = parseClock(e.in) !== null && parseClock(e.out) !== null ? parseClock(e.out) - parseClock(e.in) : null;
    if (total === null) {
      flags.push(`Skipped ${t.name} ${dayDate(e.date)} ${e.in || '?'}–${e.out || '?'}: no total on the time clock (an open or duplicate entry?). Fix it in the time clock and resend if it was real time.`);
      continue;
    }
    if (span !== null && Math.abs(span - total) > 1) flags.push(`${t.name} ${dayDate(e.date)}: ${e.in}–${e.out} is ${span} min but the total says ${e.total}. Used the total; check the screenshot reading.`);
    minutes[t.id] += total;
    days[t.id].add(e.date);
  }
  for (let d = period.from; d <= period.thru; d = cal.addDays(d, 1)) {
    if (!seenDates.has(d) && cal.weekdayOf(d) >= 1 && cal.weekdayOf(d) <= 5) flags.push(`No time clock entries at all for ${dayDate(d)}. Was a screenshot missed?`);
  }
  return { minutes, days: Object.fromEntries(Object.entries(days).map(([k, v]) => [k, [...v].sort()])), flags, errors };
}

const hoursText = (min) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;

// Pool all field-tech production and split it by clock hours:
// commission = techRate × (team production ÷ team hours) × tech hours.
function split(summary, hours, config) {
  const totalMin = Object.values(hours.minutes).reduce((s, m) => s + m, 0);
  if (!totalMin) throw new Error('no technician hours');
  const P = summary.teamProduction;
  const perHour = P / (totalMin / 60);
  const flags = [];
  const rows = summary.techs.map((t) => {
    const min = hours.minutes[t.id] || 0;
    const workedDays = Object.keys(t.byDay);
    const clockDays = hours.days[t.id] || [];
    for (const d of workedDays) if (!clockDays.includes(d)) flags.push(`${t.name} completed visits on ${dayDate(d)} but has no clock time that day.`);
    return { ...t, minutes: min, hours: round2(min / 60), commission: round2((config.techRate * P * min) / totalMin) };
  });
  return {
    teamProduction: P,
    teamMinutes: totalMin,
    teamHours: round2(totalMin / 60),
    perHour: round2(perHour),
    ratePerHour: round2(config.techRate * perHour),
    totalCommission: round2(rows.reduce((s, r) => s + r.commission, 0)),
    rows,
    flags,
  };
}

function techDm(row, s, config, period) {
  return [
    `Hi ${row.first}, here's your production commission for ${period.label}:`,
    `• Team production: ${money(s.teamProduction)} over ${s.teamHours} tech hours = ${money(s.perHour)}/hr`,
    `• Your hours: ${row.hours}`,
    `• Commission: ${Math.round(config.techRate * 100)}% × ${money(s.perHour)} × ${row.hours} = *${money(row.commission)}*`,
    `Thanks for all the hard work this week! ${config.signOff}`,
  ].join('\n');
}

function officeDm(rep, config, period) {
  const pct = `${Math.round(config.officeRate * 100)}%`;
  const lines = [`Hi ${rep.first}, here's your office commission for ${period.label}:`];
  if (!rep.initials.length) {
    lines.push('• No completed initial visits with you as the sales rep this week.');
  } else {
    lines.push(`• ${rep.initials.length} completed initial visit${rep.initials.length === 1 ? '' : 's'} where you're the sales rep:`);
    for (const l of rep.initials) lines.push(`    ◦ ${shortDate(l.date)} — ${l.customer} — ${l.category} (${l.type}) — ${money(l.sca)}`);
    lines.push(`• Sales commissionable total: ${money(rep.sales)}`);
    lines.push(`• Commission: ${pct} × ${money(rep.sales)} = *${money(rep.commission)}*`);
  }
  lines.push(`Thanks! ${config.signOff}`);
  return lines.join('\n');
}

// Everything Daniel sees in the conversation and the DMs he approves.
function report(summary, s, hours, config) {
  const { period } = summary;
  const repCfg = Object.fromEntries(config.officeReps.map((r) => [r.id, r]));
  const techCfg = Object.fromEntries(config.techs.map((t) => [t.id, t]));
  const md = [];
  md.push(`# Commission payroll: ${period.label}`, '');
  md.push(`## Technician production commission (${Math.round(config.techRate * 100)}%, split by hours)`, '');
  md.push(`Team production ${money(s.teamProduction)} ÷ ${s.teamHours} tech hours = ${money(s.perHour)}/hr → ${money(s.ratePerHour)} per hour worked.`, '');
  md.push('| Tech | Hours | Own production | Commission |', '|---|---|---|---|');
  for (const r of s.rows) md.push(`| ${r.name} | ${hoursText(r.minutes)} (${r.hours}) | ${money(r.production)} | **${money(r.commission)}** |`);
  md.push(`| **Total** | ${hoursText(s.teamMinutes)} (${s.teamHours}) | ${money(s.teamProduction)} | **${money(s.totalCommission)}** |`, '');
  md.push(`## Office commission (${Math.round(config.officeRate * 100)}% of sales commissionable, completed initial-type visits)`, '');
  md.push('| Rep | Initials | Sales commissionable | Commission |', '|---|---|---|---|');
  for (const r of summary.office) md.push(`| ${r.name} | ${r.initials.length} | ${money(r.sales)} | **${money(r.commission)}** |`);
  md.push('');
  md.push('## Daily production check', '');
  const dates = [];
  for (let d = period.from; d <= period.thru; d = cal.addDays(d, 1)) dates.push(d);
  md.push(`| Day | ${summary.techs.map((t) => t.name).join(' | ')} | Total |`, `|---|${summary.techs.map(() => '---').join('|')}|---|`);
  for (const d of dates) {
    const vals = summary.techs.map((t) => t.byDay[d] || 0);
    if (!vals.some((v) => v) && cal.weekdayOf(d) % 6 === 0) continue; // empty weekend day
    md.push(`| ${dayDate(d)} | ${vals.map((v) => (v ? money(v) : '—')).join(' | ')} | ${money(vals.reduce((a, b) => a + b, 0))} |`);
  }
  md.push('');
  const flags = [...summary.flags, ...hours.flags, ...s.flags];
  md.push('## Check these', '');
  md.push(...(flags.length ? flags.map((f) => `- ${f}`) : ['- Nothing unusual.']), '');

  const dms = [];
  for (const r of s.rows) {
    const t = techCfg[r.id];
    if (!r.minutes && !r.production) continue;
    dms.push({ to: t.name, slack: t.slack, amount: r.commission, text: techDm({ ...r, first: t.first }, s, config, period) });
  }
  for (const r of summary.office) {
    const c = repCfg[r.id];
    if (c.noDm) continue;
    dms.push({ to: c.name, slack: c.slack, amount: r.commission, text: officeDm({ ...r, first: c.first }, config, period) });
  }
  const daniel = summary.office.find((r) => repCfg[r.id].noDm && r.initials.length);
  if (daniel) md.push(`Daniel's own initials as sales rep: ${daniel.initials.length}, ${money(daniel.sales)} sales commissionable (${money(daniel.commission)} at ${Math.round(config.officeRate * 100)}%, no DM).`, '');
  return { markdown: md.join('\n'), dms, flags };
}

module.exports = { isSale, round2, money, payPeriod, summarize, parseDuration, parseClock, sumHours, split, techDm, officeDm, report, dayDate, hoursText };
