// When the text goes out and which two days the close offers.
// Office hours: 8 AM-5 PM Eastern, Monday-Friday, minus the office holidays
// in src/callReview/calendar.js. Outside them the text is scheduled for the
// next business morning at 8:30.
const cal = require('../../src/callReview/calendar');

const OPEN_MIN = 8 * 60;
const CLOSE_MIN = 17 * 60;
const SEND_TIME = '08:30';
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function officeOpen(ms) {
  const e = cal.toEastern(ms);
  return cal.isBusinessDay(e.date) && e.minutesOfDay >= OPEN_MIN && e.minutesOfDay < CLOSE_MIN;
}

// null when the office is open (send now), otherwise the next business
// morning at 8:30 (which can be later today, e.g. at 6 AM on a Tuesday).
function textSendAtMs(nowMs) {
  if (officeOpen(nowMs)) return null;
  const today = cal.toEastern(nowMs).date;
  let day = today;
  if (!cal.isBusinessDay(day) || cal.easternToMs(day, SEND_TIME) <= nowMs) day = cal.nextBusinessDay(day);
  return cal.easternToMs(day, SEND_TIME);
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

function schedule(nowMs) {
  const sendAt = textSendAtMs(nowMs);
  const days = closeDays(nowMs, sendAt);
  return {
    textSendAt: sendAt == null ? null : cal.easternIso(sendAt),
    closeDays: days.labels,
    closeDates: days.dates,
  };
}

module.exports = { schedule, officeOpen, textSendAtMs, closeDays };
