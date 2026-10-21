// Pure decision logic for prepare.js: payload, contact, booked status, which
// ATS call is the customer's, and how lead.json looks. No I/O here.
const cal = require('../../src/callReview/calendar');
const { normalizePhone } = require('../../src/callReview/callAnalysis');

const LOG_PREFIX = '[AI FOLLOW-UP';
const SCRATCHED = new Set(['CSC_SCRATCH', 'CSC_CANCELLED', 'CSC_CANCELED']);
// A call this short is a hang-up or a ring, not a conversation.
const MIN_TALK_SEC = 20;

// Customer ID from a Briostack webhook payload. The exact shape is confirmed
// on the first real delivery; until then accept the likely spellings.
function customerIdFromPayload(payload) {
  let obj = payload;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      const m = /"?customer_?id"?\s*[:=]\s*"?(\d+)/i.exec(obj);
      return m ? m[1] : null;
    }
  }
  const seen = new Set();
  function walk(o, depth) {
    if (!o || typeof o !== 'object' || depth > 6 || seen.has(o)) return null;
    seen.add(o);
    for (const [k, v] of Object.entries(o)) {
      if (/^customer_?id$/i.test(k) && /^\d+$/.test(String(v))) return String(v);
    }
    const kind = String(o.resourceType || o.resource || o.type || o.entity || o.event || '').toUpperCase();
    if (kind.includes('CUSTOMER')) {
      for (const k of ['id', 'resourceId', 'entityId']) if (/^\d+$/.test(String(o[k] ?? ''))) return String(o[k]);
    }
    for (const v of Object.values(o)) {
      const found = typeof v === 'string' && v.trim().startsWith('{') ? walk(safeParse(v), depth + 1) : walk(v, depth + 1);
      if (found) return found;
    }
    return null;
  }
  return walk(obj, 0);
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

const clean = (s) => (s == null ? '' : String(s).trim());

function formatAddress(a) {
  if (!a || !a.address) return null;
  const stateZip = [clean(a.stateOrProvince), clean(a.postalCode)].filter(Boolean).join(' ');
  return [clean(a.address), clean(a.city), stateZip].filter(Boolean).join(', ');
}

// E.164 phone for texting. Briostack doesn't say which number is a cell, so
// take the first number (primary, then secondary) that has text
// notifications on, or else the first number at all.
function pickMobile(c) {
  const phones = [c.primaryPhone, c.secondaryPhone].filter((p) => p && normalizePhone(p.number));
  const p = phones.find((x) => x.textNotifications !== false) || phones[0];
  return p ? { e164: `+1${normalizePhone(p.number)}`, contactMethodId: p.contactMethodId || null } : null;
}

function customerInfo(c) {
  const firstName = clean(c.firstName) || null;
  const lastName = clean(c.lastName) || null;
  const mobile = pickMobile(c);
  const email = clean(c.primaryEmail?.address) || null;
  const phones10 = [c.primaryPhone, c.secondaryPhone].map((p) => normalizePhone(p?.number)).filter(Boolean);
  return {
    id: String(c.customerId),
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(' ') || null,
    mobile: mobile?.e164 || null,
    email,
    serviceAddress: formatAddress(c.primaryAddress),
    createdAt: c.dateAcquired || null,
    contactMethodIds: { phone: mobile?.contactMethodId || null, email: c.primaryEmail?.contactMethodId || null },
    phones10: [...new Set(phones10)],
  };
}

// When the record was created. dateAcquired is exact on a fresh record but
// can later be reset to midnight (seen after a quote became a booking), so
// take the earliest of it and the services'/appointments' createdDate.
function creationMs(dateAcquired, services, appointments) {
  const times = [...services, ...appointments].map((x) => Date.parse(x.createdDate)).filter(Number.isFinite);
  const acquired = Date.parse(dateAcquired);
  if (Number.isFinite(acquired) && !/T00:00:00(\.0+)?/.test(String(dateAcquired))) times.push(acquired);
  return times.length ? Math.min(...times) : null;
}

const alreadySent = (comms) => comms.some((m) => clean(m.subject).startsWith(LOG_PREFIX) || clean(m.content).startsWith(LOG_PREFIX));

// "11:00:00" -> "11 AM", "13:30:00" -> "1:30 PM"
function clock(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2];
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}${min === '00' ? '' : `:${min}`} ${suffix}`;
}

function timeWindow(appt) {
  const from = clock(appt.arrivalFrom);
  const thru = clock(appt.arrivalThru);
  if (!from || !thru) return null;
  return from.slice(-2) === thru.slice(-2) ? `${from.slice(0, -3)}–${thru}` : `${from}–${thru}`;
}

function dayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
}

const money = (n) => (Number(n) > 0 ? `$${Math.round(Number(n)).toLocaleString('en-US')}` : null);

// Services with scratched/cancelled ones removed and names trimmed, the next
// real appointment for each, and whether any of them is a booking.
function servicesInfo(services, appointments, notBookedCategories) {
  const notBooked = new Set(notBookedCategories.map((c) => c.trim().toLowerCase()));
  const live = services.filter((s) => !SCRATCHED.has(s.statusId) && !s.cancelDate);
  const out = live.map((s) => {
    const category = clean(s.serviceCategoryName);
    const isQuote = notBooked.has(category.toLowerCase());
    const appts = appointments
      .filter((a) => String(a.serviceId) === String(s.serviceId) && a.statusId !== 'SVC_TICK_CANCELLED')
      .sort((a, b) => String(a.appointmentDate).localeCompare(String(b.appointmentDate)));
    const real = appts.filter((a) => clean(a.appointmentTypeName).toLowerCase() !== 'place holder');
    const next = isQuote ? null : real.find((a) => a.statusId === 'SVC_TICK_ACTIVE') || null;
    const quoted = appts.find((a) => Number(a.price) > 0)?.price;
    return {
      category,
      booked: !isQuote,
      status: s.statusId,
      // Initial price; "Quote -" services hold the quoted price in regularAmount.
      price: money(Number(s.initialAmount) > 0 ? s.initialAmount : isQuote ? s.regularAmount || quoted : quoted),
      recurringPrice: isQuote ? null : money(s.regularAmount),
      appointmentDate: next?.appointmentDate || null,
      appointmentDay: next?.appointmentDate ? dayLabel(next.appointmentDate) : null,
      timeWindow: next ? timeWindow(next) : null,
      createdAt: s.createdDate || null,
    };
  });
  return { services: out, booked: out.some((s) => s.booked) };
}

// Calls with a real conversation (inbound answered, or outbound that
// connected long enough to talk).
function isConversation(c) {
  if (c.direction === 'inbound') return c.answered === true && (c.talkSec || 0) >= MIN_TALK_SEC;
  return c.direction === 'outbound' && (c.talkSec || 0) >= MIN_TALK_SEC;
}

// The call the customer record came out of: the longest one in progress (or
// just finished) when the record was created; else the latest one before
// it; else (a callback after the record was made) the first one after.
function pickMainCall(calls, createdMs) {
  if (!calls.length) return null;
  const around = calls.filter((c) => c.startMs <= createdMs + 2 * 60000 && c.endMs + 20 * 60000 >= createdMs);
  if (around.length) return [...around].sort((a, b) => (b.talkSec || 0) - (a.talkSec || 0) || b.startMs - a.startMs)[0];
  const before = calls.filter((c) => c.startMs <= createdMs).sort((a, b) => b.startMs - a.startMs);
  if (before.length) return before[0];
  return [...calls].sort((a, b) => a.startMs - b.startMs)[0];
}

function staffName(ext, config) {
  return ext ? config.staff[ext]?.name || null : null;
}

function callSummary(c, config, transcript) {
  return {
    callId: c.id,
    direction: c.direction,
    start: cal.easternIso(c.startMs),
    end: cal.easternIso(c.endMs),
    talkSec: c.talkSec || 0,
    staff: staffName(c.agent, config) || staffName(transcript?.ext, config),
    transcriptFrom: transcript?.source || null,
    summary: transcript?.summary || null,
  };
}

// Full text for the transcript file: every call today, oldest first, so the
// newest is last.
function transcriptText(calls, mainId, transcripts, config) {
  return calls
    .map((c, i) => {
      const t = transcripts.get(c.id);
      const who = staffName(c.agent, config) || staffName(t?.ext, config) || 'unknown';
      const head = [
        `=== Call ${i + 1} of ${calls.length}${c.id === mainId ? ' (main call)' : ''}: ${c.direction}`,
        `${cal.formatDay(c.startMs)} ${cal.formatTime(c.startMs)}`,
        `${c.direction === 'inbound' ? 'answered by' : 'made by'} ${who}`,
        `${cal.formatDuration(c.talkSec || 0)} ===`,
      ].join(', ');
      if (!t) return `${head}\n(no transcript)\n`;
      return `${head}\nSummary: ${t.summary || '(none)'}\n\nTranscript:\n${t.transcription}\n`;
    })
    .join('\n');
}

module.exports = {
  LOG_PREFIX,
  customerIdFromPayload,
  customerInfo,
  pickMobile,
  formatAddress,
  alreadySent,
  creationMs,
  servicesInfo,
  timeWindow,
  isConversation,
  pickMainCall,
  callSummary,
  transcriptText,
  staffName,
};
