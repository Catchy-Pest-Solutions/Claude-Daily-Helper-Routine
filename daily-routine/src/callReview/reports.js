// Slack message text for the call review. The routine sends these through
// its Slack connector; this module only formats them.
const cal = require('./calendar');
const { formatPhone, OUTCOME_TEXT } = require('./callAnalysis');

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function windowLabel(w) {
  return `${cal.formatDay(w.startMs)} ${cal.formatTime(w.startMs)} → ${cal.formatDay(w.endMs)} ${cal.formatTime(w.endMs)}`;
}

function busyEmoji(score) {
  if (score == null) return '⚪';
  if (score >= 8) return '🟥';
  if (score >= 5) return '🟨';
  return '🟩';
}

function hourLabel(h) {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

// #office-only: kept short on purpose. Callbacks owed first, then a few
// numbers and each person's line. The full picture goes to Daniel.
function officeOnlyMessage({ window: w, analysis, tasks, doubleCallMisses = [], likelyRobocalls = [], earlierOpen = null, config }) {
  const s = analysis.stats;
  const L = [`📊 *Daily call recap* — ${windowLabel(w)} _(noon to noon)_`, ''];

  L.push(tasks.length ? '📞 *Still need a callback*' : '📞 *Still need a callback:* none 🎉');
  for (const t of tasks) {
    const flag = t.callerType === 'new' ? '🆕 ' : '';
    L.push(`• ${flag}*${t.displayName}* ${formatPhone(t.phone)} — ${t.shortSummary || t.summary} → *${t.assigneeName}*${t.error ? ' ⚠️ no task made' : ''}`);
  }
  if (earlierOpen?.total) {
    const fmt = (x) => `${x.open}${x.overdue ? ` (${x.overdue} overdue)` : ''}`;
    const people = Object.entries(earlierOpen.byPerson);
    // No assignee info on the tasks: just the total.
    const text = people.length === 1 && people[0][0] === 'Unassigned' ? fmt(people[0][1]) : people.map(([n, x]) => `${n} ${fmt(x)}`).join(' · ');
    L.push(`📂 Still open from earlier days: ${text}`);
  }
  if (likelyRobocalls.length) L.push(`_🤖 ${plural(likelyRobocalls.length, 'likely robocall')} skipped, no callback needed._`);

  if (doubleCallMisses.length) {
    L.push('');
    const who = doubleCallMisses.map((m) => `${config.staff[m.handled.doubleCall.agent]?.name || 'Someone'} → ${m.callerName || formatPhone(m.phone)}`);
    L.push(`🔁 *Double-call reminder:* ${who.join(', ')} got one call. No answer? Hang up, call again in 30-60s, leave the voicemail on the second call.`);
  }

  L.push('');
  L.push('📈 *By the numbers*');
  L.push(`• ${s.inboundTotal} calls in · ${s.answered} answered (${pct(s.answered, s.inboundTotal)}) · ${s.outboundTotal} calls out`);
  const busiest = Object.entries(s.hourly)
    .filter(([k]) => k !== 'closedDay')
    .sort((x, y) => y[1].total - x[1].total)[0];
  L.push(
    `• ⏱️ ${s.medianWaitSec != null ? cal.formatDuration(s.medianWaitSec) : '—'} median to answer${busiest ? ` · 🕐 busiest ${hourLabel(Number(busiest[0]))} (${plural(busiest[1].total, 'call')})` : ''}`,
  );
  const fast = withinHour(analysis.missedCalls, likelyRobocalls);
  if (fast.total) L.push(`• ⚡ ${fast.fast} of ${fast.total} office-hours misses called back within an hour`);

  L.push('');
  L.push('👩‍💼 *Team*');
  L.push(...teamLines(s, { short: true }));
  L.push('');
  L.push('_Daniel gets the full report every day. Ask him if you want more detail on any of it._');
  return L.join('\n');
}

// Missed calls during office hours (robocalls aside) and how many were
// handled within an hour.
function withinHour(missedCalls, likelyRobocalls = []) {
  const robo = new Set(likelyRobocalls.map((r) => r.phone));
  const misses = missedCalls.filter((m) => m.context.period !== 'closed' && !robo.has(m.phone));
  return { total: misses.length, fast: misses.filter((m) => m.handled && m.handled.delaySec <= 3600).length };
}

function teamLines(s, { short = false } = {}) {
  const out = [];
  for (const a of Object.values(s.agents)) {
    if (!a.takesCalls) continue;
    out.push(
      `• *${a.name}* — ${busyEmoji(a.busyScore)} busy ${a.busyScore ?? '—'}/10 · ${a.inboundAnswered} answered · ${a.outbound} ${short ? 'out' : 'outbound'} · ${cal.formatDuration(a.talkSec)} on the phone`,
    );
  }
  if (!short) out.push('_Busy score: share of office hours on the phone plus calls per hour._');
  return out;
}

function ideas(stats, missed, robocallCalls = 0) {
  const out = [];
  if (stats.medianRingBeforeVoicemailSec && stats.medianRingBeforeVoicemailSec <= 45) {
    out.push(
      `Unanswered queue calls ring for only about ${Math.round(stats.medianRingBeforeVoicemailSec)}s before voicemail. Asking ATS for a longer ring, or a second pass that rings both Steve and Shelley, would catch more calls.`,
    );
  }
  if (stats.missedWhileSomeoneFree >= 2) {
    out.push(
      `${stats.missedWhileSomeoneFree} calls were missed during office hours while at least one person wasn't on another call. Worth checking that both queues ring both desks and that nobody is logged out of the queue.`,
    );
  }
  const menu = (stats.missedByOutcome.menu_hangup || 0) - robocallCalls;
  if (menu >= 3) {
    out.push(
      `${menu} callers hung up at the phone menu before pressing 1 or 2${robocallCalls ? ` (not counting ${plural(robocallCalls, 'likely robocall')})` : ''}. A shorter greeting, with the menu options first, could keep more of them on the line.`,
    );
  }
  if (stats.missedByPeriod.lunch >= 1) {
    out.push(`${plural(stats.missedByPeriod.lunch, 'call')} missed during a lunch break. During lunch, the other person's phone should ring for both queues.`);
  }
  const bothBusy = missed.filter((m) => m.context.period === 'open' && !m.context.anyFree).length;
  if (bothBusy >= 2) {
    out.push(`${bothBusy} calls came in while everyone was already on a call. If this keeps happening at the same hours, a ring-over to a third phone at peak times would help.`);
  }
  const newMissed = stats.byType.new.total - stats.byType.new.answered;
  if (newMissed >= 1) out.push(`${plural(newMissed, 'new-customer call')} missed. These are the ones to return first.`);
  if (stats.slowestCallbackSec && stats.slowestCallbackSec > 2 * 3600) {
    out.push(`The slowest callback took ${cal.formatDuration(stats.slowestCallbackSec)}. Aim for under an hour, especially for new customers.`);
  }
  if (stats.missedByPeriod.closed >= 3) {
    out.push(`${stats.missedByPeriod.closed} calls came in while the office was closed. An after-hours text-back or answering service could catch these leads.`);
  }
  return out;
}

// Owner's DM: how the run went plus the business picture.
function ownerReport({ window: w, analysis, tasks, alreadyOpen = [], likelyRobocalls = [], texts, apiUsage, problems, weekly, doubleCallMisses = [], config }) {
  const nameOf = (ext) => config.staff[ext]?.name || `ext ${ext}`;
  const s = analysis.stats;
  const L = [];
  L.push(`<@${config.ownerSlackId}> 📊 *Daily Call Report* — ${windowLabel(w)}`);
  L.push('');

  const created = tasks.filter((t) => t.created).length;
  const failed = tasks.filter((t) => t.error).length;
  L.push(problems.length || failed ? '⚠️ *Routine status: finished with problems*' : '✅ *Routine status: ran cleanly*');
  L.push(`• 📝 Briostack tasks: ${created} created${failed ? `, ${failed} failed` : ''}${tasks.length - created - failed ? `, ${tasks.length - created - failed} not attempted` : ''}`);
  L.push(`• 🔌 API calls: ATS ${apiUsage.ats} · Briostack ${apiUsage.briostack}`);
  for (const p of problems) L.push(`• ⚠️ ${p}`);
  L.push('');

  L.push('☎️ *Call volume*');
  L.push(`• ${plural(s.inboundTotal, 'inbound call')} from ${plural(s.uniqueCallers, 'caller')} · ✅ ${s.answered} answered (${pct(s.answered, s.inboundTotal)}) · ❌ ${s.missed} missed`);
  L.push(`• 🆕 New-customer line (pressed 1): ${s.byType.new.total} calls, ${s.byType.new.answered} answered`);
  L.push(`• 👥 Current-customer line (pressed 2): ${s.byType.current.total} calls, ${s.byType.current.answered} answered`);
  if (s.byType.unknown.total) L.push(`• ❔ Menu choice not visible: ${s.byType.unknown.total} _(ATS only shows it when a call waits in the queue)_`);
  L.push(`• 📤 ${plural(s.outboundTotal, 'outbound call')} · ⏱️ median time to answer ${s.medianWaitSec != null ? cal.formatDuration(s.medianWaitSec) : '—'} _(includes the phone menu)_`);
  if (texts) L.push(`• 💬 Texts through ATS: ${texts.inbound} received, ${texts.outbound} sent`);
  L.push('');

  L.push(`❌ *Missed calls (${s.missed})*`);
  L.push(`• 🏢 Office open: ${s.missedByPeriod.open} · 🍔 Lunch: ${s.missedByPeriod.lunch} · 🌙 Closed: ${s.missedByPeriod.closed}`);
  const o = s.missedByOutcome;
  const robocallCalls = likelyRobocalls.reduce((n, r) => n + r.calls, 0);
  L.push(
    `• 📼 Voicemail: ${o.voicemail || 0} · 📵 Hung up at menu: ${o.menu_hangup || 0}${robocallCalls ? ` (${robocallCalls} likely robocalls)` : ''} · ⏳ Hung up in queue: ${(o.queue_hangup || 0) + (o.overflow_hangup || 0)}`,
  );
  L.push('');

  L.push('🔁 *Callbacks*');
  if (s.handledCount) {
    L.push(`• ${s.handledCount} of ${s.missed} missed calls were already handled · median ${cal.formatDuration(s.medianCallbackSec)} · slowest ${cal.formatDuration(s.slowestCallbackSec)}`);
    for (const m of analysis.missedCalls.filter((x) => x.handled)) {
      const by = m.handled.agent ? nameOf(m.handled.agent) : 'someone';
      const how = { callback: `${by} called back`, caller_got_through: `caller got through to ${by}`, texted: 'we texted them' }[m.handled.kind];
      L.push(`   ◦ ${m.callerName || formatPhone(m.phone)} — missed ${cal.formatTime(m.startMs)} → ${how} after ${cal.formatDuration(m.handled.delaySec)}`);
    }
  } else {
    L.push('• None of the missed calls had been returned yet.');
  }
  const byPerson = {};
  for (const t of tasks) byPerson[t.assigneeName] = (byPerson[t.assigneeName] || 0) + 1;
  L.push(`• 📝 Still owed a callback: ${plural(tasks.length, 'caller')}${tasks.length ? ` (${Object.entries(byPerson).map(([n, c]) => `${n} ${c}`).join(', ')})` : ''}`);
  for (const t of tasks) L.push(`   ◦ ${t.callerType === 'new' ? '🆕' : '👥'} ${t.displayName} ${formatPhone(t.phone)} → ${t.assigneeName}`);
  if (alreadyOpen.length) L.push(`• 📂 ${plural(alreadyOpen.length, 'caller')} already had an open callback task, so no new one was made`);
  if (likelyRobocalls.length) {
    L.push(
      `• 🤖 Likely robocalls, no callback task: ${likelyRobocalls.length} _(caller ID only a town, about a minute silent at the menu, not in Briostack)_`,
    );
    for (const r of likelyRobocalls) L.push(`   ◦ ${r.callerName} ${formatPhone(r.phone)} — ${r.summary.replace(/, hung up at the phone menu.*$/, '')}`);
  }
  const checked = analysis.missedCalls.filter((m) => m.handled?.doubleCall && m.callerType !== 'current');
  if (checked.length) {
    L.push(`• 🔁 Double-call method: ${checked.length - doubleCallMisses.length} of ${checked.length} unanswered callbacks to new/unknown callers got the second call`);
    for (const m of doubleCallMisses) L.push(`   ◦ ⚠️ ${nameOf(m.handled.doubleCall.agent)} called ${m.callerName || formatPhone(m.phone)} only once (office reminded in #office-only)`);
  }
  L.push('');

  L.push('👩‍💼 *Team*');
  L.push(...teamLines(s));
  L.push('');

  L.push('🕐 *Inbound calls by hour*');
  const hours = Object.keys(s.hourly).filter((k) => k !== 'closedDay').map(Number).sort((a, b) => a - b);
  const bars = hours.map((h) => {
    const x = s.hourly[h];
    return `${hourLabel(h).padStart(5)} ${'█'.repeat(x.total)}${x.missed ? ` ${x.total} (${x.missed} missed)` : ` ${x.total}`}`;
  });
  if (s.hourly.closedDay) bars.push(`Weekend/holiday: ${s.hourly.closedDay.total} (${s.hourly.closedDay.missed} missed)`);
  L.push(bars.length ? '```\n' + bars.join('\n') + '\n```' : '• No inbound calls.');

  if (s.repeatCallers.length) {
    L.push('');
    L.push('🔂 *Called 3+ times*');
    for (const r of s.repeatCallers) L.push(`• ${r.name || 'Unknown'} ${formatPhone(r.phone)} — ${r.count} calls`);
  }

  const tips = ideas(s, analysis.missedCalls, robocallCalls);
  if (tips.length) {
    L.push('');
    L.push('💡 *Ideas to answer more calls*');
    for (const t of tips) L.push(`• ${t}`);
  }

  if (weekly) {
    L.push('');
    L.push('📈 *Weekly trend*');
    L.push('```');
    L.push('Week of     Calls  Answered  Missed  New calls (missed)');
    for (const wk of weekly) {
      L.push(`${wk.label.padEnd(11)} ${String(wk.inbound).padStart(5)}  ${pct(wk.answered, wk.inbound).padStart(8)}  ${String(wk.missed).padStart(6)}  ${wk.newCalls} (${wk.newMissed})`);
    }
    L.push('```');
  }

  return L.join('\n');
}

function failureReport({ step, error, window: w, config }) {
  return [
    `${config?.ownerSlackId ? `<@${config.ownerSlackId}> ` : ''}⚠️ *Daily call review didn’t run successfully*`,
    `• Step: ${step}`,
    `• Error: ${error}`,
    w && !w.skip ? `• Window: ${windowLabel(w)}` : null,
    '• No Briostack tasks were created for this window. Missed calls need a manual look in the ATS portal.',
  ]
    .filter(Boolean)
    .join('\n');
}

const SHORT_OUTCOME = {
  voicemail: 'went to voicemail',
  overflow_hangup: 'hung up on hold',
  queue_hangup: 'hung up in the queue',
  menu_hangup: 'hung up at the menu',
};

function missSummary(entry, { short = false } = {}) {
  const first = entry.misses[0];
  const n = entry.misses.length;
  const count = n > 1 ? (short ? `${n} missed, first ` : `${n} missed calls, first `) : 'missed ';
  return `${count}${cal.formatDay(first.startMs)} ${cal.formatTime(first.startMs)}, ${(short ? SHORT_OUTCOME : OUTCOME_TEXT)[first.outcome]}`;
}

module.exports = { officeOnlyMessage, ownerReport, failureReport, missSummary, windowLabel };
