// Briostack calls the call review makes: find a customer by phone, pull a
// little context for the task, and create the callback task.
//
// Verified against the live API: X-Api-Key auth, GET /customers/{id},
// /customers/{id}/services, /customers/{id}/appointments. Bursts return
// {"message":"Too Many Requests"}, so calls go one at a time with a pause
// and a retry.
//
// NOT YET VERIFIED (waiting on a live test): the phone-lookup query and the
// task-create endpoint/fields. Until they are, findCustomerByPhone returns
// null and createTask throws, so the run still reports every caller.

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
      await new Promise((r) => setTimeout(r, pauseMs));
      if (text.includes('Too Many Requests')) {
        await new Promise((r) => setTimeout(r, pauseMs * (attempt + 2)));
        continue;
      }
      if (!res.ok) throw new Error(`Briostack ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
      return text ? JSON.parse(text) : null;
    }
    throw new Error(`Briostack ${method} ${path} kept returning Too Many Requests`);
  }

  async function customerContext(id) {
    const c = await call('GET', `customers/${id}`);
    const services = await call('GET', `customers/${id}/services`).catch(() => []);
    const a = c.primaryAddress || {};
    return {
      id,
      name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.companyName || `Customer ${id}`,
      statusId: c.statusId,
      address: [a.addressLine1 || a.street, a.city].filter(Boolean).join(', ') || null,
      amountDue: c.amountDue,
      daysPastDue: c.daysPastDue,
      services: Array.isArray(services) ? services : services?.items || [],
    };
  }

  async function findCustomerByPhone(/* phone10 */) {
    return null;
  }

  async function createTask(/* task */) {
    throw new Error('task creation not set up yet');
  }

  return { findCustomerByPhone, customerContext, createTask, requestCount: () => requests, config };
}

module.exports = { createBriostackCallbackClient };
