#!/usr/bin/env node
// Step 5 of the new-customer follow-up (ROUTINE_PROMPT.md).
//
//   node send.js --plan $S/plan.json [--no-log] [--preview]
//
// Sends the text (Textable, from 828-263-4804; scheduled if sendAt is set)
// and the email (Gmail API as office@, From "<signedAs> at Catchy Pest
// Solutions", branded HTML with the quote card inline and the PDF
// attached), then logs one entry per message on the customer's Briostack
// Communications tab. Prints one JSON line:
//   {"text": "...", "email": "...", "log": "...", "testMode": true|false}
// text: sent | scheduled | opted_out | skipped (no number) | failed: ...
// email: sent | skipped (no address) | failed: ...
// log: logged | logged (PDF not attached: ...) | skipped (--no-log) | failed: ...
//
// Test mode (config.json "testMode": true): the text goes to testPhone with
// "TEST for <name> <phone>:" on top, the email to testEmail with
// "[TEST for <name>]" before the subject, and each log entry starts with
// "[AI FOLLOW-UP — TEST, not sent to customer]". The log entries still go
// on the real customer, which keeps duplicate protection working.
// --no-log skips Briostack (for testing). --preview builds everything into
// the plan's folder (text-preview.txt, email-preview.html) and sends nothing.
require('./lib/proxy');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, parseArgs, requireEnv } = require('./lib/env');
const { render, escapeHtml } = require('./lib/template');
const google = require('./lib/google');
const { createBriostack } = require('./lib/briostack');
const cal = require('../src/callReview/calendar');
const { normalizePhone, formatPhone } = require('../src/callReview/callAnalysis');

const LOGO = path.join(__dirname, 'assets', 'logo-email.png');
const LIVE_PREFIX = '[AI FOLLOW-UP]';
const TEST_PREFIX = '[AI FOLLOW-UP — TEST, not sent to customer]';
const TEXTABLE = 'https://atscall-txb.textable.app/api/send';

const isNull = (v) => v == null || v === '' || v === 'null';

// Technician names (Daniel, Nov 4): a message may only name a technician on
// config.json "technicians", spelled that way. Speech-to-text turns Dustin
// into Justin and Sidney into Sydney, and a wrong name can't be taken back.
const NOT_NAMES = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'today', 'tomorrow',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'and', 'or', 'will', 'is', 'can', 'should', 'from', 'at', 'in', 'on', 'catchy', 'here', 'just']);
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
// Names the message gives a technician ("tech Dustin", "our technician,
// Sidney", "technician named Joey", "Max will be your technician") that aren't on
// the roster, each with the closest roster name (or null).
function technicianNameProblems(message, roster) {
  const ok = new Map((roster || []).map((n) => [String(n).toLowerCase(), String(n)]));
  const name = "([A-Z][a-z]+(?:'s)?)";
  const patterns = [
    new RegExp(`\\b[Tt]ech(?:nician)?s?,?\\s+(?:named\\s+|is\\s+|will be\\s+)?${name}`, 'g'),
    new RegExp(`${name}\\s+(?:is|will be|should be)\\s+(?:our|your|the)\\s+tech(?:nician)?\\b`, 'g'),
  ];
  const found = new Map();
  for (const re of patterns) {
    for (const m of String(message || '').matchAll(re)) {
      const raw = m[1].replace(/'s$/, '');
      const key = raw.toLowerCase();
      if (NOT_NAMES.has(key) || found.has(key)) continue;
      if (ok.has(key)) {
        if (ok.get(key) !== raw) found.set(key, { name: raw, suggestion: ok.get(key) });
        continue;
      }
      let best = null;
      for (const [k, v] of ok) {
        const dist = editDistance(key, k);
        if (dist <= 2 && (!best || dist < best.dist)) best = { dist, v };
      }
      found.set(key, { name: raw, suggestion: best ? best.v : null });
    }
  }
  return [...found.values()];
}
function checkTechnicianNames(fields, roster) {
  for (const [label, message] of fields) {
    const bad = technicianNameProblems(message, roster);
    if (bad.length) {
      const list = bad.map((b) => `"${b.name}"${b.suggestion ? ` (did the call mean ${b.suggestion}?)` : ''}`).join(', ');
      throw new Error(`${label} names a technician who isn't on config.json technicians (${(roster || []).join(', ')}): ${list}. Use the roster spelling, or say "the tech" instead. Nothing was sent.`);
    }
  }
}

function loadPlan(file) {
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!plan.customerId) throw new Error('plan.json has no customerId');
  if (!plan.signedAs) throw new Error('plan.json has no signedAs');
  const text = plan.text || {};
  const email = plan.email || {};
  if (!isNull(text.to) && !normalizePhone(text.to)) throw new Error(`text.to isn't a phone number: ${text.to}`);
  if (!isNull(text.to) && !String(text.body || '').trim()) throw new Error('text.body is empty');
  if (!isNull(email.to) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email.to))) throw new Error(`email.to isn't an email address: ${email.to}`);
  if (!isNull(email.to) && (!String(email.subject || '').trim() || !String(email.bodyText || '').trim())) throw new Error('email needs a subject and bodyText');
  for (const [k, v] of [['text.mediaUrl', text.mediaUrl], ['pdfUrl', plan.pdfUrl]]) {
    if (!isNull(v) && !/^https:\/\//.test(String(v))) throw new Error(`${k} must be an https link`);
  }
  for (const [k, v] of [['email.attachPdf', email.attachPdf], ['email.inlineCard', email.inlineCard]]) {
    if (!isNull(v) && !fs.existsSync(String(v))) throw new Error(`${k} file not found: ${v}`);
  }
  let sendAtMs = null;
  if (!isNull(text.sendAt)) {
    sendAtMs = typeof text.sendAt === 'number' ? text.sendAt : Date.parse(text.sendAt);
    if (!Number.isFinite(sendAtMs)) throw new Error(`text.sendAt isn't a time: ${text.sendAt}`);
    if (sendAtMs <= Date.now() + 60000) sendAtMs = null; // already past: send now
  }
  return { plan, text, email, sendAtMs };
}

// Paragraphs (blank-line separated) -> HTML blocks, with the card after the second.
function emailBlocks(bodyText, withCard) {
  const linkify = (s) => s.replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}" style="color:#11960B;">${u}</a>`);
  const paras = String(bodyText).replace(/\r\n/g, '\n').trim().split(/\n\s*\n/);
  // A greeting on its own ("Hi Karen,") doesn't count as a paragraph.
  const greeting = paras.length > 2 && /^(hi|hello|hey|dear|good (morning|afternoon|evening))\b[^\n]{0,40}$/i.test(paras[0].trim()) ? 1 : 0;
  const cardAfter = Math.min(1 + greeting, paras.length - 1);
  const blocks = [];
  paras.forEach((p, i) => {
    blocks.push({ text: true, html: linkify(escapeHtml(p.trim())).replace(/\n/g, '<br>') });
    if (withCard && i === cardAfter) blocks.push({ card: true });
  });
  return blocks;
}

function customerLabel(plan, customer) {
  const name = [customer?.firstName, customer?.lastName].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
  return name || `customer ${plan.customerId}`;
}

// First of the names that's set, ignoring case (the environment has
// Textable_Account_UID / Textable_Token).
function envAny(...names) {
  const wanted = names.map((n) => n.toLowerCase());
  const key = Object.keys(process.env).find((k) => wanted.includes(k.toLowerCase()) && String(process.env[k]).trim());
  return key ? String(process.env[key]).trim() : null;
}

async function sendText({ to, message, mediaUrl, sendAtMs, from }) {
  // Credentials from the environment, or (when they're stored as a network
  // secret for atscall-txb.textable.app) added by the agent proxy.
  const uid = envAny('TEXTABLE_USER_ID', 'TEXTABLE_ACCOUNT_UID');
  const token = envAny('TEXTABLE_API_TOKEN', 'TEXTABLE_TOKEN');
  const auth = uid && token ? { Authorization: `Bearer ${uid}:${token}` } : {};
  const body = { to, from, message, ...(mediaUrl ? { media: [mediaUrl] } : {}), ...(sendAtMs ? { sendAt: sendAtMs } : {}) };
  let res;
  try {
    res = await fetch(TEXTABLE, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch (err) {
    return `failed: no response from Textable (it may have gone through): ${err.message}`;
  }
  const j = await res.json().catch(() => ({}));
  if (res.status === 451) return 'opted_out';
  if (res.status === 401 && !auth.Authorization) return 'failed: no Textable credentials (set TEXTABLE_ACCOUNT_UID and TEXTABLE_API_TOKEN)';
  if (res.ok && j.status === true) return sendAtMs ? 'scheduled' : 'sent';
  return `failed: Textable ${res.status} ${String(j.message || j.error || '').slice(0, 120)}`.trim();
}

function logContent({ prefix, kind, plan, recipient, status, sentAtMs, sendAtMs, body, subject }) {
  const when = sendAtMs && status === 'scheduled'
    ? `scheduled for ${cal.formatDay(sendAtMs)} ${cal.formatTime(sendAtMs)} (logged ${cal.formatDay(sentAtMs)} ${cal.formatTime(sentAtMs)})`
    : `${cal.formatDay(sentAtMs)} ${cal.formatTime(sentAtMs)}`;
  const ok = status === 'sent' || status === 'scheduled';
  const test = prefix === TEST_PREFIX;
  const outcome = !ok ? `not sent (${status})` : test ? `${status} to the test ${kind === 'Text' ? 'phone' : 'inbox'} only` : status;
  const lines = [
    `${prefix} ${kind} ${outcome}`,
    `${test ? 'Customer' : 'To'}: ${recipient}`,
    `When: ${when}`,
    `Signed as: ${plan.signedAs}`,
    `Summary: ${plan.summary || ''}`,
    `Quote PDF: ${isNull(plan.pdfUrl) ? 'none' : plan.pdfUrl}`,
    ...(subject ? [`Subject: ${subject}`] : []),
    '',
    'Message:',
    body,
  ];
  return lines.join('\n');
}

// Briostack's "Unknown" contact method isn't on the customer record; it shows
// up as {contactMethodType: 'UNKNOWN'} on existing Communications entries.
// Reuse that one when the customer already has it.
async function findUnknownContactMethod(brio, customerId) {
  try {
    const comms = await brio.listCommunications(customerId);
    for (const m of comms) {
      const cm = (m.contactMethods || []).find((x) => x.contactMethodType === 'UNKNOWN' && x.contactMethodId);
      if (cm) return String(cm.contactMethodId);
    }
  } catch {
    // fall through: post without a contact method
  }
  return null;
}

// Log under "Unknown" when the customer has that contact method, else under
// the phone/email. Briostack requires an existing contactMethodId on every
// entry and only creates an Unknown one for customers with no email (when its
// nurture email goes out), so most new customers don't have one yet. The
// entry is what prepare.js uses to spot already-sent customers, so it must
// never be lost.
async function createLogEntry(brio, customerId, body, unknownId, fallbackId) {
  if (unknownId) {
    try {
      return await brio.createCommunication(customerId, { ...body, contactMethods: [{ contactMethodId: unknownId }] });
    } catch (err) {
      if (!fallbackId || !(err.status >= 400 && err.status < 500)) throw err;
    }
  }
  return brio.createCommunication(customerId, fallbackId ? { ...body, contactMethods: [{ contactMethodId: String(fallbackId) }] } : body);
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { values: ['plan'], flags: ['no-log', 'preview'] });
  if (!args.plan) throw new Error('usage: send.js --plan plan.json [--no-log] [--preview]');
  const config = loadConfig();
  const { plan, text, email, sendAtMs } = loadPlan(args.plan);
  checkTechnicianNames([['text.body', text.body], ['email.subject', email.subject], ['email.bodyText', email.bodyText]], config.technicians);
  const outDir = path.dirname(path.resolve(args.plan));
  const test = config.testMode !== false;
  if (test && (!config.testPhone || !config.testEmail)) throw new Error('testMode is on but testPhone/testEmail are empty in config.json');

  const brio = args['no-log'] && args.preview ? null : createBriostack();
  const customer = brio ? await brio.getCustomer(plan.customerId) : null;
  const who = customerLabel(plan, customer);
  const result = { text: 'skipped (no number)', email: 'skipped (no address)', log: args['no-log'] ? 'skipped (--no-log)' : 'skipped', testMode: test };

  // Text.
  const textTo = isNull(text.to) ? null : `+1${normalizePhone(text.to)}`;
  const textMessage = textTo ? (test ? `TEST for ${who} ${formatPhone(normalizePhone(textTo))}:\n${text.body.trim()}` : text.body.trim()) : null;
  const textRecipient = textTo ? (test ? `+1${normalizePhone(config.testPhone)}` : textTo) : null;
  if (test && textRecipient && textRecipient !== `+1${normalizePhone(config.testPhone)}`) throw new Error('test mode guard: text recipient is not testPhone');

  // Email.
  const emailTo = isNull(email.to) ? null : String(email.to).trim();
  const emailRecipient = emailTo ? (test ? config.testEmail : emailTo) : null;
  const subject = emailTo ? (test ? `[TEST for ${who}] ${email.subject.trim()}` : email.subject.trim()) : null;
  const card = isNull(email.inlineCard) ? null : fs.readFileSync(email.inlineCard);
  const pdf = isNull(email.attachPdf) ? null : fs.readFileSync(email.attachPdf);
  let html = null;
  if (emailTo) {
    html = render('email.html', {
      subject,
      logoCid: 'catchy-logo',
      cardCid: 'quote-card',
      blocks: emailBlocks(email.bodyText, Boolean(card)),
      company: config.company,
      officePhone: config.officePhone,
      officePhoneDigits: `+1${normalizePhone(config.officePhone)}`,
    });
  }

  if (args.preview) {
    if (textMessage) fs.writeFileSync(path.join(outDir, 'text-preview.txt'), `To: ${textRecipient}\nMedia: ${text.mediaUrl || 'none'}\nSend at: ${sendAtMs ? cal.easternIso(sendAtMs) : 'now'}\n\n${textMessage}\n`);
    if (html) fs.writeFileSync(path.join(outDir, 'email-preview.html'), html.replace('cid:catchy-logo', `file://${LOGO}`).replace('cid:quote-card', card ? `file://${path.resolve(email.inlineCard)}` : ''));
    process.stdout.write(`${JSON.stringify({ text: textMessage ? 'preview' : result.text, email: html ? 'preview' : result.email, log: 'skipped (preview)', testMode: test })}\n`);
    return;
  }

  const sentAtMs = Date.now();
  if (textTo) {
    result.text = await sendText({ to: textRecipient, message: textMessage, mediaUrl: isNull(text.mediaUrl) ? null : text.mediaUrl, sendAtMs, from: config.textFrom });
  }
  if (emailTo) {
    try {
      const inline = [{ cid: 'catchy-logo', filename: 'catchy-pest-solutions.png', mimeType: 'image/png', data: fs.readFileSync(LOGO) }];
      if (card) inline.push({ cid: 'quote-card', filename: 'your-quote.jpg', mimeType: 'image/jpeg', data: card });
      const attachments = pdf ? [{ filename: 'Catchy Pest Solutions - Your Quote.pdf', mimeType: 'application/pdf', data: pdf }] : [];
      await google.sendMail({
        fromName: `${plan.signedAs} at ${config.company.name}`,
        fromEmail: config.senderEmail,
        to: emailRecipient,
        subject,
        text: email.bodyText.trim(),
        html,
        inline,
        attachments,
      });
      result.email = 'sent';
    } catch (err) {
      result.email = `failed: ${err.message}`;
    }
  }

  // Log on the customer's Communications tab.
  if (!args['no-log']) {
    const prefix = test ? TEST_PREFIX : LIVE_PREFIX;
    const notes = [];
    try {
      const phoneId = [customer.primaryPhone, customer.secondaryPhone].find((p) => p && textTo && normalizePhone(p.number) === normalizePhone(textTo))?.contactMethodId || customer.primaryPhone?.contactMethodId;
      const emailId = [customer.primaryEmail].find((e) => e && emailTo && String(e.address).trim().toLowerCase() === emailTo.toLowerCase())?.contactMethodId || customer.primaryEmail?.contactMethodId;
      const date = cal.easternIso(sentAtMs);
      // Daniel wants these entries under the "Unknown" contact method, not the
      // customer's phone or email.
      const unknownId = await findUnknownContactMethod(brio, plan.customerId);
      const log = (body, fallbackId) => createLogEntry(brio, plan.customerId, body, unknownId, fallbackId);
      if (textTo) {
        await log({
          subject: `${prefix} Text`,
          content: logContent({ prefix, kind: 'Text', plan, recipient: formatPhone(normalizePhone(textTo)), status: result.text, sentAtMs, sendAtMs, body: text.body.trim() }),
          communicationTypeId: 'SMS',
          date,
        }, phoneId || emailId);
      }
      if (emailTo) {
        const entry = await log({
          subject: `${prefix} Email`,
          content: logContent({ prefix, kind: 'Email', plan, recipient: emailTo, status: result.email, sentAtMs, body: email.bodyText.trim(), subject: email.subject.trim() }),
          communicationTypeId: 'EMAIL_COMMUNICATION',
          date,
        }, emailId || phoneId);
        if (pdf && entry?.communicationId) {
          try {
            await brio.uploadDocument(plan.customerId, entry.communicationId, { filename: 'Catchy Pest Solutions - Your Quote.pdf', mimeType: 'application/pdf', data: pdf });
          } catch (err) {
            notes.push(`PDF not attached: ${err.status || err.message}`);
          }
        }
      }
      result.log = notes.length ? `logged (${notes.join('; ')})` : 'logged';
    } catch (err) {
      result.log = `failed: ${err.message}`;
    }
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stdout.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  });
}

module.exports = { emailBlocks, loadPlan, technicianNameProblems, checkTechnicianNames, logContent, findUnknownContactMethod, createLogEntry, TEST_PREFIX, LIVE_PREFIX };
