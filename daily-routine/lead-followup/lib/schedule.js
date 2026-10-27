// When the text goes out and which two days the close offers.
//
// A new customer in Briostack almost always means someone at the office just
// talked to them, so the text and email go out right away. The only hold is
// overnight (config.textQuietHours, 9 PM-8 AM Eastern) for records nobody at
// the office created, such as website and Google leads: those texts wait
// until 8 AM. Records Steve, Shelley or Daniel created go out right away at
// any hour.
const cal = require('../../src/callReview/calendar');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_QUIET = { start: '21:00', end: '08:00' };

const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function inQuietHours(ms, quiet = DEFAULT_QUIET) {
  const now = cal.toEastern(ms).minutesOfDay;
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  return start > end ? now >= start || now < end : now >= start && now < end;
}

// null = send now; otherwise the end of quiet hours (later today if it's
// before 8 AM, else tomorrow).
function textSendAtMs(nowMs, { createdByStaff = false, quiet = DEFAULT_QUIET } = {}) {
  if (createdByStaff || !inQuietHours(nowMs, quiet)) return null;
  const today = cal.toEastern(nowMs).date;
  const endToday = cal.easternToMs(today, quiet.end);
  return endToday > nowMs ? endToday : cal.easternToMs(cal.addDays(today, 1), quiet.end);
}

// The two business days after the day the text goes out. The first is
// "tomorrow" when it is the next calendar day, but only when the text goes
// out the same day as the email (which is sent right away): a text held
// overnight is read a day after the email, so "tomorrow" would point at
// different days in the two messages.
function closeDays(nowMs, sendAtMs) {
  const textDay = cal.toEastern(sendAtMs ?? nowMs).date;
  const sameDayAsEmail = textDay === cal.toEastern(nowMs).date;
  const first = cal.nextBusinessDay(textDay);
  const second = cal.nextBusinessDay(first);
  const name = (d) => DAY_NAMES[cal.weekdayOf(d)];
  const firstLabel = sameDayAsEmail && first === cal.addDays(textDay, 1) ? 'tomorrow' : name(first);
  return { labels: [firstLabel, name(second)], dates: [first, second] };
}

function schedule(nowMs, options = {}) {
  const sendAt = textSendAtMs(nowMs, options);
  const days = closeDays(nowMs, sendAt);
  return {
    textSendAt: sendAt == null ? null : cal.easternIso(sendAt),
    closeDays: days.labels,
    closeDates: days.dates,
  };
}

module.exports = { schedule, inQuietHours, textSendAtMs, closeDays };
