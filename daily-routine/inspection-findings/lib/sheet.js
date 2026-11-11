// The "Leads" Google Sheet (bonuses, payroll, repeat checks), kept through
// the Drive API only. office@'s token has drive.file but the Sheets API is
// not enabled on its Google Cloud project (403 SERVICE_DISABLED, Nov 6), so
// the sheet is read by exporting it as CSV and written by uploading CSV back
// over it. Each write first re-reads the sheet, so Daniel's hand edits (a
// changed bonus) are kept. Only the first tab survives a write, so the sheet
// has one tab; formatting is reset on each write.
// The sheet is also the record of which Slack posts were handled: one row
// per post, keyed by its Slack ts ("Post ID").
const crypto = require('node:crypto');
const google = require('../../lead-followup/lib/google');

// Readable order for payroll: who, what, the bonus and why first, the
// quote details after. "Post ID" (<slack ts>:<plan key>) is the key; rows
// without one are the total rows, rebuilt on every write. Columns are read
// back by name, so the order can change without touching old rows.
const COLUMNS = ['Pay week', 'Tech', 'Visit date', 'Customer', 'Finding', 'Bonus', 'Counted', 'Notes', 'Plan', 'Quote', 'Credit', 'Status', 'Credit good through', 'Customer ID', 'Post ID'];
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x !== ''));
}

const csvField = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) => `${rows.map((r) => r.map(csvField).join(',')).join('\r\n')}\r\n`;

// [[header...], [values...]] -> [{header: value}]; unknown extra columns kept.
function rowsToObjects(rows) {
  if (!rows.length) return { header: COLUMNS.slice(), items: [] };
  const header = rows[0];
  const items = rows
    .slice(1)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
    .filter((it) => it['Post ID']);
  return { header, items };
}

async function readSheet(fileId) {
  const token = await google.accessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Google sheet ${fileId} export -> ${res.status} ${(await res.text()).slice(0, 120)}`);
  return rowsToObjects(parseCsv(await res.text()));
}

// Pay week (Thursday-Wednesday) for a visit date: "Nov 5 - Nov 11, 2026".
function payWeekOf(ymd) {
  const d = new Date(`${toYmd(ymd)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() - 4 + 7) % 7));
  const end = new Date(d.getTime() + 6 * 86400000);
  const f = (x) => x.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  return `${f(d)} - ${f(end)}, ${end.getUTCFullYear()}`;
}

// Sheets shows imported dates its own way; accept YYYY-MM-DD and M/D/YYYY.
function toYmd(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : s;
}
const toNumber = (v) => Number(String(v ?? '').replace(/[$,\s]/g, '')) || 0;
const dollars = (v) => (v === '' || v == null ? '' : `$${toNumber(v).toFixed(toNumber(v) % 1 ? 2 : 0)}`);

// Lead rows grouped by pay week (newest first). Within a week, each tech's
// leads (oldest first) are followed by that tech's total, and the week ends
// with an all-techs total. Totals are SUMIFS formulas, so a bonus Daniel
// edits by hand updates them right away.
function layout(items) {
  const cols = COLUMNS;
  const col = (name) => String.fromCharCode(65 + cols.indexOf(name));
  const [W, T, B, P] = [col('Pay week'), col('Tech'), col('Bonus'), col('Post ID')];
  const weeks = new Map();
  for (const it of items) {
    const week = it['Pay week'] || payWeekOf(it['Visit date']);
    if (!weeks.has(week)) weeks.set(week, []);
    weeks.get(week).push({ ...it, 'Pay week': week, 'Visit date': toYmd(it['Visit date']), 'Credit good through': toYmd(it['Credit good through']), Bonus: dollars(it.Bonus), Quote: dollars(it.Quote), Credit: dollars(it.Credit) });
  }
  const weekStart = (w) => weeks.get(w).map((r) => r['Visit date']).sort()[0] || '';
  const blank = () => cols.map(() => '');
  const out = [cols];
  for (const week of [...weeks.keys()].sort((a, b) => weekStart(b).localeCompare(weekStart(a)))) {
    const rows = weeks.get(week).sort((a, b) => a.Tech.localeCompare(b.Tech) || a['Visit date'].localeCompare(b['Visit date']));
    const weekRow = out.length + 1; // a row holding this week's label in column A
    for (const tech of [...new Set(rows.map((r) => r.Tech))]) {
      rows.filter((r) => r.Tech === tech).forEach((r) => out.push(cols.map((c) => r[c] ?? '')));
      const line = blank();
      line[cols.indexOf('Pay week')] = week;
      line[cols.indexOf('Tech')] = `${tech} - week total`;
      line[cols.indexOf('Bonus')] = `=DOLLAR(SUMIFS(${B}:${B},${W}:${W},${W}${weekRow},${T}:${T},"${tech.replace(/"/g, '""')}"))`;
      out.push(line);
    }
    const total = blank();
    total[cols.indexOf('Pay week')] = week;
    total[cols.indexOf('Tech')] = 'ALL TECHS - week total';
    total[cols.indexOf('Bonus')] = `=DOLLAR(SUMIFS(${B}:${B},${W}:${W},${W}${weekRow},${P}:${P},"<>"))`;
    out.push(total, blank());
  }
  return out;
}

async function writeSheet(fileId, _header, items) {
  const csv = toCsv(layout(items));
  const token = await google.accessToken();
  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/csv' },
    body: csv,
  });
  if (!res.ok) throw new Error(`Google sheet ${fileId} write -> ${res.status} ${(await res.text()).slice(0, 120)}`);
}

// Adds or replaces rows by Post ID (re-reading first so hand edits stay).
// Once a row is settled (any status but "waiting"), its Bonus is never
// overwritten: that's where Daniel's hand edits live.
async function upsertRows(fileId, rows) {
  const { header, items } = await readSheet(fileId);
  for (const row of rows) {
    const i = items.findIndex((it) => it['Post ID'] === row['Post ID']);
    if (i < 0) items.push(row);
    else {
      const settled = items[i].Status && items[i].Status !== 'waiting' && items[i].Bonus !== '';
      items[i] = { ...items[i], ...row, ...(settled ? { Bonus: items[i].Bonus } : {}) };
    }
  }
  await writeSheet(fileId, header, items);
  return items.length;
}

// Creates the sheet in the Drive folder (header row only) and shares it
// with shareWith as a writer. Returns its file ID.
async function createSheet({ name, folderId, shareWith }) {
  const boundary = `b${crypto.randomBytes(12).toString('hex')}`;
  const meta = JSON.stringify({ name, mimeType: SHEET_MIME, ...(folderId ? { parents: [folderId] } : {}) });
  const body = Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: text/csv\r\n\r\n${toCsv([COLUMNS])}\r\n--${boundary}--\r\n`);
  const token = await google.accessToken();
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`creating the sheet -> ${res.status} ${j.error?.message || ''}`);
  if (shareWith) {
    const p = await fetch(`https://www.googleapis.com/drive/v3/files/${j.id}/permissions?sendNotificationEmail=true`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: shareWith }),
    });
    if (!p.ok) throw new Error(`sharing the sheet -> ${p.status} ${(await p.text()).slice(0, 120)}`);
  }
  return { id: j.id, url: j.webViewLink || `https://docs.google.com/spreadsheets/d/${j.id}/edit` };
}

const sheetUrl = (id) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

module.exports = { COLUMNS, parseCsv, toCsv, rowsToObjects, readSheet, writeSheet, upsertRows, createSheet, sheetUrl, layout, payWeekOf, toYmd, toNumber };
