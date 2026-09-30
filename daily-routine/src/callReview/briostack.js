// Briostack calls the call review makes. Confirmed against the live API:
// - Auth: X-Api-Key header. Bursts return {"message":"Too Many Requests"},
//   so calls go one at a time with a pause and a retry.
// - No phone search. GET /customers ignores every filter (phone,
//   phoneNumber, primaryPhone, q, search, ...) and /customers/search,
//   /lookup, /find, /parties and /contacts don't exist. So callers can't be
//   matched to a customer through the API.
// - POST /tasks rejects unknown properties. Accepted: title, taskTypeId,
//   statusId, description, employeeId (assignee's employee ID), partyId
//   (customer ID), startDate, dueDate (full ISO timestamps with offset).
//   There's no priority field. Open tasks use statusId ORDER_REQMNT_CREATED.
//   taskTypeId must be an existing type (e.g. APPOINTMENT_REVIEW,
//   BAD_EMAIL); there's no endpoint that lists them.

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

  return { createTask, requestCount: () => requests };
}

module.exports = { createBriostackCallbackClient, OPEN_STATUS };
