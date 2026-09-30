// ATS (Voice for Pest) API v2 client. Confirmed against the live API:
// - Call history lives in GET /search. /call-center-cdrs-search belongs to
//   ATS's separate call-center product and is always empty for Catchy.
// - /search timestamps and date/time filters are UTC; pages are a fixed 50
//   rows (limit/per_page params are ignored). Always pass start_time and
//   end_time: a bare end_date means midnight at the start of that day.
// - Tokens last 15 minutes. Every response carries a token field; an
//   expired one comes back as { token: "[ invalid ]", status: "error" }.
const { toAtsUtc } = require('./calendar');

const BASE = 'https://api.atscall.me/api-v2/';
const TOKEN_TTL_MS = 13 * 60 * 1000;

function createAtsClient({ username, password, customerId, fetchImpl = fetch, pauseMs = 300 }) {
  let token = null;
  let tokenAt = 0;
  let requests = 0;

  async function auth() {
    const form = new FormData();
    form.append('username', username);
    form.append('password', password);
    const res = await fetchImpl(`${BASE}auth`, { method: 'POST', body: form });
    requests++;
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.token || body.token.includes('invalid')) {
      throw new Error(`ATS auth failed: ${res.status} ${body.error || body.message || ''}`.trim());
    }
    token = body.token;
    tokenAt = Date.now();
  }

  async function get(path, params, retried = false) {
    if (!token || Date.now() - tokenAt > TOKEN_TTL_MS) await auth();
    const qs = new URLSearchParams({ customer_id: String(customerId), ...params });
    const res = await fetchImpl(`${BASE}${path}?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    requests++;
    const body = await res.json().catch(() => null);
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
    const authError = res.status === 401 || res.status === 403 || (body && body.status === 'error' && String(body.token).includes('invalid'));
    if (authError && !retried) {
      token = null;
      return get(path, params, true);
    }
    if (!res.ok || !body || body.status === 'error') {
      throw new Error(`ATS GET ${path} failed: ${res.status} ${(body && (body.error || body.message)) || ''}`.trim());
    }
    return body;
  }

  function rangeParams(startMs, endMs) {
    const s = toAtsUtc(startMs);
    const e = toAtsUtc(endMs);
    return { start_date: s.date, start_time: s.time, end_date: e.date, end_time: e.time };
  }

  // All call legs between two instants, every page.
  async function searchCalls(startMs, endMs) {
    const rows = [];
    for (let page = 1; ; page++) {
      const body = await get('search', { ...rangeParams(startMs, endMs), page: String(page) });
      rows.push(...(body.results || []));
      const totalPages = body.report?.page_info?.total_pages ?? 0;
      if (page >= totalPages) break;
    }
    return rows;
  }

  // Texts sent/received through ATS. Both endpoints return
  // { message: { results, totalPages } } rather than the /search shape.
  async function searchTexts(path, startMs, endMs) {
    const rows = [];
    for (let page = 1; ; page++) {
      const body = await get(path, { ...rangeParams(startMs, endMs), page: String(page) });
      const msg = body.message && typeof body.message === 'object' ? body.message : {};
      rows.push(...(msg.results || []));
      if (page >= (msg.totalPages || 0)) break;
    }
    return rows;
  }

  return {
    searchCalls,
    searchInboundTexts: (s, e) => searchTexts('sms-inbound', s, e),
    searchOutboundTexts: (s, e) => searchTexts('sms-outbound', s, e),
    requestCount: () => requests,
  };
}

module.exports = { createAtsClient };
