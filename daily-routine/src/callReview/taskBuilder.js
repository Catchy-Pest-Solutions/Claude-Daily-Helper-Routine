// Builds one Briostack callback task per caller still owed a call.
//
// Who gets it:
// - Caller pressed 1 (New Customers)       -> Steve
// - Caller pressed 2 (Existing Customers)  -> Shelley
// - No menu choice: active Briostack customer -> Shelley, anyone else
//   (no match, or a former customer) -> Steve, since it's a sales call.
// Briostack is searched by primary phone, then by caller-ID name and
// secondary phone, so "not found" can still be a customer calling from a
// third number or with no name on caller ID.
const cal = require('./calendar');
const { formatPhone, OUTCOME_TEXT } = require('./callAnalysis');

const DOUBLE_CALL_TIP =
  "Use the double call: if they don't pick up, hang up without a voicemail, call again 30-60 seconds later, and leave a voicemail on the second call.";

function classifyCaller(entry, customer, lookedUp = true) {
  if (entry.callerTypeFromQueue === 'new') return { type: 'new', why: 'pressed 1 (New Customers)' };
  if (entry.callerTypeFromQueue === 'current') return { type: 'current', why: 'pressed 2 (Existing Customers)' };
  if (customer && customer.statusId === 'CUSTOMER_ACTIVE') return { type: 'current', why: 'phone number matches an active Briostack customer' };
  if (customer) return { type: 'new', label: 'Former customer', why: 'former customer (not active in Briostack)' };
  return { type: 'new', why: lookedUp ? "phone number isn't in Briostack" : "didn't press 1 or 2, so treated as a possible new customer" };
}

function describeMiss(m) {
  let line = `${cal.formatDay(m.startMs)} ${cal.formatTime(m.startMs)} — ${OUTCOME_TEXT[m.outcome]}`;
  if (m.outcome === 'voicemail') line += ` (${m.voicemailSec}s on voicemail; check the office email for a message)`;
  if (m.outcome === 'menu_hangup' || m.outcome === 'queue_hangup') line += ` after ${m.totalSec}s`;
  line += ` [${m.context.label}]`;
  return line;
}

function customerLines(customer, lookedUp) {
  if (!lookedUp) return ["Briostack: not checked (the API can't search by phone). Search this number in Briostack before calling."];
  if (!customer) return ["Briostack: no customer found with this phone number (could still be a customer calling from another number). Search Briostack before calling."];
  const lines = [
    `Briostack: customer #${customer.id} ${customer.name} (${statusText(customer.statusId)})${customer.matchedOn === 'secondary phone' ? ', matched on their secondary phone' : ''}`,
  ];
  if (customer.otherMatches) lines.push(`(${customer.otherMatches} other Briostack account${customer.otherMatches > 1 ? 's use' : ' uses'} this number too.)`);
  if (customer.address) lines.push(`Address: ${customer.address}`);
  const active = (customer.services || []).filter((s) => s.statusId === 'CSC_ACTIVE');
  if (active.length) {
    lines.push(
      `Active services: ${active
        .map((s) => `${s.serviceCategoryName}${s.nextAppointmentDate ? ` (next ${s.nextAppointmentDate.slice(0, 10)})` : ''}`)
        .join('; ')}`,
    );
  } else if ((customer.services || []).length) {
    lines.push('No active services.');
  }
  if (customer.nextAppointment) lines.push(`Next appointment: ${customer.nextAppointment}`);
  if (customer.amountDue > 0) lines.push(`Amount due: $${Number(customer.amountDue).toFixed(2)}${customer.daysPastDue ? ` (${customer.daysPastDue} days past due)` : ''}`);
  return lines;
}

function statusText(statusId) {
  return (
    { CUSTOMER_ACTIVE: 'active', CUSTOMER_CANCEL_OUT: 'cancelled', CUSTOMER_COMPLETE: 'past customer, service completed' }[statusId] ||
    statusId ||
    'unknown status'
  );
}

// entry: one needsCallback item from analyzeCalls. customer: Briostack
// lookup result or null. Returns a plain task description; the Briostack
// client maps it onto the API's field names.
function buildTask(entry, customer, { config, today, checkedAtMs, lookedUp = true }) {
  const who = classifyCaller(entry, customer, lookedUp);
  const assigneeExt = who.type === 'new' ? config.assignee.newCustomer : config.assignee.currentCustomer;
  const displayName =
    customer?.name ||
    (entry.callerName && !entry.callerNameIsPlace ? entry.callerName : `Unknown caller${entry.callerName ? ` (${entry.callerName})` : ''}`);
  const label = who.label || (who.type === 'new' ? 'NEW caller' : 'Current customer');

  const title = `${who.type === 'new' ? 'PRIORITY - ' : ''}Call back (${label}): ${displayName} ${formatPhone(entry.phone)}`;
  const description = [
    `Missed call${entry.misses.length > 1 ? `s (${entry.misses.length})` : ''} from ${formatPhone(entry.phone)}` +
      (entry.callerName ? ` — caller ID shows "${entry.callerName}"` : '') +
      '.',
    ...entry.misses.map((m) => `• ${describeMiss(m)}`),
    `Why ${config.staff[assigneeExt].name}: ${who.why}.`,
    ...customerLines(customer, lookedUp),
    ...(who.type === 'new' ? [DOUBLE_CALL_TIP] : []),
    `No callback, answered call or text to this number found in ATS as of ${cal.formatDay(checkedAtMs)} ${cal.formatTime(checkedAtMs)}.`,
    'Created automatically by the daily call review.',
  ].join('\n');

  return {
    title,
    description,
    customerId: customer?.id || null,
    assigneeExt,
    assigneeName: config.staff[assigneeExt].name,
    callerType: who.type,
    startDate: cal.easternIso(checkedAtMs),
    // New callers today; current customers by the end of the next business day.
    dueDate: cal.easternIso(cal.easternToMs(who.type === 'new' ? today : cal.nextBusinessDay(today), config.officeHours.end)),
    phone: entry.phone,
    displayName,
  };
}

module.exports = { buildTask, classifyCaller, DOUBLE_CALL_TIP };
