// Follow-up text to missed callers who aren't in Briostack (new leads).
//
// Who gets one: the caller is still owed a callback (nobody called back,
// they didn't get through, nobody texted them), Briostack was checked and
// has no customer with that number (so current and former customers are
// never texted), it isn't a likely robocall or a number that already had an
// open callback task, and Textable shows no text to or from the number in
// the last `skipIfTextedWithinDays` days. One text per caller per run.
//
// Modes (config.textFollowUp.mode):
//   off      nothing
//   preview  list who would be texted in Daniel's report, send nothing
//   test     send each text to config.textFollowUp.testPhone instead of the
//            caller, with "TEST for <number>:" on top
//   live     send to the caller
const cal = require('./calendar');
const { formatPhone } = require('./callAnalysis');

const TOLL_FREE = /^8(00|33|44|55|66|77|88)/;

// "this morning" / "earlier today" / "yesterday" / "on Friday".
function whenPhrase(missMs, nowMs) {
  const miss = cal.toEastern(missMs);
  const today = cal.toEastern(nowMs).date;
  if (miss.date === today) return miss.hour < 12 ? 'this morning' : 'earlier today';
  if (miss.date === cal.addDays(today, -1)) return 'yesterday';
  return `on ${new Date(missMs).toLocaleDateString('en-US', { timeZone: cal.TZ, weekday: 'long' })}`;
}

// Worded so it's true whether or not anyone has called them back yet: we
// haven't connected with them.
function followUpMessage({ missMs, nowMs, officePhone, signature }) {
  return (
    `Hi! We got your call ${whenPhrase(missMs, nowMs)} and haven't been able to connect with you yet. ` +
    `Just reply here with a good time to reach you and we'll give you a call, or call us at ${officePhone} whenever it's convenient. ` +
    `${signature}`
  );
}

// Why this task's caller shouldn't get a text, or null if they should.
function skipReason(task, { lookedUp, lastTextMs, nowMs, settings }) {
  if (task.customerId) return 'in Briostack';
  if (!lookedUp) return "Briostack couldn't be checked";
  if (!/^\d{10}$/.test(task.phone || '')) return 'not a US phone number';
  if (TOLL_FREE.test(task.phone)) return 'toll-free number (a business)';
  if (lastTextMs && nowMs - lastTextMs < settings.skipIfTextedWithinDays * 86400000) {
    return `texts with us in ATS Texting on ${cal.formatDay(lastTextMs)}`;
  }
  return null;
}

function inSendingHours(nowMs, settings) {
  const e = cal.toEastern(nowMs);
  const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
  return cal.isBusinessDay(e.date) && e.minutesOfDay >= toMin(settings.sendHours[0]) && e.minutesOfDay < toMin(settings.sendHours[1]);
}

// candidates: [{ task, lookedUp }] for callers not found in Briostack.
// Sends (or previews) the texts and returns one entry per candidate:
// { phone, displayName, status, to?, message?, reason? } where status is
// sent | test_sent | preview | skipped | opted_out | failed. Problems that
// need Daniel go into `problems`.
async function sendFollowUpTexts({ candidates, textable, settings, nowMs, dryRun, problems }) {
  const mode = dryRun && settings.mode !== 'off' ? 'preview' : settings.mode;
  if (mode === 'off' || !candidates.length) return { mode, results: [] };

  if (!inSendingHours(nowMs, settings)) {
    problems.push(`Follow-up texts not sent: it's outside ${settings.sendHours.join('–')} on a business day.`);
    return { mode, results: candidates.map(({ task }) => ({ phone: task.phone, displayName: task.displayName, status: 'skipped', reason: 'outside sending hours' })) };
  }
  if ((mode === 'test' || mode === 'live') && !textable) {
    problems.push('Follow-up texts not sent: no Textable credentials in the environment (TEXTABLE_ACCOUNT_UID, TEXTABLE_API_TOKEN).');
    return { mode, results: candidates.map(({ task }) => ({ phone: task.phone, displayName: task.displayName, status: 'skipped', reason: 'no Textable credentials' })) };
  }

  let lastText = {};
  if (textable) {
    try {
      lastText = await textable.lastMessageByPhone();
    } catch (err) {
      // Can't rule out texting someone twice, so send nothing.
      problems.push(`Follow-up texts not sent: couldn't check ATS Texting for earlier texts (${err.message}).`);
      return { mode, results: candidates.map(({ task }) => ({ phone: task.phone, displayName: task.displayName, status: 'skipped', reason: "couldn't check earlier texts" })) };
    }
  }

  const results = [];
  for (const { task, lookedUp } of candidates) {
    const base = { phone: task.phone, displayName: task.displayName };
    const reason = skipReason(task, { lookedUp, lastTextMs: lastText[task.phone], nowMs, settings });
    if (reason) {
      results.push({ ...base, status: 'skipped', reason });
      continue;
    }
    const message = followUpMessage({ missMs: task.firstMissMs, nowMs, officePhone: settings.officePhone, signature: settings.signature });
    if (mode === 'preview') {
      results.push({ ...base, status: 'preview', message });
      continue;
    }
    const to = mode === 'test' ? settings.testPhone : `+1${task.phone}`;
    const body = mode === 'test' ? `TEST for ${formatPhone(task.phone)}:\n${message}` : message;
    const status = await textable.send({ to, from: settings.from, message: body });
    if (status === 'sent') {
      results.push({ ...base, status: mode === 'test' ? 'test_sent' : 'sent', to, message, sentAtMs: nowMs });
    } else if (status === 'opted_out') {
      results.push({ ...base, status: 'opted_out', to, reason: 'opted out of texts (texted STOP)' });
    } else {
      results.push({ ...base, status: 'failed', to, reason: status.replace(/^failed: /, '') });
      problems.push(`Follow-up text to ${task.displayName} ${formatPhone(task.phone)} failed: ${status.replace(/^failed: /, '')}`);
    }
  }
  return { mode, results };
}

module.exports = { sendFollowUpTexts, followUpMessage, whenPhrase, skipReason, inSendingHours };
