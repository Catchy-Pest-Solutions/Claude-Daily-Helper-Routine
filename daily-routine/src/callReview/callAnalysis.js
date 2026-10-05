// Turns raw ATS /search legs into calls, finds missed inbound calls that
// nobody has returned, and computes the stats for the owner's report.
//
// How a call shows up in /search (confirmed against Catchy's live data):
// - One call = several legs sharing a call_id.
// - Inbound: first leg is caller -> main number (the phone menu). Pressing 1
//   or 2 adds legs with callee_name "191" (New) or "190" (Existing) and
//   "Call-Queue". A leg to "<ext>wp" or "X<ext>" means an agent picked up.
// - Unanswered queue calls ring ~15s twice, then go to a "VMail" leg (the
//   voicemail box) or a "SpeakAccount" leg (the hold line callers wait on
//   when both lines are busy).
// - "No digit" on the menu leg means the caller never pressed 1 or 2.
// - Outbound: first leg's caller_id is an office extension (101/102/103).
const cal = require('./calendar');

const AGENT_LEG = /^(?:(\d{3})wp|X(\d{3}))$/;

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits.length === 10 ? digits : null;
}

function formatPhone(p) {
  return p && p.length === 10 ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : String(p);
}

// ATS caller IDs are often a city ("ASHEVILLE NC") or "WIRELESS CALLER",
// not a person. Transferred legs get a "New"/"Existing" prefix.
function cleanCallerName(name) {
  const n = String(name || '').replace(/^(New|Existing)(?=[A-Z])/, '').trim();
  if (!n || /^WIRELESS CALLER$/i.test(n) || /^\d+$/.test(n)) return null;
  const isPlace = /\s[A-Z]{2}$/.test(n) && n === n.toUpperCase() && !n.includes(',');
  const titled = n
    .split(',')
    .reverse()
    .join(' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(Nc|Sc|Va|Tn|Ga|Tx|Vt|Dc)$/, (s) => s.toUpperCase());
  return { name: titled, isPlace };
}

function agentExtOf(leg) {
  for (const v of [leg.callee_id, leg.callee_name]) {
    const m = AGENT_LEG.exec(String(v || ''));
    if (m) return Number(m[1] || m[2]);
  }
  return null;
}

function legTimes(leg) {
  const start = cal.parseAtsUtc(leg.start_time);
  const end = leg.end_time ? cal.parseAtsUtc(leg.end_time) : start + (leg.total_duration || 0) * 1000;
  return { start, end };
}

function groupCalls(legs) {
  const byId = new Map();
  for (const leg of legs) {
    if (!byId.has(leg.call_id)) byId.set(leg.call_id, []);
    byId.get(leg.call_id).push(leg);
  }
  const calls = [];
  for (const [id, group] of byId) {
    group.sort((a, b) => a.start_time.localeCompare(b.start_time));
    calls.push({ id, legs: group, startMs: cal.parseAtsUtc(group[0].start_time) });
  }
  return calls.sort((a, b) => a.startMs - b.startMs);
}

function classifyCall(call, config) {
  const first = call.legs[0];
  const staffExts = Object.keys(config.staff).map(Number);
  const fromExt = Number(first.caller_id);
  const endMs = Math.max(...call.legs.map((l) => legTimes(l).end));

  if (staffExts.includes(fromExt) && String(first.caller_id).length === 3) {
    const external = call.legs.map((l) => normalizePhone(l.callee_id)).find(Boolean);
    if (!external) return { ...call, direction: 'internal' };
    const talkSec = Math.max(
      0,
      ...call.legs.filter((l) => normalizePhone(l.callee_id) === external && l.exit_name !== 'Moved').map((l) => l.total_duration || 0),
    );
    return { ...call, direction: 'outbound', agent: fromExt, phone: external, talkSec, endMs };
  }

  const phone = normalizePhone(first.caller_id);
  if (!phone) return { ...call, direction: 'internal' };

  const queueLeg = call.legs.find((l) => config.queues[l.callee_name]);
  let queue = queueLeg ? Number(queueLeg.callee_name) : null;
  if (!queue) {
    const prefixed = call.legs.find((l) => /^(New|Existing)[A-Z]/.test(l.caller_name || ''));
    if (prefixed) queue = prefixed.caller_name.startsWith('New') ? 191 : 190;
  }

  const agentLegs = call.legs.filter(
    (l) => agentExtOf(l) && l.callee_name !== 'VMail' && l.exit_name !== 'Fail to Connect' && (l.total_duration || 0) > 0,
  );
  const vmLeg = call.legs.find((l) => l.callee_name === 'VMail');
  const nameInfo = call.legs.map((l) => cleanCallerName(l.caller_name)).find(Boolean) || null;

  const base = {
    ...call,
    direction: 'inbound',
    phone,
    callerName: nameInfo?.name || null,
    callerNameIsPlace: nameInfo?.isPlace ?? true,
    queue,
    callerType: queue ? config.queues[queue]?.callerType || null : null,
    dnis: first.dnis || first.callee_id,
    endMs,
  };

  if (agentLegs.length) {
    const firstAgent = agentLegs[0];
    return {
      ...base,
      answered: true,
      agent: agentExtOf(firstAgent),
      waitSec: Math.round((legTimes(firstAgent).start - call.startMs) / 1000),
      talkSec: agentLegs.reduce((s, l) => s + (l.total_duration || 0), 0),
      agentLegs: agentLegs.map((l) => ({ ext: agentExtOf(l), ...legTimes(l) })),
    };
  }

  const queueRingSec = call.legs
    .filter((l) => config.queues[l.callee_name] && l.exit_name === 'No Answer')
    .reduce((s, l) => s + (l.total_duration || 0), 0);
  let outcome;
  if (vmLeg) outcome = 'voicemail';
  else if (call.legs.some((l) => l.callee_name === 'SpeakAccount')) outcome = 'overflow_hangup';
  else if (queueLeg || queue) outcome = 'queue_hangup';
  else outcome = 'menu_hangup';

  return {
    ...base,
    answered: false,
    outcome,
    voicemailSec: vmLeg ? vmLeg.total_duration || 0 : 0,
    queueRingSec,
    totalSec: Math.round((endMs - call.startMs) / 1000),
  };
}

const OUTCOME_TEXT = {
  voicemail: 'went to voicemail',
  overflow_hangup: 'hung up on hold while the lines were busy',
  queue_hangup: 'hung up while waiting in the queue',
  menu_hangup: 'hung up at the phone menu (never pressed 1 or 2)',
};

function inInterval(ms, [a, b]) {
  return ms >= a && ms < b;
}

// Where the office was when a call came in: closed, at lunch, on another
// call, or free.
function officeContext(ms, calls, config) {
  const et = cal.toEastern(ms);
  const holiday = cal.holidayName(et.date);
  if (holiday) return { period: 'closed', label: `holiday (${holiday})` };
  if (et.weekday === 0 || et.weekday === 6) return { period: 'closed', label: 'weekend' };
  const open = toMinutes(config.officeHours.start);
  const close = toMinutes(config.officeHours.end);
  if (et.minutesOfDay < open) return { period: 'closed', label: 'before 8 AM' };
  if (et.minutesOfDay >= close) return { period: 'closed', label: 'after 5 PM' };

  const people = {};
  for (const [ext, s] of Object.entries(config.staff)) {
    if (!s.takesCalls) continue;
    const e = Number(ext);
    if (s.lunch && et.minutesOfDay >= toMinutes(s.lunch[0]) && et.minutesOfDay < toMinutes(s.lunch[1])) people[e] = 'lunch';
    else if (busyIntervals(calls, e).some((iv) => inInterval(ms, iv))) people[e] = 'on a call';
    else people[e] = 'free';
  }
  const parts = Object.entries(people).map(([e, st]) => `${config.staff[e].name} ${st}`);
  const anyFree = Object.values(people).includes('free');
  const anyLunch = Object.values(people).includes('lunch');
  return {
    period: anyLunch ? 'lunch' : 'open',
    anyFree,
    people,
    label: parts.join(', '),
  };
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

const busyCache = new WeakMap();
function busyIntervals(calls, ext) {
  if (!busyCache.has(calls)) busyCache.set(calls, {});
  const cache = busyCache.get(calls);
  if (!cache[ext]) {
    const ivs = [];
    for (const c of calls) {
      if (c.direction === 'outbound' && c.agent === ext) ivs.push([c.startMs, c.endMs]);
      if (c.direction === 'inbound' && c.answered) for (const l of c.agentLegs) if (l.ext === ext) ivs.push([l.start, l.end]);
    }
    cache[ext] = ivs;
  }
  return cache[ext];
}

// Office minutes (8-5 on business days, minus lunch) between two instants.
function availableMinutes(startMs, endMs, staffMember, config) {
  let total = 0;
  const lastDate = cal.toEastern(endMs).date;
  for (let d = cal.toEastern(startMs).date; d <= lastDate; d = cal.addDays(d, 1)) {
    if (!cal.isBusinessDay(d)) continue;
    const open = [cal.easternToMs(d, config.officeHours.start), cal.easternToMs(d, config.officeHours.end)];
    total += overlap(open, [startMs, endMs]);
    if (staffMember.lunch) {
      const lunch = [cal.easternToMs(d, staffMember.lunch[0]), cal.easternToMs(d, staffMember.lunch[1])];
      total -= overlap(lunch, [startMs, endMs]);
    }
  }
  return total / 60000;
}

function overlap([a1, b1], [a2, b2]) {
  return Math.max(0, Math.min(b1, b2) - Math.max(a1, a2));
}

// 1-10. Blends share of the shift spent on the phone (50%+ maxes it out)
// with calls per hour (5+/hr maxes it out), weighted 60/40.
function busyScore(talkSec, callCount, availMin) {
  if (availMin <= 0) return null;
  const utilization = talkSec / 60 / availMin;
  const perHour = callCount / (availMin / 60);
  const raw = 0.6 * Math.min(10, utilization * 20) + 0.4 * Math.min(10, perHour * 2);
  return Math.max(1, Math.min(10, Math.round(raw)));
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// legs: every /search row from shortly before the window through "now", so
// callbacks made after the window still count.
function analyzeCalls(legs, { startMs, endMs, nowMs }, config, { outboundTexts = [] } = {}) {
  const all = groupCalls(legs).map((c) => classifyCall(c, config));
  const inWindow = (c) => c.startMs >= startMs && c.startMs < endMs;
  const inbound = all.filter((c) => c.direction === 'inbound' && inWindow(c));
  const outbound = all.filter((c) => c.direction === 'outbound');

  // Each missed call -> the first thing after it that counts as handled.
  const missedCalls = inbound.filter((c) => !c.answered);
  for (const m of missedCalls) {
    m.context = officeContext(m.startMs, all, config);
    const callback = outbound.find((o) => o.phone === m.phone && o.startMs > m.startMs && o.startMs <= nowMs);
    const laterAnswer = all.find(
      (c) => c.direction === 'inbound' && c.answered && c.phone === m.phone && c.startMs > m.startMs && c.startMs <= nowMs,
    );
    const text = texted(outboundTexts, m);
    const first = [callback && { kind: 'callback', ms: callback.startMs, agent: callback.agent, talkSec: callback.talkSec },
      laterAnswer && { kind: 'caller_got_through', ms: laterAnswer.startMs, agent: laterAnswer.agent },
      text && { kind: 'texted', ms: text }]
      .filter(Boolean)
      .sort((a, b) => a.ms - b.ms)[0];
    m.handled = first ? { ...first, delaySec: Math.round((first.ms - m.startMs) / 1000) } : null;
    if (m.handled?.kind === 'callback') m.handled.doubleCall = doubleCallCheck(outbound, m.phone, m.handled.ms, config.doubleCall);
  }

  // One entry per phone number still owed a call back.
  const byPhone = new Map();
  for (const m of missedCalls.filter((c) => !c.handled)) {
    if (!byPhone.has(m.phone)) byPhone.set(m.phone, []);
    byPhone.get(m.phone).push(m);
  }
  const needsCallback = [...byPhone.entries()].map(([phone, misses]) => ({
    phone,
    callerName: misses.map((x) => x.callerName).find(Boolean) || null,
    callerNameIsPlace: misses.every((x) => x.callerNameIsPlace),
    callerTypeFromQueue: misses.map((x) => x.callerType).find(Boolean) || null,
    queues: [...new Set(misses.map((x) => x.queue).filter(Boolean))],
    leftVoicemail: misses.some((x) => x.outcome === 'voicemail'),
    robocallPattern: robocallPattern(all.filter((c) => c.direction === 'inbound' && c.phone === phone), config.robocall),
    misses,
    firstMs: misses[0].startMs,
    lastMs: misses[misses.length - 1].startMs,
  }));

  return { calls: all, inbound, outbound, missedCalls, needsCallback, stats: computeStats({ all, inbound, outbound, missedCalls, startMs, endMs }, config) };
}

// Every call from the number (in everything pulled for this run) was a
// silent ~1 minute at the phone menu with only a town on caller ID. A real
// person usually presses a key, hangs up sooner, leaves a voicemail or has
// a name on caller ID; any one of those calls clears the number.
function robocallPattern(calls, rule) {
  if (!rule || !calls.length) return false;
  return calls.every(
    (c) =>
      !c.answered &&
      c.outcome === 'menu_hangup' &&
      c.callerName &&
      c.callerNameIsPlace &&
      c.totalSec >= rule.menuSecMin &&
      c.totalSec <= rule.menuSecMax,
  );
}

// Did the callback follow the double-call method? A first call shorter
// than unansweredUnderSec counts as not picked up; it then needs a second
// call within secondCallWithinSec. Returns null when the first call
// connected (nothing to check).
function doubleCallCheck(outbound, phone, firstMs, rule) {
  const calls = outbound.filter((o) => o.phone === phone && o.startMs >= firstMs).sort((a, b) => a.startMs - b.startMs);
  const [first, second] = calls;
  if (!first || first.talkSec >= rule.unansweredUnderSec) return null;
  const followed = Boolean(second && (second.startMs - first.startMs) / 1000 <= rule.secondCallWithinSec);
  return { followed, agent: first.agent, gapSec: second ? Math.round((second.startMs - first.startMs) / 1000) : null };
}

// First successful ATS text to the caller after the miss. /sms-outbound
// has had no rows for Catchy so far, so its timestamp format is unverified;
// it's assumed to match /search (UTC).
function texted(outboundTexts, miss) {
  const times = outboundTexts
    .filter((t) => normalizePhone(t.to_phone) === miss.phone && (t.texted_bool === true || t.texted_bool === 1 || t.texted_bool === '1'))
    .map((t) => cal.parseAtsUtc(String(t.texted_dt || t.received_dt || '')))
    .filter((ms) => Number.isFinite(ms) && ms > miss.startMs);
  return times.length ? Math.min(...times) : null;
}

function computeStats({ all, inbound, outbound, missedCalls, startMs, endMs }, config) {
  const answered = inbound.filter((c) => c.answered);
  const byType = { new: { total: 0, answered: 0 }, current: { total: 0, answered: 0 }, unknown: { total: 0, answered: 0 } };
  for (const c of inbound) {
    const t = byType[c.callerType || 'unknown'];
    t.total++;
    if (c.answered) t.answered++;
  }

  const missedByPeriod = { open: 0, lunch: 0, closed: 0 };
  const missedWhileSomeoneFree = [];
  for (const m of missedCalls) {
    missedByPeriod[m.context.period]++;
    if (m.context.period !== 'closed' && m.context.anyFree) missedWhileSomeoneFree.push(m);
  }
  const missedByOutcome = {};
  for (const m of missedCalls) missedByOutcome[m.outcome] = (missedByOutcome[m.outcome] || 0) + 1;

  const handled = missedCalls.filter((m) => m.handled);
  const callbackDelays = handled.map((m) => m.handled.delaySec);

  const agents = {};
  const outboundInWindow = outbound.filter((c) => c.startMs >= startMs && c.startMs < endMs);
  for (const [ext, s] of Object.entries(config.staff)) {
    const e = Number(ext);
    const inb = answered.filter((c) => c.agent === e);
    const out = outboundInWindow.filter((c) => c.agent === e);
    const talkSec = inb.reduce((sum, c) => sum + c.talkSec, 0) + out.reduce((sum, c) => sum + c.talkSec, 0);
    const availMin = s.takesCalls ? availableMinutes(startMs, endMs, s, config) : 0;
    agents[e] = {
      name: s.name,
      takesCalls: s.takesCalls,
      inboundAnswered: inb.length,
      outbound: out.length,
      talkSec,
      availMin: Math.round(availMin),
      busyScore: s.takesCalls ? busyScore(talkSec, inb.length + out.length, availMin) : null,
    };
  }

  const hourly = {};
  for (const c of inbound) {
    const et = cal.toEastern(c.startMs);
    const key = cal.isBusinessDay(et.date) ? et.hour : 'closedDay';
    hourly[key] = hourly[key] || { total: 0, missed: 0 };
    hourly[key].total++;
    if (!c.answered) hourly[key].missed++;
  }

  const counts = {};
  for (const c of inbound) counts[c.phone] = (counts[c.phone] || 0) + 1;
  const repeatCallers = Object.entries(counts)
    .filter(([, n]) => n >= 3)
    .map(([phone, n]) => ({ phone, count: n, name: inbound.find((c) => c.phone === phone).callerName }));

  const voicemailRing = missedCalls.filter((m) => m.outcome === 'voicemail' && m.queueRingSec).map((m) => m.queueRingSec);

  return {
    inboundTotal: inbound.length,
    uniqueCallers: new Set(inbound.map((c) => c.phone)).size,
    answered: answered.length,
    missed: missedCalls.length,
    answerRate: inbound.length ? answered.length / inbound.length : null,
    medianWaitSec: median(answered.map((c) => c.waitSec)),
    byType,
    missedByPeriod,
    missedByOutcome,
    missedWhileSomeoneFree: missedWhileSomeoneFree.length,
    handledCount: handled.length,
    medianCallbackSec: median(callbackDelays),
    slowestCallbackSec: callbackDelays.length ? Math.max(...callbackDelays) : null,
    agents,
    hourly,
    repeatCallers,
    medianRingBeforeVoicemailSec: median(voicemailRing),
    outboundTotal: outboundInWindow.length,
    internalCalls: all.filter((c) => c.direction === 'internal').length,
  };
}

// Per-business-day totals for the Monday weekly trend.
function dailyTotals(legs, fromMs, toMs, config) {
  const calls = groupCalls(legs)
    .map((c) => classifyCall(c, config))
    .filter((c) => c.direction === 'inbound' && c.startMs >= fromMs && c.startMs < toMs);
  const days = {};
  for (const c of calls) {
    const d = cal.toEastern(c.startMs).date;
    days[d] = days[d] || { inbound: 0, answered: 0, missed: 0, newCalls: 0, newMissed: 0 };
    const x = days[d];
    x.inbound++;
    if (c.answered) x.answered++;
    else x.missed++;
    if (c.callerType === 'new') {
      x.newCalls++;
      if (!c.answered) x.newMissed++;
    }
  }
  return days;
}

module.exports = {
  normalizePhone,
  formatPhone,
  cleanCallerName,
  groupCalls,
  classifyCall,
  analyzeCalls,
  dailyTotals,
  busyScore,
  availableMinutes,
  OUTCOME_TEXT,
};
