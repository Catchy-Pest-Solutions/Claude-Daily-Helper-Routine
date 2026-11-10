/**
 * Briostack -> Claude Code routine relay (Google Apps Script web app).
 *
 * Briostack's webhooks can't send the Authorization header a routine's
 * /fire endpoint needs, so Briostack posts here and this script forwards the
 * raw body as the routine's fire text.
 *
 * Script Properties (Project Settings > Script Properties):
 *   RELAY_SECRET   must match the ?key= on the webhook URL; anything else is ignored
 *   ROUTINE_URL    the routine's Fire URL (https://api.anthropic.com/v1/claude_code/routines/trig_.../fire)
 *   ROUTINE_TOKEN  the routine's API token (sk-ant-oat01-...)
 *
 * Behaviour:
 * - Always answers Briostack with a plain 200 "ok", even when it ignores or
 *   fails to forward a delivery, so Briostack doesn't pile up retries.
 * - Dedupes: the same body, or the same customer ID, is forwarded at most
 *   once per 6 hours (the /fire endpoint has no idempotency key, and
 *   Briostack may resend when it doesn't like the web app's redirect).
 * - A forward that fails (network error, 429, 5xx) is queued and retried by
 *   a one-off trigger a minute later, up to 5 times. If it never gets
 *   through, the dedupe entry is cleared so a Briostack retry can. Every
 *   failure is logged (Apps Script > Executions).
 *
 * One-tap send (backup for when the routine's permission check blocks
 * send.js, Nov 10, 2026): the routine runs `send.js --stage`, which saves the
 * finished text, email and Briostack log entries as a private file in the
 * "AI Follow-ups" Drive folder, and Slacks Daniel a link here:
 *   <web app URL>?approve=<Drive file ID>&t=<one-time token>
 * Opening the link only shows the message (so Slack's link preview can't send
 * it). Tapping "Send" sends the text (Textable), the email (Gmail, as office@)
 * and logs both on the customer's Communications tab, once. It refuses when
 * Briostack already has a follow-up logged for the customer. Extra Script
 * Properties for this: TEXTABLE_ACCOUNT_UID, TEXTABLE_API_TOKEN,
 * BRIOSTACK_API_KEY.
 */

var DEDUPE_SECONDS = 6 * 60 * 60; // CacheService maximum
var MAX_TEXT = 65000; // /fire accepts up to 65,536 characters
var MAX_ATTEMPTS = 5;
var SEND_PROPERTIES = ['TEXTABLE_ACCOUNT_UID', 'TEXTABLE_API_TOKEN', 'BRIOSTACK_API_KEY'];
var TEXTABLE_URL = 'https://atscall-txb.textable.app/api/send';
var BRIOSTACK_URL = 'https://catchypestsolutions.briostack.io/rest/v1/';
var TZ = 'America/New_York';

function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('RELAY_SECRET');
  var key = (e && e.parameter && e.parameter.key) || '';
  if (!secret || key !== secret) {
    console.warn('Ignored a request with a missing or wrong key.');
    return ok_();
  }
  var body = (e.postData && e.postData.contents) || '';
  if (!body) {
    console.warn('Ignored an empty delivery.');
    return ok_();
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var cache = CacheService.getScriptCache();
    var bodyKey = 'body:' + digest_(body);
    var customerId = customerId_(body);
    var customerKey = customerId ? 'customer:' + customerId : null;
    if (cache.get(bodyKey) || (customerKey && cache.get(customerKey))) {
      console.log('Duplicate delivery skipped' + (customerId ? ' (customer ' + customerId + ')' : '') + '.');
      return ok_();
    }
    cache.put(bodyKey, '1', DEDUPE_SECONDS);
    if (customerKey) cache.put(customerKey, '1', DEDUPE_SECONDS);
  } finally {
    lock.releaseLock();
  }

  var result = forward_(body);
  if (result.ok) {
    console.log('Forwarded' + (customerId ? ' customer ' + customerId : '') + ': ' + result.detail);
  } else {
    console.error('Forward failed' + (customerId ? ' for customer ' + customerId : '') + ': ' + result.detail);
    if (result.retry) queue_(body, 1);
    else forget_(body);
  }
  return ok_();
}

// Health check in a browser: shows whether the properties are set (never
// their values). With ?approve=...&t=..., the one-tap send page instead.
function doGet(e) {
  if (e && e.parameter && e.parameter.approve) return approvePage_(e.parameter.approve, e.parameter.t || '');
  var p = PropertiesService.getScriptProperties();
  var missing = ['RELAY_SECRET', 'ROUTINE_URL', 'ROUTINE_TOKEN'].filter(function (k) { return !p.getProperty(k); });
  var sendMissing = SEND_PROPERTIES.filter(function (k) { return !p.getProperty(k); });
  var text = missing.length ? 'Relay is up. Missing Script Properties: ' + missing.join(', ') : 'Relay is up and configured.';
  text += sendMissing.length ? ' One-tap send is off (missing ' + sendMissing.join(', ') + ').' : ' One-tap send is ready.';
  return ContentService.createTextOutput(text);
}

function forward_(body) {
  var p = PropertiesService.getScriptProperties();
  var url = p.getProperty('ROUTINE_URL');
  var token = p.getProperty('ROUTINE_TOKEN');
  if (!url || !token) return { ok: false, retry: false, detail: 'ROUTINE_URL or ROUTINE_TOKEN is not set' };
  var text = body.length > MAX_TEXT ? body.slice(0, MAX_TEXT) : body;
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + token,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'experimental-cc-routine-2026-04-01',
      },
      payload: JSON.stringify({ text: text }),
      muteHttpExceptions: true,
      followRedirects: false,
    });
    var code = res.getResponseCode();
    if (code === 200) {
      var session = '';
      try {
        session = JSON.parse(res.getContentText()).claude_code_session_url || '';
      } catch (err) {}
      return { ok: true, detail: session || 'HTTP 200' };
    }
    var message = res.getContentText().slice(0, 300);
    return { ok: false, retry: code === 429 || code >= 500, detail: 'HTTP ' + code + ' ' + message };
  } catch (err) {
    return { ok: false, retry: true, detail: String(err) };
  }
}

// Failed forwards wait in Script Properties for retryQueued().
function queue_(body, attempt) {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('QUEUED_' + Date.now() + '_' + Math.floor(Math.random() * 1e6), JSON.stringify({ body: body, attempt: attempt }));
  ScriptApp.newTrigger('retryQueued').timeBased().after(60 * 1000).create();
}

function retryQueued() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // Remove the one-off triggers that brought us here.
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'retryQueued') ScriptApp.deleteTrigger(t);
    });
    var p = PropertiesService.getScriptProperties();
    var all = p.getProperties();
    Object.keys(all).forEach(function (k) {
      if (k.indexOf('QUEUED_') !== 0) return;
      p.deleteProperty(k);
      var item = JSON.parse(all[k]);
      var result = forward_(item.body);
      if (result.ok) {
        console.log('Retry ' + item.attempt + ' forwarded: ' + result.detail);
      } else if (result.retry && item.attempt < MAX_ATTEMPTS) {
        console.error('Retry ' + item.attempt + ' failed: ' + result.detail);
        queue_(item.body, item.attempt + 1);
      } else {
        console.error('Giving up after ' + item.attempt + ' attempts: ' + result.detail);
        forget_(item.body);
      }
    });
  } finally {
    lock.releaseLock();
  }
}

// Lets a later Briostack retry of a delivery we never managed to forward through.
function forget_(body) {
  var cache = CacheService.getScriptCache();
  cache.remove('body:' + digest_(body));
  var customerId = customerId_(body);
  if (customerId) cache.remove('customer:' + customerId);
}

function customerId_(body) {
  var m = /"customer_?id"\s*:\s*"?(\d+)/i.exec(body);
  return m ? m[1] : null;
}

function digest_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes);
}

function ok_() {
  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}


// ---------------------------------------------------------------------------
// One-tap send

// Reads the staged follow-up; null unless the token matches.
function loadStaged_(fileId, token) {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(String(fileId)) || !/^[0-9a-f]{48}$/.test(String(token))) return null;
  var pkg;
  try {
    pkg = JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString());
  } catch (err) {
    return null;
  }
  if (!pkg || pkg.version !== 1 || !sameText_(pkg.token, token)) return null;
  return pkg;
}

function sameText_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function esc_(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ageText_(ms) {
  var min = Math.round((Date.now() - ms) / 60000);
  if (min < 60) return min + ' min ago';
  var h = Math.round(min / 60);
  return h + (h === 1 ? ' hour ago' : ' hours ago');
}

function approvePage_(fileId, token) {
  var pkg = loadStaged_(fileId, token);
  var sent = PropertiesService.getScriptProperties().getProperty('SENT_' + fileId);
  var body;
  if (sent) {
    body = '<h1>Already sent</h1><p>' + esc_(sent) + '</p>';
  } else if (!pkg) {
    body = '<h1>Link not found</h1><p>This follow-up link is wrong or the message was already sent and removed.</p>';
  } else {
    var hours = (Date.now() - pkg.stagedAt) / 3600000;
    body = '<h1>' + esc_(pkg.customerName) + (pkg.testMode ? ' <span class="test">TEST MODE</span>' : '') + '</h1>' +
      '<p class="meta">Briostack ' + esc_(pkg.customerId) + ' · signed as ' + esc_(pkg.signedAs) + ' · written ' + esc_(ageText_(pkg.stagedAt)) + '</p>' +
      (hours >= 3 ? '<p class="warn">This was written ' + esc_(ageText_(pkg.stagedAt)) + '. Check that words like "today", "tomorrow" or "just called" still fit before sending. If not, ask in the routine\'s session for a fresh one.</p>' : '') +
      (pkg.text ? '<h2>Text to ' + esc_(pkg.text.to) + (pkg.text.sendAtMs && pkg.text.sendAtMs > Date.now() ? ' (scheduled for ' + esc_(Utilities.formatDate(new Date(pkg.text.sendAtMs), TZ, 'EEE h:mm a')) + ')' : '') + '</h2><div class="msg">' + esc_(pkg.text.message).replace(/\n/g, '<br>') + '</div>' +
        (pkg.text.mediaUrl ? '<p><a href="' + esc_(pkg.text.mediaUrl) + '" target="_blank">Quote card picture</a></p>' : '') : '<h2>No text</h2>') +
      (pkg.email ? '<h2>Email to ' + esc_(pkg.email.to) + '</h2><p class="meta">Subject: ' + esc_(pkg.email.subject) + '</p><div class="msg">' + esc_(pkg.email.bodyText).replace(/\n/g, '<br>') + '</div>' +
        (pkg.email.attachments.length ? '<p class="meta">Quote PDF attached</p>' : '') : '<h2>No email</h2>') +
      '<button id="send" onclick="send()">Send</button><p id="result" class="meta"></p>' +
      '<script>function send(){var b=document.getElementById("send");b.disabled=true;b.textContent="Sending...";' +
      'google.script.run.withSuccessHandler(function(r){b.style.display="none";document.getElementById("result").textContent=r;})' +
      '.withFailureHandler(function(e){b.disabled=false;b.textContent="Send";document.getElementById("result").textContent="Failed: "+e.message;})' +
      '.sendStaged(' + JSON.stringify(String(fileId)) + ',' + JSON.stringify(String(token)) + ');}</script>';
  }
  var html = '<!doctype html><html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:20px 16px 40px;color:#0E120E;background:#fff;max-width:640px}' +
    'h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:22px 0 8px}.meta{color:#4A554B;font-size:14px;margin:4px 0}' +
    '.msg{background:#EEF1EE;border-left:6px solid #15BA0D;border-radius:10px;padding:12px 14px;font-size:16px;line-height:1.4}' +
    '.warn{background:#FFF4D6;border-radius:10px;padding:10px 12px;font-size:15px}.test{background:#FFD84D;font-size:14px;padding:2px 8px;border-radius:6px}' +
    'button{margin-top:24px;width:100%;padding:16px;font-size:19px;font-weight:700;background:#15BA0D;color:#0E120E;border:0;border-radius:12px}' +
    'a{color:#11960B}</style></head><body>' + body + '</body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Follow-up to send').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Called by the page's Send button. Returns one line saying what happened.
function sendStaged(fileId, token) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var already = props.getProperty('SENT_' + fileId);
    if (already) return 'Already sent: ' + already;
    var pkg = loadStaged_(fileId, token);
    if (!pkg) throw new Error('this link is wrong or was already used');
    var missing = SEND_PROPERTIES.filter(function (k) { return !props.getProperty(k); });
    if (missing.length) throw new Error('missing Script Properties: ' + missing.join(', '));
    var brio = briostack_(pkg.briostackBaseUrl || BRIOSTACK_URL, props.getProperty('BRIOSTACK_API_KEY'));
    if (followUpLogged_(brio, pkg.customerId)) {
      props.setProperty('SENT_' + fileId, 'not sent here: Briostack already has a follow-up logged for ' + pkg.customerName);
      return 'Not sent: Briostack already has a follow-up logged for ' + pkg.customerName + '.';
    }
    var nowMs = Date.now();
    var result = { text: 'skipped (no number)', email: 'skipped (no address)', log: 'skipped' };
    var sendAtMs = pkg.text && pkg.text.sendAtMs && pkg.text.sendAtMs > nowMs + 60000 ? pkg.text.sendAtMs : null;
    if (pkg.text) result.text = sendText_(pkg.text, sendAtMs, props);
    var pdfBlob = null;
    if (pkg.email) {
      try {
        var inline = {};
        pkg.email.inline.forEach(function (f) { inline[f.cid] = Utilities.newBlob(Utilities.base64Decode(f.data), f.mimeType, f.filename); });
        var attachments = pkg.email.attachments.map(function (f) { return Utilities.newBlob(Utilities.base64Decode(f.data), f.mimeType, f.filename); });
        pdfBlob = attachments[0] || null;
        GmailApp.sendEmail(pkg.email.to, pkg.email.subject, pkg.email.bodyText, { htmlBody: pkg.email.html, name: pkg.email.fromName, inlineImages: inline, attachments: attachments });
        result.email = 'sent';
      } catch (err) {
        result.email = 'failed: ' + String(err.message || err);
      }
    }
    // Log on the Communications tab (prepare.js reads these to skip customers already sent).
    try {
      var notes = [];
      if (pkg.text) postLog_(brio, pkg, pkg.text.log, result.text, nowMs, sendAtMs, 'Text');
      if (pkg.email) {
        var entry = postLog_(brio, pkg, pkg.email.log, result.email, nowMs, null, 'Email');
        if (pdfBlob && entry && entry.communicationId) {
          try {
            brio.call('post', 'customers/' + pkg.customerId + '/communications/' + entry.communicationId + '/documents', { file: pdfBlob });
          } catch (err) {
            notes.push('PDF not attached');
          }
        }
      }
      result.log = notes.length ? 'logged (' + notes.join('; ') + ')' : 'logged';
    } catch (err) {
      result.log = 'failed: ' + String(err.message || err);
    }
    var when = Utilities.formatDate(new Date(nowMs), TZ, 'EEE MMM d, h:mm a');
    var line = 'Text ' + result.text + ', email ' + result.email + ', Briostack ' + result.log + ' (' + when + ').';
    props.setProperty('SENT_' + fileId, line);
    try {
      DriveApp.getFileById(fileId).setTrashed(true);
    } catch (err) {
      console.warn('Could not trash the staged file: ' + err);
    }
    console.log('One-tap send for customer ' + pkg.customerId + ': ' + line);
    return (pkg.testMode ? 'TEST MODE: ' : '') + line;
  } finally {
    lock.releaseLock();
  }
}

function sendText_(text, sendAtMs, props) {
  var body = { to: text.to, from: text.from, message: text.message };
  if (text.mediaUrl) body.media = [text.mediaUrl];
  if (sendAtMs) body.sendAt = sendAtMs;
  var res;
  try {
    res = UrlFetchApp.fetch(TEXTABLE_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + props.getProperty('TEXTABLE_ACCOUNT_UID') + ':' + props.getProperty('TEXTABLE_API_TOKEN') },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
  } catch (err) {
    return 'failed: no response from Textable (it may have gone through): ' + err;
  }
  var code = res.getResponseCode();
  var j = {};
  try {
    j = JSON.parse(res.getContentText());
  } catch (err) {}
  if (code === 451) return 'opted_out';
  if (code >= 200 && code < 300 && j.status === true) return sendAtMs ? 'scheduled' : 'sent';
  return ('failed: Textable ' + code + ' ' + String(j.message || j.error || '').slice(0, 120)).trim();
}

function briostack_(base, apiKey) {
  base = /\/$/.test(base) ? base : base + '/';
  return {
    call: function (method, path, payload) {
      var opts = { method: method, headers: { 'X-Api-Key': apiKey }, muteHttpExceptions: true };
      if (payload && payload.file) opts.payload = payload;
      else if (payload) {
        opts.contentType = 'application/json';
        opts.payload = JSON.stringify(payload);
      }
      var res = UrlFetchApp.fetch(base + path, opts);
      var code = res.getResponseCode();
      var text = res.getContentText();
      if (code < 200 || code >= 300) {
        var err = new Error('Briostack ' + method.toUpperCase() + ' ' + path.split('?')[0] + ' -> ' + code + ' ' + text.slice(0, 160));
        err.status = code;
        throw err;
      }
      try {
        return text ? JSON.parse(text) : null;
      } catch (e) {
        return text;
      }
    },
  };
}

// Same test as prepare.js: a live or TEST follow-up entry on the Communications tab.
function followUpLogged_(brio, customerId) {
  for (var start = 0; start < 1000; start += 100) {
    var page = brio.call('get', 'customers/' + customerId + '/communications?limit=100&start=' + start) || [];
    for (var i = 0; i < page.length; i++) {
      if (/^\[AI FOLLOW-UP/.test(String(page[i].subject || ''))) return true;
    }
    if (page.length < 100) return false;
  }
  return false;
}

function postLog_(brio, pkg, log, status, nowMs, sendAtMs, kind) {
  var ok = status === 'sent' || status === 'scheduled';
  var outcome = !ok ? 'not sent (' + status + ')' : pkg.testMode ? status + ' to the test ' + (kind === 'Text' ? 'phone' : 'inbox') + ' only' : status;
  var now = Utilities.formatDate(new Date(nowMs), TZ, 'EEE, MMM d h:mm a');
  var when = sendAtMs && status === 'scheduled' ? 'scheduled for ' + Utilities.formatDate(new Date(sendAtMs), TZ, 'EEE, MMM d h:mm a') + ' (logged ' + now + ')' : now;
  var content = [log.head + ' ' + outcome, log.recipientLine, 'When: ' + when + ' (sent with Daniel\'s one-tap approval)'].concat(log.rest).join('\n');
  var body = { subject: log.subject, content: content, communicationTypeId: log.communicationTypeId, date: Utilities.formatDate(new Date(nowMs), TZ, "yyyy-MM-dd'T'HH:mm:ss.SSSXXX") };
  var ids = log.contactMethodIds || [];
  for (var i = 0; i < ids.length; i++) {
    try {
      return brio.call('post', 'customers/' + pkg.customerId + '/communications', Object.assign({}, body, { contactMethods: [{ contactMethodId: ids[i] }] }));
    } catch (err) {
      if (i === ids.length - 1 || !(err.status >= 400 && err.status < 500)) throw err;
    }
  }
  return brio.call('post', 'customers/' + pkg.customerId + '/communications', body);
}
