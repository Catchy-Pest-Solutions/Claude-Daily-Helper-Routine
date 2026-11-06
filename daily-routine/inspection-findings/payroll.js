#!/usr/bin/env node
// Thursday step of the inspection findings routine: the pay-week bonus
// summary for Daniel.
//
//   node payroll.js --out $S [--now ISO]
//
// Pay period is Friday-Thursday and payroll runs Thursday evening, so
// Thursday's 8 AM run covers posts from the previous Thursday through
// yesterday (Wednesday); Thursday's own posts roll into next week. Reads the
// Leads sheet (so Daniel's hand edits to Bonus stick), totals each tech's
// counted bonuses, and flags any tech who worked 3+ days (completed
// Briostack appointments, filtered by appointmentDate) with no counted
// lead. Writes $S/payroll.json and $S/payroll.md (the Slack message) and
// prints one JSON line. Sends nothing: the routine posts payroll.md to
// Daniel in Slack.
require('../lead-followup/lib/proxy');
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('../lead-followup/lib/env');
const { createBriostack } = require('../lead-followup/lib/briostack');
const cal = require('../src/callReview/calendar');
const { loadConfig } = require('./lib/common');
const sheet = require('./lib/sheet');

const LOW_PARTICIPATION_DAYS = 3;

function payWindow(today) {
  // The Thursday on or before today, minus 7 days .. yesterday.
  let thu = today;
  while (cal.weekdayOf(thu) !== 4) thu = cal.addDays(thu, -1);
  return { start: cal.addDays(thu, -7), end: cal.addDays(thu, -1) };
}

function summarize(rows, techs, window, daysWorked = {}) {
  const inWindow = rows.filter((r) => sheet.toYmd(r['Visit date']) >= window.start && sheet.toYmd(r['Visit date']) <= window.end);
  const byTech = {};
  for (const t of techs) byTech[t.fullName] = { tech: t.fullName, employeeId: t.employeeId, total: 0, counted: 0, notCounted: 0, leads: [] };
  for (const r of inWindow) {
    const t = byTech[r.Tech] || (byTech[r.Tech] = { tech: r.Tech, total: 0, counted: 0, notCounted: 0, leads: [] });
    if (r.Counted === 'yes') {
      t.counted++;
      t.total += sheet.toNumber(r.Bonus);
      t.leads.push(`${r.Customer} (${r.Plan || r.Finding}) $${sheet.toNumber(r.Bonus)}`);
    } else t.notCounted++;
  }
  const list = Object.values(byTech).map((t) => ({ ...t, total: Math.round(t.total * 100) / 100, daysWorked: daysWorked[t.employeeId] ?? null }));
  for (const t of list) t.lowParticipation = t.daysWorked != null && t.daysWorked >= LOW_PARTICIPATION_DAYS && t.counted === 0;
  return list.sort((a, b) => b.total - a.total || a.tech.localeCompare(b.tech));
}

const money = (n) => `$${(Math.round(n * 100) / 100).toFixed(n % 1 ? 2 : 0)}`;

function message(list, window, url, test) {
  const lines = [
    `${test ? '[TEST] ' : ''}*Inspection findings bonuses: ${sheet.payWeekOf(window.start)}*`,
    "Visits Thursday through Wednesday. Today's visits roll into next week.",
    '',
    ...list.map((t) => `• ${t.tech}: *${money(t.total)}* (${t.counted} counted${t.notCounted ? `, ${t.notCounted} didn't count` : ''}${t.daysWorked != null ? `, worked ${t.daysWorked} day${t.daysWorked === 1 ? '' : 's'}` : ''})${t.lowParticipation ? ' ⚠️ no counted leads' : ''}`),
    '',
    `*Total: ${money(list.reduce((s, t) => s + t.total, 0))}*`,
    `Sheet (edit any bonus there and the totals update): ${url}`,
  ];
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { values: ['out', 'now'] });
  if (!args.out) throw new Error('usage: payroll.js --out DIR [--now ISO]');
  const config = loadConfig();
  const test = config.testMode !== false;
  const sheetId = test ? config.sheet.testId : config.sheet.liveId;
  if (!sheetId) throw new Error('no Leads sheet in config.json (run setup-sheet.js)');
  const today = cal.toEastern(args.now ? Date.parse(args.now) : Date.now()).date;
  const window = payWindow(today);
  const rows = (await sheet.readSheet(sheetId)).items;
  const techs = Object.values(config.technicians);

  // Days each tech worked: completed appointments per day in the window.
  const brio = createBriostack({ pauseMs: 900 });
  const worked = {};
  for (let d = window.start; d <= window.end; d = cal.addDays(d, 1)) {
    const ids = new Set();
    for (let start = 0; start < 1000; start += 100) {
      const page = await brio.listAppointmentsOn(d, start);
      page.filter((a) => a.statusId === 'SVC_TICK_COMPLETED' && a.primaryTechnicianId).forEach((a) => ids.add(String(a.primaryTechnicianId)));
      if (page.length < 100) break;
    }
    for (const t of techs) if ([t.employeeId, ...(t.otherEmployeeIds || [])].some((id) => ids.has(id))) worked[t.employeeId] = (worked[t.employeeId] || 0) + 1;
  }

  const list = summarize(rows, techs, window, worked);
  const md = message(list, window, sheet.sheetUrl(sheetId), test);
  fs.mkdirSync(args.out, { recursive: true });
  fs.writeFileSync(path.join(args.out, 'payroll.json'), JSON.stringify({ window, list }, null, 2));
  fs.writeFileSync(path.join(args.out, 'payroll.md'), md);
  process.stdout.write(`${JSON.stringify({ window, techs: list.length, total: list.reduce((s, t) => s + t.total, 0), message: path.join(args.out, 'payroll.md') })}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stdout.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  });
}

module.exports = { payWindow, summarize, message };
