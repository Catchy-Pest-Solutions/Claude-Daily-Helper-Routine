// Google APIs as office@catchypestsolutions.com, with the OAuth refresh token
// in GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN. Its scopes
// are gmail.send, gmail.readonly (voicemail emails) and drive.file: it can
// only see Drive files and folders this same OAuth client created (so the
// "AI Follow-ups" folder was created with it too).
const crypto = require('node:crypto');
const { requireEnv } = require('./env');

let cached = null;

async function accessToken() {
  if (cached && cached.expires > Date.now() + 60000) return cached.token;
  const env = requireEnv(['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN']);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`Google sign-in failed (${res.status} ${j.error || ''})`);
  cached = { token: j.access_token, expires: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

async function google(method, url, { json, body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: json ? JSON.stringify(json) : body,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = data?.error?.message || text.slice(0, 120);
    throw new Error(`Google ${method} ${new URL(url).pathname} -> ${res.status} ${msg}`);
  }
  return data;
}

const randomName = (prefix, ext) => `${prefix}-${crypto.randomBytes(16).toString('hex')}.${ext}`;

// Uploads a file into the folder and shares it "Anyone with the link" (view).
async function uploadShared({ folderId, name, mimeType, data }) {
  const boundary = `b${crypto.randomBytes(12).toString('hex')}`;
  const meta = JSON.stringify({ name, parents: [folderId], mimeType });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const file = await google('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    body,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
  });
  await google('POST', `https://www.googleapis.com/drive/v3/files/${file.id}/permissions?sendNotificationEmail=false`, {
    json: { role: 'reader', type: 'anyone', allowFileDiscovery: false },
  });
  return file.id;
}

// Direct image link Textable can fetch: returns the JPG itself, no redirect.
const imageUrl = (id) => `https://lh3.googleusercontent.com/d/${id}`;
// Normal share link (opens Drive's viewer). Fine as a link in a message.
const shareUrl = (id) => `https://drive.google.com/file/d/${id}/view?usp=sharing`;

// Confirms the public image link serves a JPG to someone not signed in.
// Sharing can take a few seconds to apply, so retry briefly.
async function checkPublicImage(url, { tries = 6, pauseMs = 3000 } = {}) {
  let last = '';
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      const type = res.headers.get('content-type') || '';
      await res.arrayBuffer();
      if (res.status === 200 && type.startsWith('image/jpeg')) return true;
      last = `${res.status} ${type}`;
    } catch (err) {
      last = err.message;
    }
    await new Promise((r) => setTimeout(r, pauseMs));
  }
  throw new Error(`picture link isn't public yet (${last})`);
}

// RFC 2047 encoding for non-ASCII header text (names, subjects).
function encodeHeader(text) {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

const b64Lines = (buf) => buf.toString('base64').replace(/.{76}(?=.)/g, '$&\r\n');

// Builds the MIME message: mixed[ related[ alternative[text, html], inline images ], attachments ].
function buildMime({ fromName, fromEmail, to, subject, text, html, inline = [], attachments = [] }) {
  const id = () => crypto.randomBytes(10).toString('hex');
  const mixed = `mixed_${id()}`;
  const related = `related_${id()}`;
  const alt = `alt_${id()}`;
  const lines = [
    `From: ${encodeHeader(fromName)} <${fromEmail}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    '',
    `--${mixed}`,
    `Content-Type: multipart/related; boundary="${related}"`,
    '',
    `--${related}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64Lines(Buffer.from(text, 'utf8')),
    `--${alt}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64Lines(Buffer.from(html, 'utf8')),
    `--${alt}--`,
  ];
  for (const img of inline) {
    lines.push(
      `--${related}`,
      `Content-Type: ${img.mimeType}; name="${img.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-ID: <${img.cid}>`,
      `Content-Disposition: inline; filename="${img.filename}"`,
      '',
      b64Lines(img.data),
    );
  }
  lines.push(`--${related}--`);
  for (const att of attachments) {
    lines.push(
      `--${mixed}`,
      `Content-Type: ${att.mimeType}; name="${att.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${att.filename}"`,
      '',
      b64Lines(att.data),
    );
  }
  lines.push(`--${mixed}--`, '');
  return lines.join('\r\n');
}

async function sendMail(message) {
  const raw = Buffer.from(buildMime(message), 'utf8').toString('base64url');
  const sent = await google('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { json: { raw } });
  return sent.id;
}

// Gmail search (needs the gmail.readonly scope): message IDs, newest first.
async function listMessages(q, max = 100) {
  const ids = [];
  let pageToken = '';
  while (ids.length < max) {
    const qs = new URLSearchParams({ q, maxResults: String(Math.min(100, max - ids.length)), ...(pageToken ? { pageToken } : {}) });
    const page = await google('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages?${qs}`);
    ids.push(...(page?.messages || []).map((m) => m.id));
    pageToken = page?.nextPageToken;
    if (!pageToken) break;
  }
  return ids;
}

// One message's subject, received time and HTML/plain body (attachments skipped).
async function getMessage(id) {
  const msg = await google('GET', `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`);
  const header = (name) => (msg.payload?.headers || []).find((h) => h.name.toLowerCase() === name)?.value || '';
  const find = (part, type) => (part?.mimeType === type && part.body?.data ? part : (part?.parts || []).map((p) => find(p, type)).find(Boolean));
  const body = (type) => {
    const part = find(msg.payload, type);
    return part ? Buffer.from(part.body.data, 'base64url').toString('utf8') : '';
  };
  return { id, internalDate: Number(msg.internalDate), subject: header('subject'), html: body('text/html') || body('text/plain') };
}

module.exports = { listMessages, getMessage, accessToken, uploadShared, imageUrl, shareUrl, checkPublicImage, randomName, buildMime, sendMail, encodeHeader };
