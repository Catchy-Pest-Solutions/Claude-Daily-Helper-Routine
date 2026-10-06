#!/usr/bin/env node
// Daily call review. Pulls the ATS call log for the run window, finds
// missed calls nobody has returned, looks each caller up in Briostack,
// creates callback tasks, and prints the Slack messages for the routine to
// send.
//
// Usage: node src/callReview/run.js [--dry-run] [--now=2026-09-30T16:05:00Z]
//   --dry-run   look everything up but don't create Briostack tasks
//   --now=ISO   pretend the run happens at this instant (for testing)
//
// Prints one JSON object:
//   { status: "ok" | "skipped" | "error", window, ownerMessage,
//     officeOnlyMessage, tasks, likelyRobocalls, apiUsage, problems }
// The routine DMs ownerMessage to Daniel and posts officeOnlyMessage to
// #office-only (null only when the run failed).
const path = require('node:path');

try {
  process.loadEnvFile(path.join(__dirname, '..', '..', '..', '.env'));
} catch {
  // No .env file: rely on the routine's environment variables.
}

const config = require('./config');
const cal = require('./calendar');
const { createAtsClient } = require('./atsClient');
const { createBriostackCallbackClient } = require('./briostack');
const { analyzeCalls, dailyTotals, formatPhone } = require('./callAnalysis');
const { buildTask } = require('./taskBuilder');
const reports = require('./reports');

// Pull a little before the window so calls that straddle the start are
// seen whole (and then excluded, since they belong to the previous run).
const LEAD_IN_MS = 30 * 60 * 1000;

function parseArgs(argv) {
  const args = { dryRun: false, nowMs: Date.now() };
  for (const a of argv) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--now=')) args.nowMs = Date.parse(a.slice(6));
  }
  return args;
}

async function runCallReview({ nowMs, dryRun, ats, brio }) {
  const window = cal.runWindow(nowMs);
  if (window.skip) return { status: 'skipped', window, reason: `${window.today} is ${window.reason}` };

  const problems = [];
  let step = 'ATS call log';
  try {
    const legs = await ats.searchCalls(window.startMs - LEAD_IN_MS, nowMs);

    step = 'ATS texts';
    let texts = null;
    let outboundTexts = [];
    try {
      const inbound = await ats.searchInboundTexts(window.startMs, nowMs);
      outboundTexts = await ats.searchOutboundTexts(window.startMs, nowMs);
      texts = { inbound: inbound.length, outbound: outboundTexts.length };
    } catch (err) {
      problems.push(`Couldn't read ATS texts: ${err.message}`);
    }

    step = 'call analysis';
    const analysis = analyzeCalls(legs, { ...window, nowMs }, config, { outboundTexts });

    step = 'Briostack';
    const canCreate = Boolean(brio && config.taskTypeId && !dryRun);
    const tasks = [];
    const alreadyOpen = [];
    const likelyRobocalls = [];
    let openTasks = null;
    if (brio) {
      try {
        openTasks = await brio.listOpenTasks();
      } catch (err) {
        problems.push(`Couldn't check Briostack for open tasks, so duplicates are possible: ${err.message}`);
      }
    }
    for (const entry of analysis.needsCallback) {
      if ((openTasks || []).some((t) => String(t.title || '').includes(formatPhone(entry.phone)))) {
        alreadyOpen.push(entry);
        continue;
      }
      let customer = null;
      let lookedUp = false;
      if (brio) {
        try {
          customer = await brio.findCustomerByPhone(entry.phone, entry.callerNameIsPlace ? null : entry.callerName);
          lookedUp = true;
        } catch (err) {
          problems.push(`Briostack lookup failed for ${formatPhone(entry.phone)}: ${err.message}`);
        }
      }
      // Only skip the task once Briostack confirms it isn't a customer.
      if (entry.robocallPattern && lookedUp && !customer) {
        likelyRobocalls.push(entry);
        continue;
      }
      const task = buildTask(entry, customer, { config, today: window.today, checkedAtMs: nowMs, lookedUp });
      task.summary = reports.missSummary(entry);
      task.shortSummary = reports.missSummary(entry, { short: true });
      if (canCreate) {
        try {
          task.briostackTaskId = await brio.createTask(task);
          task.created = true;
        } catch (err) {
          task.error = err.message;
          problems.push(`Couldn't create the task for ${task.displayName} ${task.phone}: ${err.message}`);
        }
      }
      tasks.push(task);
    }
    if (!brio) problems.push("Briostack isn't connected (BRIOSTACK_API_KEY missing), so no tasks were created.");
    else if (!config.taskTypeId) problems.push('No callback task type is set in config.js yet, so no Briostack tasks were created.');
    if (dryRun) problems.push('Dry run: tasks were built but not created in Briostack.');

    const doubleCallMisses = analysis.missedCalls.filter(
      (m) => m.handled?.doubleCall && !m.handled.doubleCall.followed && m.callerType !== 'current',
    );

    step = 'weekly trend';
    let weekly = null;
    if (isFirstRunOfWeek(window)) {
      try {
        weekly = await weeklyTrend(ats, window);
      } catch (err) {
        problems.push(`Weekly trend skipped: ${err.message}`);
      }
    }

    const apiUsage = { ats: ats.requestCount(), briostack: brio ? brio.requestCount() : 0 };
    const robocalls = likelyRobocalls.map((e) => ({ phone: e.phone, callerName: e.callerName, calls: e.misses.length, summary: reports.missSummary(e) }));
    return {
      status: 'ok',
      window: { ...window, label: reports.windowLabel(window) },
      tasks,
      apiUsage,
      problems,
      officeOnlyMessage: reports.officeOnlyMessage({ window, analysis, tasks, doubleCallMisses, likelyRobocalls: robocalls, earlierOpen: earlierCallbackTasks(openTasks, nowMs), config }),
      alreadyOpen: alreadyOpen.map((e) => e.phone),
      likelyRobocalls: robocalls,
      ownerMessage: reports.ownerReport({ window, analysis, tasks, alreadyOpen, likelyRobocalls: robocalls, texts, apiUsage, problems, weekly, doubleCallMisses, config }),
    };
  } catch (err) {
    return {
      status: 'error',
      window,
      step,
      error: err.message,
      ownerMessage: reports.failureReport({ step, error: err.message, window, config }),
      officeOnlyMessage: null,
    };
  }
}

// Callback tasks from earlier runs still open in Briostack, per person.
// Fetched before today's tasks were made, so none of today's are counted.
// Field names follow what POST /tasks accepts (employeeId, dueDate); a task
// without them still counts, under "Unassigned" and not overdue.
function earlierCallbackTasks(openTasks, nowMs) {
  if (!openTasks) return null;
  const nameOf = Object.fromEntries(Object.values(config.staff).map((s) => [String(s.briostackEmployeeId), s.name]));
  const byPerson = {};
  let total = 0;
  for (const t of openTasks) {
    if (!/Call back \(/.test(String(t.title || ''))) continue;
    const name = nameOf[String(t.employeeId ?? t.employee?.employeeId ?? '')] || 'Unassigned';
    byPerson[name] = byPerson[name] || { open: 0, overdue: 0 };
    byPerson[name].open++;
    const due = Date.parse(t.dueDate || '');
    if (Number.isFinite(due) && due < nowMs) byPerson[name].overdue++;
    total++;
  }
  return { total, byPerson };
}

// Monday's run (or the day after a Monday holiday) carries the weekly trend.
function isFirstRunOfWeek(window) {
  return cal.weekdayOf(window.today) <= cal.weekdayOf(window.startDate);
}

// Totals for the last N full weeks (Mon 00:00 -> Mon 00:00, Eastern).
async function weeklyTrend(ats, window) {
  const thisMonday = cal.addDays(window.today, -((cal.weekdayOf(window.today) + 6) % 7));
  const weeks = [];
  for (let i = config.weeklyTrendWeeks; i >= 1; i--) {
    const from = cal.addDays(thisMonday, -7 * i);
    weeks.push({ from, fromMs: cal.easternToMs(from), toMs: cal.easternToMs(cal.addDays(from, 7)) });
  }
  const legs = await ats.searchCalls(weeks[0].fromMs, weeks[weeks.length - 1].toMs);
  return weeks.map((wk) => {
    const days = Object.values(dailyTotals(legs, wk.fromMs, wk.toMs, config));
    const sum = (k) => days.reduce((s, d) => s + d[k], 0);
    return {
      label: cal.formatDay(wk.fromMs).replace(/^\w+, /, ''),
      inbound: sum('inbound'),
      answered: sum('answered'),
      missed: sum('missed'),
      newCalls: sum('newCalls'),
      newMissed: sum('newMissed'),
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = process.env;
  const ats = createAtsClient({ username: env.ATS_USERNAME, password: env.ATS_PASSWORD, customerId: config.atsCustomerId });
  const brio = env.BRIOSTACK_API_KEY
    ? createBriostackCallbackClient({ baseUrl: env.BRIOSTACK_BASE_URL || 'https://catchypestsolutions.briostack.io/rest/v1/', apiKey: env.BRIOSTACK_API_KEY, config })
    : null;
  const result = await runCallReview({ ...args, ats, brio });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (require.main === module) {
  main().catch((err) => {
    process.stdout.write(
      JSON.stringify({ status: 'error', step: 'startup', error: err.message, ownerMessage: reports.failureReport({ step: 'startup', error: err.message, config }) }, null, 2) + '\n',
    );
  });
}

module.exports = { runCallReview, isFirstRunOfWeek, earlierCallbackTasks };
