// Business calendar for the call review: Eastern time conversions, office
// holidays, and the run window. ATS /search timestamps are UTC
// ("YYYY-MM-DD HH:MM:SS"); everything shown to people is Eastern.

const TZ = 'America/New_York';

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
});

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// ms since epoch -> Eastern wall-clock parts.
function toEastern(ms) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    hour: Number(p.hour),
    minute: Number(p.minute),
    minutesOfDay: Number(p.hour) * 60 + Number(p.minute),
    weekday: WEEKDAYS[p.weekday],
  };
}

// Eastern wall-clock date + "HH:MM" -> ms since epoch (DST-aware).
function easternToMs(dateStr, time = '00:00') {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Two passes settle the offset, including across a DST change.
  let ms = guess;
  for (let i = 0; i < 2; i++) {
    const e = toEastern(ms);
    const [ey, em, ed] = e.date.split('-').map(Number);
    const shown = Date.UTC(ey, em - 1, ed, e.hour, e.minute);
    ms += guess - shown;
  }
  return ms;
}

// ATS "YYYY-MM-DD HH:MM:SS" (UTC) -> ms.
function parseAtsUtc(str) {
  return Date.parse(`${str.replace(' ', 'T')}Z`);
}

// ms -> ATS query parts (UTC).
function toAtsUtc(ms) {
  const iso = new Date(ms).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// nth (1-based) weekday of a month; n = -1 means the last one.
function nthWeekday(year, month, weekday, n) {
  if (n > 0) {
    const first = weekdayOf(`${year}-${String(month).padStart(2, '0')}-01`);
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return addDays(lastDate, -((weekdayOf(lastDate) - weekday + 7) % 7));
}

// Fixed-date holidays that land on a weekend are observed on the nearest
// weekday (Saturday -> Friday, Sunday -> Monday).
function observed(dateStr) {
  const wd = weekdayOf(dateStr);
  if (wd === 6) return addDays(dateStr, -1);
  if (wd === 0) return addDays(dateStr, 1);
  return dateStr;
}

// Office holidays for a year: date -> name. New Year's Day, July 4 and
// Christmas shift to their observed weekday; New Year's Eve and Christmas
// Eve don't (a weekend one is just a weekend).
function holidaysForYear(year) {
  const h = {};
  const add = (date, name) => {
    h[date] = h[date] ? `${h[date]} / ${name}` : name;
  };
  add(observed(`${year}-01-01`), "New Year's Day");
  add(nthWeekday(year, 5, 1, -1), 'Memorial Day');
  add(observed(`${year}-07-04`), 'Independence Day');
  add(nthWeekday(year, 9, 1, 1), 'Labor Day');
  const thanksgiving = nthWeekday(year, 11, 4, 4);
  add(thanksgiving, 'Thanksgiving');
  add(addDays(thanksgiving, 1), 'Black Friday');
  add(`${year}-12-24`, 'Christmas Eve');
  add(observed(`${year}-12-25`), 'Christmas Day');
  add(`${year}-12-31`, "New Year's Eve");
  // Next year's New Year's Day observed on Dec 31 when Jan 1 is a Saturday.
  const nextNy = observed(`${year + 1}-01-01`);
  if (nextNy.startsWith(String(year))) add(nextNy, "New Year's Day");
  return h;
}

function holidayName(dateStr) {
  return holidaysForYear(Number(dateStr.slice(0, 4)))[dateStr] || null;
}

function isBusinessDay(dateStr) {
  const wd = weekdayOf(dateStr);
  return wd >= 1 && wd <= 5 && !holidayName(dateStr);
}

function previousBusinessDay(dateStr) {
  let d = addDays(dateStr, -1);
  while (!isBusinessDay(d)) d = addDays(d, -1);
  return d;
}

// The window a run covers: from noon (Eastern) on the previous business day
// to noon today, so each call lands in exactly one run no matter when the
// scheduler actually fires. Monday's run therefore covers the weekend, and
// the day after a holiday covers the holiday. Returns { skip } on days the
// routine shouldn't run.
function runWindow(nowMs, { anchor = '12:00' } = {}) {
  const today = toEastern(nowMs).date;
  if (!isBusinessDay(today)) {
    const reason = holidayName(today) || (weekdayOf(today) === 6 ? 'Saturday' : 'Sunday');
    return { skip: true, today, reason };
  }
  const endMs = Math.min(easternToMs(today, anchor), nowMs);
  const startDate = previousBusinessDay(today);
  return { skip: false, today, startDate, startMs: easternToMs(startDate, anchor), endMs };
}

// ms -> ISO timestamp with the Eastern offset, e.g.
// 2026-09-30T17:00:00.000-04:00 (the format Briostack task dates take).
function easternIso(ms) {
  const e = toEastern(ms);
  const [y, mo, d] = e.date.split('-').map(Number);
  const offsetMin = Math.round((Date.UTC(y, mo - 1, d, e.hour, e.minute) - Math.floor(ms / 60000) * 60000) / 60000);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const pad = (n) => String(n).padStart(2, '0');
  const sec = new Date(ms).getUTCSeconds();
  return `${e.date}T${pad(e.hour)}:${pad(e.minute)}:${pad(sec)}.000${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function nextBusinessDay(dateStr) {
  let d = addDays(dateStr, 1);
  while (!isBusinessDay(d)) d = addDays(d, 1);
  return d;
}

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
}

function formatDay(ms) {
  return new Date(ms).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDuration(sec) {
  if (sec < 60) return `${Math.round(sec)}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

module.exports = {
  TZ,
  toEastern,
  easternToMs,
  parseAtsUtc,
  toAtsUtc,
  addDays,
  weekdayOf,
  holidaysForYear,
  holidayName,
  isBusinessDay,
  previousBusinessDay,
  nextBusinessDay,
  runWindow,
  easternIso,
  formatTime,
  formatDay,
  formatDuration,
};
