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
 */

var DEDUPE_SECONDS = 6 * 60 * 60; // CacheService maximum
var MAX_TEXT = 65000; // /fire accepts up to 65,536 characters
var MAX_ATTEMPTS = 5;

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

// Health check in a browser: shows whether the properties are set (never their values).
function doGet() {
  var p = PropertiesService.getScriptProperties();
  var missing = ['RELAY_SECRET', 'ROUTINE_URL', 'ROUTINE_TOKEN'].filter(function (k) { return !p.getProperty(k); });
  return ContentService.createTextOutput(missing.length ? 'Relay is up. Missing Script Properties: ' + missing.join(', ') : 'Relay is up and configured.');
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
