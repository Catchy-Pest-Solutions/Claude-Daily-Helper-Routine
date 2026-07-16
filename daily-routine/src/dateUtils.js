function todayInEastern() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

function parseDateOnly(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function addDays(dateStr, days) {
  const ms = parseDateOnly(dateStr) + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

// Inclusive of past-due and today; exclusive beyond today+windowDays.
function isWithinWindow(dueDateStr, todayStr, windowDays) {
  if (!dueDateStr) return false;
  const due = parseDateOnly(dueDateStr);
  const limit = parseDateOnly(todayStr) + windowDays * 86400000;
  return due <= limit;
}

module.exports = { todayInEastern, addDays, isWithinWindow };
