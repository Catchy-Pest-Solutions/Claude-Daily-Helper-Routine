// Minimal Textable (ATS Texting) client for the call review's follow-up
// texts. See TEXTABLE_API.md. Texts go out from the office number
// (828-263-4804), the same caller ID customers see when we call.
const BASE = 'https://atscall-txb.textable.app/api/';

// First of the names that's set, ignoring case (the routine's environment
// has Textable_Account_UID / Textable_Token).
function envAny(env, ...names) {
  const wanted = names.map((n) => n.toLowerCase());
  const key = Object.keys(env).find((k) => wanted.includes(k.toLowerCase()) && String(env[k]).trim());
  return key ? String(env[key]).trim() : null;
}

function textableCredentials(env = process.env) {
  const uid = envAny(env, 'TEXTABLE_ACCOUNT_UID', 'TEXTABLE_USER_ID');
  const token = envAny(env, 'TEXTABLE_API_TOKEN', 'TEXTABLE_TOKEN');
  return uid && token ? { uid, token } : null;
}

function createTextableClient({ uid, token, fetchImpl = fetch, pauseMs = 1000 }) {
  const headers = { Authorization: `Bearer ${uid}:${token}`, 'Content-Type': 'application/json' };
  let requests = 0;

  // { phone10: last message time (ms) } for every Textable contact. One
  // request: the endpoint returns all contacts with no paging.
  async function lastMessageByPhone() {
    const res = await fetchImpl(`${BASE}contacts`, { headers });
    requests++;
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || !Array.isArray(body.contacts)) throw new Error(`Textable GET contacts failed: ${res.status}`);
    const out = {};
    for (const c of body.contacts) {
      const digits = String(c.phoneNumber || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
      if (digits.length !== 10) continue;
      const ms = Number(c.last_message_date) || 0;
      out[digits] = Math.max(out[digits] || 0, ms);
    }
    return out;
  }

  // Returns 'sent', 'opted_out' or 'failed: ...'. Never throws.
  async function send({ to, from, message }) {
    let res;
    try {
      res = await fetchImpl(`${BASE}send`, { method: 'POST', headers, body: JSON.stringify({ to, from, message }) });
    } catch (err) {
      return `failed: no response from Textable (it may have gone through): ${err.message}`;
    } finally {
      requests++;
    }
    const j = await res.json().catch(() => ({}));
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
    if (res.status === 451) return 'opted_out';
    if (res.ok && j.status === true) return 'sent';
    return `failed: Textable ${res.status} ${String(j.message || j.error || '').slice(0, 120)}`.trim();
  }

  return { lastMessageByPhone, send, requestCount: () => requests };
}

module.exports = { createTextableClient, textableCredentials };
