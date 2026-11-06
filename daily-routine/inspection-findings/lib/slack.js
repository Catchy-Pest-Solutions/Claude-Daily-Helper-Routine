// Read-only Slack Web API calls with SLACK_BOT_TOKEN (the "Inspection
// Findings Reader" app: channels:history, groups:history, files:read,
// users:read). The bot must be a member of #inspection-findings, or history
// returns channel_not_found and files return file_not_found (Nov 6, 2026).
// Slack strips EXIF from uploaded photos, so the post time is the photo time.
const fs = require('node:fs');
const { requireEnv } = require('../../lead-followup/lib/env');

function createSlack({ token = requireEnv(['SLACK_BOT_TOKEN']).SLACK_BOT_TOKEN, fetchImpl = fetch } = {}) {
  async function api(method, params = {}) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetchImpl(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 2) * 1000));
        continue;
      }
      const j = await res.json();
      if (!j.ok) {
        const err = new Error(`Slack ${method}: ${j.error}${j.error === 'channel_not_found' ? ' (is the Inspection Findings Reader app in the channel?)' : ''}`);
        err.slackError = j.error;
        throw err;
      }
      return j;
    }
    throw new Error(`Slack ${method}: rate limited`);
  }

  // Top-level messages since oldest (seconds), oldest first.
  async function history(channel, oldest) {
    const out = [];
    let cursor = '';
    do {
      const j = await api('conversations.history', { channel, oldest: String(oldest), limit: '200', ...(cursor ? { cursor } : {}) });
      out.push(...j.messages);
      cursor = j.response_metadata?.next_cursor || '';
    } while (cursor);
    return out.filter((m) => !m.thread_ts || m.thread_ts === m.ts).sort((a, b) => Number(a.ts) - Number(b.ts));
  }

  // Replies in a thread (without the parent), oldest first.
  async function replies(channel, ts) {
    const j = await api('conversations.replies', { channel, ts, limit: '200' });
    return j.messages.filter((m) => m.ts !== ts);
  }

  async function download(file, dest) {
    const url = file.url_private_download || file.url_private;
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || type.startsWith('text/html')) throw new Error(`could not download ${file.name} (${res.status} ${type})`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    return dest;
  }

  const team = async () => api('auth.test');

  return { api, history, replies, download, team };
}

// Slack mrkdwn -> plain text (bold markers, links, user mentions).
function plainText(text) {
  return String(text || '')
    .replace(/<@([A-Z0-9]+)(\|[^>]+)?>/g, (_, id, label) => (label ? `@${label.slice(1)}` : `@${id}`))
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

// "Customer: Jane Doe #12345", "Jane Doe *Customer ID: 12345*",
// "Quote request: Jane Doe #12345" -> { customerId, name, quoteRequest }.
function parsePost(text) {
  const t = plainText(text);
  const quoteRequest = /^\s*quote request\b/i.test(t);
  const idMatch = /(?:#|customer\s*(?:id|#)?\s*[:#]?\s*)(\d{4,6})\b/i.exec(t);
  const customerId = idMatch ? idMatch[1] : null;
  let name = null;
  const labeled = /customer\s*:\s*([^#\n]+?)\s*(?:#|\bcustomer\b|$)/i.exec(t);
  if (labeled) name = labeled[1].trim();
  else if (idMatch) {
    const before = t.slice(0, idMatch.index).replace(/^\s*quote request\s*[:\-]?\s*/i, '').replace(/customer\s*(id)?\s*[:#]?\s*$/i, '').trim();
    name = before.split('\n').pop().trim() || null;
  }
  if (name) name = name.replace(/[,:;\-]+$/, '').trim() || null;
  return { customerId, name, quoteRequest, text: t };
}

module.exports = { createSlack, plainText, parsePost };
