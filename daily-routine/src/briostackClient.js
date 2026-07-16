// Field names below are confirmed against the live Briostack REST v1 API
// (https://catchypestsolutions.briostack.io/rest/v1/), not assumed from docs.
// Auth: X-Api-Key header. Collection-level query params (customerId, page,
// offset, statusId, date filters) are silently ignored by the API -- only
// the nested /customers/{id}/services and /customers/{id}/appointments
// routes actually filter server-side, so this client always goes through
// the customer-scoped routes.

function createBriostackClient({ baseUrl, apiKey, fetchImpl = fetch }) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;

  async function getJson(path) {
    const res = await fetchImpl(`${base}${path}`, { headers: { 'X-Api-Key': apiKey } });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Briostack request failed: GET ${path} -> ${res.status} ${body}`);
    }
    return res.json();
  }

  return {
    getCustomerServices: (customerId) => getJson(`customers/${customerId}/services`),
    getCustomerAppointments: (customerId) => getJson(`customers/${customerId}/appointments`),
  };
}

module.exports = { createBriostackClient };
