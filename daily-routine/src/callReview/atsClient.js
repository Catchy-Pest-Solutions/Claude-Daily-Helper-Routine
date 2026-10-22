// ATS (Voice for Pest) API v2 client. Confirmed against the live API:
// - Call history lives in GET /search. /call-center-cdrs-search belongs to
//   ATS's separate call-center product and is always empty for Catchy.
// - /search timestamps and date/time filters are UTC; pages are a fixed 50
//   rows (limit/per_page params are ignored). Always pass start_time and
//   end_time: a bare end_date means midnight at the start of that day.
// - Tokens last 15 minutes. Every response carries a token field; an
//   expired one comes back as { token: "[ invalid ]", status: "error" }.
// - AI transcripts live in GET /sync-transcriptions: one feed shared by
//   every ATS customer, ids ascending, 100 rows max with id > last_id.
//   Other customers' rows come back as { id, access: false }. No filter
//   (customer, date, cdr_id) is honoured, so finding a day's transcripts
//   means walking back from the newest id. Our rows carry cdr_id, which is
//   the /search call_id, and call_time in UTC.
const { toAtsUtc, parseAtsUtc } = require('./calendar');

const BASE = 'https://api.atscall.me/api-v2/';
const TOKEN_TTL_MS = 13 * 60 * 1000;
const FEED_PAGE = 100;
// Transcripts land in the feed a few minutes after the call, not strictly
// in call order, so keep walking until one of ours is this much older than
// the start of the range.
const TRANSCRIPT_LAG_MS = 60 * 60 * 1000;

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

  const transcriptPage = (lastId) => get('sync-transcriptions', { last_id: String(Math.max(0, lastId)), limit: String(FEED_PAGE) });

  // Newest id in the transcript feed: gallop up, then bisect (~25 requests).
  async function latestTranscriptId() {
    let lo = 0;
    let step = 1000000;
    while ((await transcriptPage(lo + step)).length) {
      lo += step;
      step *= 2;
    }
    let hi = lo + step;
    while (hi - lo > FEED_PAGE) {
      const mid = Math.floor((lo + hi) / 2);
      if ((await transcriptPage(mid)).length) lo = mid;
      else hi = mid;
    }
    const rows = await transcriptPage(lo);
    return rows.length ? rows[rows.length - 1].id : lo;
  }

  // Our transcripts for calls from startMs on, oldest first. One weekday is
  // roughly 350 pages (about 35 seconds); a Monday walks back over the
  // weekend, so several times that. complete is false if maxPages ran out.
  async function searchTranscripts(startMs, { maxPages = 3000, parallel = 6 } = {}) {
    const headId = await latestTranscriptId();
    let cursor = headId;
    const ours = [];
    let pages = 0;
    let passedStart = false;
    while (!passedStart && cursor > 0 && pages < maxPages) {
      const batch = await Promise.all(Array.from({ length: parallel }, (_, i) => transcriptPage(cursor - FEED_PAGE * (i + 1))));
      cursor -= FEED_PAGE * parallel;
      pages += parallel;
      for (const row of batch.flat()) {
        if (row.access === false) continue;
        ours.push(row);
        if (parseAtsUtc(row.call_time) < startMs - TRANSCRIPT_LAG_MS) passedStart = true;
      }
    }
    const byId = new Map(ours.map((r) => [r.id, r]));
    const transcripts = [...byId.values()].filter((r) => parseAtsUtc(r.call_time) >= startMs).sort((a, b) => a.id - b.id);
    return { transcripts, complete: passedStart || cursor <= 0, pages, headId };
  }

  // Our transcripts that arrived after lastId, plus the new cursor. Between
  // two checks a couple of minutes apart this is usually 2-3 requests.
  async function transcriptsAfter(lastId, { maxPages = 200 } = {}) {
    const ours = [];
    let cursor = lastId;
    for (let page = 0; page < maxPages; page++) {
      const rows = await transcriptPage(cursor);
      if (!rows.length) break;
      cursor = rows[rows.length - 1].id;
      ours.push(...rows.filter((r) => r.access !== false));
      if (rows.length < FEED_PAGE) break;
    }
    return { transcripts: ours, cursor };
  }

  return {
    searchCalls,
    searchInboundTexts: (s, e) => searchTexts('sms-inbound', s, e),
    searchOutboundTexts: (s, e) => searchTexts('sms-outbound', s, e),
    searchTranscripts,
    transcriptsAfter,
    latestTranscriptId,
    requestCount: () => requests,
  };
}

module.exports = { createAtsClient };
