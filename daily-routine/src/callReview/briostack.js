// Briostack calls the call review makes. Confirmed against the live API:
// - Auth: X-Api-Key header. Bursts return {"message":"Too Many Requests"},
//   so calls go one at a time with a pause and a retry.
// - Searching: collection endpoints ignore plain query params but accept a
//   `filter` expression, e.g. filter=primaryPhone.number="+18285550100"
//   (double quotes required; single quotes are a parse error). Only some
//   properties are filterable: primaryPhone.number, firstName and
//   lastName work (with = or like "Abc%"), secondaryPhone.number doesn't.
//   On /tasks, statusId works, partyId doesn't.
// - List results leave out secondaryPhone; GET /customers/{id} includes it
//   when the customer has one.
// - POST /tasks rejects unknown properties. Accepted: title, taskTypeId,
//   statusId, description, employeeId (assignee's employee ID), partyId
//   (customer ID), startDate, dueDate (full ISO timestamps with offset).
//   There's no priority field. Open tasks use statusId ORDER_REQMNT_CREATED.
//   taskTypeId must be an existing type (CALL, APPOINTMENT_REVIEW,
//   BID_FOLLOWUP, ...); there's no endpoint that lists them.

const OPEN_STATUS = 'ORDER_REQMNT_CREATED';

// Most customers with one last name we'll open one by one to check
// secondary phones (each is one API call).
const MAX_NAME_CANDIDATES = 8;

// "Kenneth Edward" -> { first: 'Kenneth', last: 'Edward' }. Letters only,
// so nothing can break out of the filter's quoted string.
function searchableName(callerName) {
  const parts = String(callerName || '')
    .split(/\s+/)
    .map((p) => p.replace(/[^A-Za-z-]/g, ''))
    .filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  const first = parts[0].length > 1 ? parts[0] : null;
  return last.length >= 3 ? { first, last } : null;
}

function createBriostackCallbackClient({ baseUrl, apiKey, config, fetchImpl = fetch, pauseMs = 1500 }) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  let requests = 0;

  async function call(method, path, body) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetchImpl(`${base}${path}`, {
        method,
        headers: { 'X-Api-Key': apiKey, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      requests++;
      const text = await res.text();
      if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
      if (text.includes('Too Many Requests')) {
        await new Promise((r) => setTimeout(r, pauseMs * (attempt + 2)));
        continue;
      }
      if (!res.ok) throw new Error(`Briostack ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
      return text ? JSON.parse(text) : null;
    }
    throw new Error(`Briostack ${method} ${path} kept returning Too Many Requests`);
  }

  const filterQuery = (expr) => `filter=${encodeURIComponent(expr)}`;

  function toCustomer(c, services, extra = {}) {
    const a = c.primaryAddress || {};
    return {
      id: c.customerId,
      name: [c.firstName, c.lastName].map((x) => String(x || '').trim()).filter(Boolean).join(' ') || `Customer ${c.customerId}`,
      statusId: c.statusId,
      address: [a.address, a.city].filter(Boolean).join(', ') || null,
      amountDue: c.amountDue,
      daysPastDue: c.daysPastDue,
      services: Array.isArray(services) ? services : [],
      ...extra,
    };
  }

  const pickActive = (list) => list.find((m) => m.statusId === 'CUSTOMER_ACTIVE') || list[0];

  // Customer for a caller, with services for the task description, or null.
  // 1. Primary phone match (one call).
  // 2. If caller ID shows a person's name: customers with that last name
  //    (prefix match, since caller ID truncates names), then each one's
  //    record, checking the secondary phone. Skipped when the name is too
  //    common to check cheaply.
  async function findCustomerByPhone(phone10, callerName = null) {
    const e164 = `+1${phone10}`;
    const matches = await call('GET', `customers?${filterQuery(`primaryPhone.number="${e164}"`)}`);
    if (Array.isArray(matches) && matches.length) {
      const c = pickActive(matches);
      const services = await call('GET', `customers/${c.customerId}/services`).catch(() => []);
      return toCustomer(c, services, { matchedOn: 'primary phone', otherMatches: matches.length - 1 });
    }

    const name = searchableName(callerName);
    if (!name) return null;
    let candidates = await call('GET', `customers?${filterQuery(`lastName like "${name.last}%"`)}`);
    if (Array.isArray(candidates) && candidates.length > MAX_NAME_CANDIDATES && name.first) {
      candidates = await call('GET', `customers?${filterQuery(`lastName like "${name.last}%" and firstName like "%${name.first}%"`)}`);
    }
    if (!Array.isArray(candidates) || !candidates.length || candidates.length > MAX_NAME_CANDIDATES) return null;

    const hits = [];
    for (const cand of candidates) {
      const full = await call('GET', `customers/${cand.customerId}`);
      if (full?.secondaryPhone?.number === e164) hits.push({ ...full, customerId: full.customerId || cand.customerId });
    }
    if (!hits.length) return null;
    const c = pickActive(hits);
    const services = await call('GET', `customers/${c.customerId}/services`).catch(() => []);
    return toCustomer(c, services, { matchedOn: 'secondary phone', otherMatches: hits.length - 1 });
  }

  // Open tasks, so a caller who already has an open callback task doesn't
  // get a second one.
  async function listOpenTasks() {
    const tasks = await call('GET', `tasks?${filterQuery(`statusId="${OPEN_STATUS}"`)}`);
    return Array.isArray(tasks) ? tasks : [];
  }

  // Returns the new task's ID.
  async function createTask(task) {
    if (!config.taskTypeId) throw new Error('no callback task type set (config.taskTypeId)');
    const employeeId = config.staff[task.assigneeExt]?.briostackEmployeeId;
    const body = {
      title: task.title,
      taskTypeId: config.taskTypeId,
      statusId: OPEN_STATUS,
      description: task.description,
      startDate: task.startDate,
      dueDate: task.dueDate,
      ...(employeeId ? { employeeId } : {}),
      ...(task.customerId ? { partyId: String(task.customerId) } : {}),
    };
    const created = await call('POST', 'tasks', body);
    return created.taskId;
  }

  return { findCustomerByPhone, listOpenTasks, createTask, requestCount: () => requests };
}

module.exports = { createBriostackCallbackClient, searchableName, OPEN_STATUS };
