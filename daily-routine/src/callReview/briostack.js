// Briostack calls the call review makes. Confirmed against the live API:
// - Auth: X-Api-Key header. Bursts return {"message":"Too Many Requests"},
//   so calls go one at a time with a pause and a retry.
// - Searching: collection endpoints ignore plain query params but accept a
//   `filter` expression, e.g. filter=primaryPhone.number="+18285550100"
//   (double quotes required; single quotes are a parse error). Only some
//   properties are filterable: primaryPhone.number works,
//   secondaryPhone.number doesn't. On /tasks, statusId works, partyId
//   doesn't.
// - POST /tasks rejects unknown properties. Accepted: title, taskTypeId,
//   statusId, description, employeeId (assignee's employee ID), partyId
//   (customer ID), startDate, dueDate (full ISO timestamps with offset).
//   There's no priority field. Open tasks use statusId ORDER_REQMNT_CREATED.
//   taskTypeId must be an existing type (CALL, APPOINTMENT_REVIEW,
//   BID_FOLLOWUP, ...); there's no endpoint that lists them.

const OPEN_STATUS = 'ORDER_REQMNT_CREATED';

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

  // Customer whose primary phone matches, with services for the task
  // description. Returns null when there's no match.
  async function findCustomerByPhone(phone10) {
    const matches = await call('GET', `customers?${filterQuery(`primaryPhone.number="+1${phone10}"`)}`);
    if (!Array.isArray(matches) || !matches.length) return null;
    // Prefer an active record when a number is on more than one account.
    const c = matches.find((m) => m.statusId === 'CUSTOMER_ACTIVE') || matches[0];
    const services = await call('GET', `customers/${c.customerId}/services`).catch(() => []);
    const a = c.primaryAddress || {};
    return {
      id: c.customerId,
      name: [c.firstName, c.lastName].map((x) => String(x || '').trim()).filter(Boolean).join(' ') || `Customer ${c.customerId}`,
      statusId: c.statusId,
      address: [a.address, a.city].filter(Boolean).join(', ') || null,
      amountDue: c.amountDue,
      daysPastDue: c.daysPastDue,
      services: Array.isArray(services) ? services : [],
      otherMatches: matches.length - 1,
    };
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

module.exports = { createBriostackCallbackClient, OPEN_STATUS };
