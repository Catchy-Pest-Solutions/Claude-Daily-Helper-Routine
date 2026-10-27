const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const cal = require('../../src/callReview/calendar');
const { schedule, inQuietHours } = require('../lib/schedule');
const lead = require('../lib/lead');
const { parseAtsCommunication } = require('../lib/briostack');
const { renderString, escapeHtml } = require('../lib/template');
const { buildMime } = require('../lib/google');
const { viewModel, money } = require('../render');
const { emailBlocks, logContent, findUnknownContactMethod, createLogEntry, TEST_PREFIX } = require('../send');

const et = (date, time) => cal.easternToMs(date, time);
const NOT_BOOKED = ['Leads Marketing', 'Quote - Critter Control', 'Quote - Signature Pest', 'Quote - TermiteShield'];

test('schedule: daytime and evening send now, any day, and offer the next two business days', () => {
  // Wednesday 2 PM and 8:30 PM: send now, offer tomorrow and Friday.
  for (const t of ['14:00', '20:30']) {
    assert.deepStrictEqual(schedule(et('2026-10-21', t)), { textSendAt: null, closeDays: ['tomorrow', 'Friday'], closeDates: ['2026-10-22', '2026-10-23'] });
  }
  // Friday: Monday and Tuesday. Saturday: also sends now.
  assert.deepStrictEqual(schedule(et('2026-10-23', '17:30')).closeDays, ['Monday', 'Tuesday']);
  assert.deepStrictEqual(schedule(et('2026-10-24', '11:00')), { textSendAt: null, closeDays: ['Monday', 'Tuesday'], closeDates: ['2026-10-26', '2026-10-27'] });
});

test('schedule: overnight automatic leads wait until 8 AM; records the office created never wait', () => {
  // A website lead at 11 PM Wednesday waits until 8 AM Thursday; the email went Wednesday, so day names.
  const late = schedule(et('2026-10-21', '23:00'));
  assert.strictEqual(late.textSendAt, '2026-10-22T08:00:00.000-04:00');
  assert.deepStrictEqual(late.closeDays, ['Friday', 'Monday']);
  // At 6:15 AM it goes at 8 AM the same day, so "tomorrow" still reads right.
  const early = schedule(et('2026-10-22', '06:15'));
  assert.strictEqual(early.textSendAt, '2026-10-22T08:00:00.000-04:00');
  assert.deepStrictEqual(early.closeDays, ['tomorrow', 'Monday']);
  // Steve created it at 11 PM: send now.
  assert.strictEqual(schedule(et('2026-10-21', '23:00'), { createdByStaff: true }).textSendAt, null);
  assert.strictEqual(inQuietHours(et('2026-10-21', '21:00')), true);
  assert.strictEqual(inQuietHours(et('2026-10-21', '08:00')), false);
  assert.strictEqual(inQuietHours(et('2026-10-21', '20:59')), false);
});

test('schedule: holidays are skipped when offering days (Thanksgiving and Black Friday)', () => {
  const s = schedule(et('2026-11-25', '15:00')); // Wednesday before Thanksgiving
  assert.strictEqual(s.textSendAt, null);
  assert.deepStrictEqual(s.closeDays, ['Monday', 'Tuesday']);
});

test('payload: the real Briostack shape gives the customer and who created it', () => {
  const real = JSON.stringify({ resource: { customerId: '19734', firstName: 'R' }, 'resource-uri': 'https://x/rest/v1/customers/19734', 'initiator-uri': 'https://x/rest/v1/employees/16195', event: 'WHEVENT_CUSTOMER_CREATE', timestamp: '2026-10-26T15:18:52-06:00' });
  assert.strictEqual(lead.customerIdFromPayload(real), '19734');
  assert.strictEqual(lead.initiatorFromPayload(real), '16195');
  assert.strictEqual(lead.initiatorFromPayload(JSON.stringify(real)), '16195');
  assert.strictEqual(lead.initiatorFromPayload('{"customerId":"1"}'), null);
});

test('payload: customer ID from the likely webhook shapes', () => {
  assert.strictEqual(lead.customerIdFromPayload('{"customerId":"19697"}'), '19697');
  assert.strictEqual(lead.customerIdFromPayload({ event: 'WHEVENT_CUSTOMER_CREATE', data: { customer: { customerId: 12345 } } }), '12345');
  assert.strictEqual(lead.customerIdFromPayload({ resourceType: 'CUSTOMER', id: '777' }), '777');
  assert.strictEqual(lead.customerIdFromPayload({ payload: '{"customer_id": 42}' }), '42');
  assert.strictEqual(lead.customerIdFromPayload('not json customerId=9'), '9');
  assert.strictEqual(lead.customerIdFromPayload({ leadId: 5 }), null);
});

test('services: quotes and Leads Marketing are not booked, names trimmed, scratched ignored', () => {
  const services = [
    { serviceId: 1, serviceCategoryName: 'Quote - TermiteShield ', statusId: 'CSC_PENDING', initialAmount: 0, regularAmount: 797 },
    { serviceId: 2, serviceCategoryName: 'HomeShield - Signature Pest Control', statusId: 'CSC_SCRATCH', initialAmount: 347 },
  ];
  const appts = [{ serviceId: 1, appointmentTypeName: 'Place Holder', statusId: 'SVC_TICK_ACTIVE', appointmentDate: '2026-11-04', price: 797 }];
  const r = lead.servicesInfo(services, appts, NOT_BOOKED);
  assert.strictEqual(r.booked, false);
  assert.deepStrictEqual(r.services.map((s) => [s.category, s.price, s.appointmentDate]), [['Quote - TermiteShield', '$797', null]]);
});

test('services: a real service is booked, with its appointment day and arrival window', () => {
  const services = [
    { serviceId: 1, serviceCategoryName: 'Leads Marketing', statusId: 'CSC_SCRATCH' },
    { serviceId: 2, serviceCategoryName: 'Carolina TermiteShield', statusId: 'CSC_PENDING', initialAmount: 847, initialDiscount: 50, regularAmount: 29 },
  ];
  const appts = [
    { serviceId: 2, appointmentTypeName: 'Treatment', statusId: 'SVC_TICK_ACTIVE', appointmentDate: '2026-10-27', arrivalFrom: '11:00:00', arrivalThru: '13:00:00' },
  ];
  const r = lead.servicesInfo(services, appts, NOT_BOOKED);
  assert.strictEqual(r.booked, true);
  assert.deepStrictEqual(r.services[0], {
    category: 'Carolina TermiteShield', booked: true, status: 'CSC_PENDING', price: '$797', discount: '$50', recurringPrice: '$29',
    appointmentDate: '2026-10-27', appointmentDay: 'Tuesday, Oct 27', timeWindow: '11 AM–1 PM', createdAt: null,
  });
  assert.strictEqual(lead.timeWindow({ arrivalFrom: '08:00:00', arrivalThru: '10:30:00' }), '8–10:30 AM');
});

test('creation time: dateAcquired unless it was reset to midnight', () => {
  const s = [{ createdDate: '2026-10-21T10:55:33.206-06:00' }];
  assert.strictEqual(lead.creationMs('2026-10-21T00:00:00.000-06:00', s, []), Date.parse('2026-10-21T10:55:33.206-06:00'));
  assert.strictEqual(lead.creationMs('2026-10-21T10:55:32.012-06:00', s, []), Date.parse('2026-10-21T10:55:32.012-06:00'));
  assert.strictEqual(lead.creationMs(null, [], []), null);
});

test('contact: E.164 mobile, blank first name, address', () => {
  const info = lead.customerInfo({
    customerId: '9', firstName: null, lastName: 'Jane Doe ', primaryPhone: { number: '+18285550100', textNotifications: true, contactMethodId: '1' },
    primaryEmail: { address: ' jane@example.com ', contactMethodId: '2' }, primaryAddress: { address: '1 Main St', city: 'Asheville', stateOrProvince: 'NC', postalCode: '28803' },
  });
  assert.strictEqual(info.firstName, null);
  assert.strictEqual(info.name, 'Jane Doe');
  assert.strictEqual(info.mobile, '+18285550100');
  assert.strictEqual(info.email, 'jane@example.com');
  assert.strictEqual(info.serviceAddress, '1 Main St, Asheville, NC 28803');
  assert.deepStrictEqual(info.phones10, ['8285550100']);
});

test('already sent: live or TEST log entries both count', () => {
  assert.strictEqual(lead.alreadySent([{ subject: 'Incoming Call from (828) 555-0100' }]), false);
  assert.strictEqual(lead.alreadySent([{ subject: '[AI FOLLOW-UP] Text' }]), true);
  assert.strictEqual(lead.alreadySent([{ subject: `${TEST_PREFIX} Email` }]), true);
});

test('main call: the one in progress when the record was created, else the nearest', () => {
  const created = Date.parse('2026-10-21T13:38:00-04:00');
  const c = (id, start, end, talkSec) => ({ id, startMs: Date.parse(`2026-10-21T${start}:00-04:00`), endMs: Date.parse(`2026-10-21T${end}:00-04:00`), talkSec });
  const calls = [c('early', '10:00', '10:05', 300), c('during', '13:32', '13:40', 400), c('short', '13:36', '13:37', 30)];
  assert.strictEqual(lead.pickMainCall(calls, created).id, 'during');
  assert.strictEqual(lead.pickMainCall([c('early', '10:00', '10:05', 300), c('later', '15:00', '15:02', 90)], created).id, 'early');
  assert.strictEqual(lead.pickMainCall([], created), null);
  assert.strictEqual(lead.isConversation({ direction: 'inbound', answered: true, talkSec: 261 }), true);
  assert.strictEqual(lead.isConversation({ direction: 'inbound', answered: false, talkSec: 0 }), false);
  assert.strictEqual(lead.isConversation({ direction: 'outbound', talkSec: 8 }), false);
});

test('ATS copy on the Communications tab parses into summary, transcript and extension', () => {
  const content = 'Incoming Call\nCall Started: 10/21/2026 1:32PM EDT\nCall Answered: 10/21/2026 1:32PM EDT\nCaller Name: Jane Doe\nPhone Number Dialed: (828) 263-4804\nAnswered by Extension: 103\n\n\nCall Summary:\nA caller asked about ants.\n\nTranscription: Speaker 0: Catchy Pest, this is Steve.\nSpeaker 1: Hi.';
  assert.deepStrictEqual(parseAtsCommunication(content), {
    summary: 'A caller asked about ants.',
    transcription: 'Speaker 0: Catchy Pest, this is Steve.\nSpeaker 1: Hi.',
    ext: 103,
    direction: 'inbound',
  });
  assert.strictEqual(parseAtsCommunication('no transcript here'), null);
});

test('template: escaping, sections, lists, and no re-reading of customer text', () => {
  assert.strictEqual(escapeHtml('<b>"x" & {{y}}</b>'), '&lt;b&gt;&quot;x&quot; &amp; &#123;&#123;y}}&lt;/b&gt;');
  const out = renderString('{{#items}}<li>{{.}}</li>{{/items}}{{^none}}empty{{/none}}{{#obj}}{{a}}{{/obj}}', [{ items: ['a', '{{#x}}'], none: [], obj: { a: 1 } }]);
  assert.strictEqual(out, '<li>a</li><li>&#123;&#123;#x}}</li>empty1');
});

test('render: prices become whole dollars, discounts need was-prices, one option works', () => {
  assert.strictEqual(money('$1,047'), '$1,047');
  assert.strictEqual(money(647), '$647');
  assert.throws(() => money('$582.30'), /whole dollars/);
  const config = { officePhone: '(828) 263-4804', senderEmail: 'office@x.com', company: { name: 'C', address: 'A', website: 'w' } };
  const base = { firstName: '', customerName: 'Pat Lee', closeDays: ['tomorrow', 'Thursday'], options: [{ name: 'One Time Service', price: '247', priceNote: 'One visit' }] };
  const vm1 = viewModel(base, config);
  assert.strictEqual(vm1.title, 'Your quote');
  assert.strictEqual(vm1.layout, 'single');
  assert.strictEqual(vm1.options[0].price, '$247');
  assert.strictEqual(vm1.closeDaysText, 'tomorrow or Thursday');
  assert.throws(() => viewModel({ ...base, discount: { percent: 10, reason: 'r' } }, config), /wasPrice/);
  const vm2 = viewModel({ ...base, discount: { percent: 10, reason: 'Seasonal discount' }, options: [{ name: 'X', price: '$222', wasPrice: '$247' }] }, config);
  assert.strictEqual(vm2.discountBadge, '10% off — Seasonal discount');
  assert.throws(() => viewModel({ ...base, options: [] }, config), /one or two options/);
});

test('email: card goes after the second paragraph, not counting a greeting line', () => {
  const blocks = emailBlocks('Hi Karen,\n\nThanks for calling.\n\nOptions here https://example.com/x.\n\nSteve\nCatchy Pest Solutions', true);
  assert.deepStrictEqual(blocks.map((b) => (b.card ? 'CARD' : b.html.slice(0, 8))), ['Hi Karen', 'Thanks f', 'Options ', 'CARD', 'Steve<br']);
  assert.match(blocks[2].html, /<a href="https:\/\/example.com\/x" style="color:#11960B;">/);
  const noGreeting = emailBlocks('Thanks for calling.\n\nOptions.\n\nSteve', true);
  assert.deepStrictEqual(noGreeting.map((b) => (b.card ? 'CARD' : 'p')), ['p', 'p', 'CARD', 'p']);
  assert.ok(!emailBlocks('One.\n\nTwo.', false).some((b) => b.card));
});

test('email MIME: inline images and attachment in the right parts', () => {
  const mime = buildMime({
    fromName: 'Steve at Catchy Pest Solutions', fromEmail: 'office@x.com', to: 'a@b.com', subject: 'Your quote — Karen',
    text: 'hi', html: '<p>hi</p>', inline: [{ cid: 'card', filename: 'c.jpg', mimeType: 'image/jpeg', data: Buffer.from('jpg') }],
    attachments: [{ filename: 'q.pdf', mimeType: 'application/pdf', data: Buffer.from('pdf') }],
  });
  assert.match(mime, /^From: Steve at Catchy Pest Solutions <office@x.com>\r\n/);
  assert.match(mime, /Subject: =\?UTF-8\?B\?/);
  assert.match(mime, /Content-ID: <card>\r\nContent-Disposition: inline/);
  assert.match(mime, /Content-Disposition: attachment; filename="q.pdf"/);
  assert.ok(mime.indexOf('multipart/alternative') < mime.indexOf('Content-ID: <card>'));
});

test('log entry: starts with the prefix and holds the exact message', () => {
  const plan = { signedAs: 'Steve', summary: 'Unbooked; price', pdfUrl: 'https://drive.google.com/file/d/x/view' };
  const live = logContent({ prefix: '[AI FOLLOW-UP]', kind: 'Text', plan, recipient: '(828) 555-0100', status: 'sent', sentAtMs: Date.now(), body: 'Hi Karen' });
  assert.match(live, /^\[AI FOLLOW-UP\] Text sent\n/);
  assert.match(live, /Signed as: Steve/);
  assert.match(live, /Message:\nHi Karen$/);
  const t = logContent({ prefix: TEST_PREFIX, kind: 'Email', plan, recipient: 'k@x.com', status: 'sent', sentAtMs: Date.now(), body: 'b', subject: 's' });
  assert.ok(t.startsWith(`${TEST_PREFIX} Email sent to the test inbox only`));
  const failed = logContent({ prefix: '[AI FOLLOW-UP]', kind: 'Text', plan, recipient: 'x', status: 'opted_out', sentAtMs: Date.now(), body: 'b' });
  assert.match(failed, /^\[AI FOLLOW-UP\] Text not sent \(opted_out\)/);
});

// The Apps Script relay, run against mocked Google services.
function loadRelay({ props, fetchResponses }) {
  const cache = new Map();
  const triggers = [];
  const fetched = [];
  const logs = [];
  const sandbox = {
    console: { log: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(`ERR ${m}`) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => props[k] ?? null,
        setProperty: (k, v) => { props[k] = v; },
        deleteProperty: (k) => { delete props[k]; },
        getProperties: () => ({ ...props }),
      }),
    },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    UrlFetchApp: {
      fetch: (url, opts) => {
        fetched.push({ url, opts });
        const r = fetchResponses.shift() || { code: 200, body: '{"claude_code_session_url":"https://claude.ai/code/session_x"}' };
        if (r.throws) throw new Error(r.throws);
        return { getResponseCode: () => r.code, getContentText: () => r.body };
      },
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, text) => [...crypto.createHash('sha256').update(text).digest()],
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url'),
    },
    ContentService: { MimeType: { TEXT: 'text' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    ScriptApp: {
      newTrigger: (fn) => ({ timeBased: () => ({ after: () => ({ create: () => triggers.push(fn) }) }) }),
      getProjectTriggers: () => triggers.map((fn) => ({ getHandlerFunction: () => fn })),
      deleteTrigger: () => triggers.splice(0, 1),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'relay', 'Code.gs'), 'utf8'), sandbox);
  return { sandbox, fetched, triggers, logs, props };
}

test('relay: wrong key is ignored, right key forwards the raw body once', () => {
  const r = loadRelay({ props: { RELAY_SECRET: 's3cret', ROUTINE_URL: 'https://api.anthropic.com/v1/claude_code/routines/trig_1/fire', ROUTINE_TOKEN: 'tok' }, fetchResponses: [] });
  const body = '{"event":"WHEVENT_CUSTOMER_CREATE","customerId":"19697"}';
  assert.strictEqual(r.sandbox.doPost({ parameter: { key: 'nope' }, postData: { contents: body } }).text, 'ok');
  assert.strictEqual(r.fetched.length, 0);
  assert.strictEqual(r.sandbox.doPost({ parameter: { key: 's3cret' }, postData: { contents: body } }).text, 'ok');
  assert.strictEqual(r.fetched.length, 1);
  const { url, opts } = r.fetched[0];
  assert.strictEqual(url, 'https://api.anthropic.com/v1/claude_code/routines/trig_1/fire');
  assert.strictEqual(opts.headers.Authorization, 'Bearer tok');
  assert.strictEqual(opts.headers['anthropic-version'], '2023-06-01');
  assert.deepStrictEqual(JSON.parse(opts.payload), { text: body });
  // Same customer again (a Briostack resend, even with a different body): skipped.
  r.sandbox.doPost({ parameter: { key: 's3cret' }, postData: { contents: body.replace('}', ',"attempt":2}') } });
  assert.strictEqual(r.fetched.length, 1);
});

test('relay: a 503 is queued and retried; a 401 is not retried and lets a resend through', () => {
  const r = loadRelay({ props: { RELAY_SECRET: 'k', ROUTINE_URL: 'u', ROUTINE_TOKEN: 't' }, fetchResponses: [{ code: 503, body: 'busy' }, { code: 200, body: '{}' }] });
  r.sandbox.doPost({ parameter: { key: 'k' }, postData: { contents: '{"customerId":"1"}' } });
  assert.deepStrictEqual(r.triggers, ['retryQueued']);
  r.sandbox.retryQueued();
  assert.strictEqual(r.fetched.length, 2);
  assert.ok(!Object.keys(r.props).some((k) => k.startsWith('QUEUED_')));

  const r2 = loadRelay({ props: { RELAY_SECRET: 'k', ROUTINE_URL: 'u', ROUTINE_TOKEN: 't' }, fetchResponses: [{ code: 401, body: 'bad token' }] });
  r2.sandbox.doPost({ parameter: { key: 'k' }, postData: { contents: '{"customerId":"2"}' } });
  assert.strictEqual(r2.triggers.length, 0);
  r2.sandbox.doPost({ parameter: { key: 'k' }, postData: { contents: '{"customerId":"2"}' } });
  assert.strictEqual(r2.fetched.length, 2);
});

test('log entries go under the Unknown contact method when the customer has one', async () => {
  const posted = [];
  const brio = {
    listCommunications: async () => [
      { contactMethods: [{ contactMethodId: '5', contactMethodType: 'TELECOM_NUMBER' }] },
      { contactMethods: [{ contactMethodId: '7', contactMethodType: 'UNKNOWN' }] },
    ],
    createCommunication: async (id, body) => {
      posted.push(body);
      return { communicationId: 'c1' };
    },
  };
  const unknownId = await findUnknownContactMethod(brio, '9');
  assert.strictEqual(unknownId, '7');
  await createLogEntry(brio, '9', { subject: 's', communicationTypeId: 'SMS' }, unknownId, '1');
  assert.deepStrictEqual(posted[0].contactMethods, [{ contactMethodId: '7' }]);

  // No Unknown method (most new customers): straight to the phone/email, no failed attempt first.
  assert.strictEqual(await findUnknownContactMethod({ listCommunications: async () => [] }, '9'), null);
  await createLogEntry(brio, '9', { subject: 's', communicationTypeId: 'SMS' }, null, '1');
  assert.strictEqual(posted.length, 2);
  assert.deepStrictEqual(posted[1].contactMethods, [{ contactMethodId: '1' }]);
});

test('log entry falls back to the phone/email when Briostack rejects Unknown', async () => {
  const posted = [];
  const brio = {
    createCommunication: async (id, body) => {
      posted.push(body);
      if (body.contactMethods[0].contactMethodId === '7') throw Object.assign(new Error('bad'), { status: 400 });
      return { communicationId: 'c2' };
    },
  };
  const entry = await createLogEntry(brio, '9', { subject: 's', communicationTypeId: 'SMS' }, '7', '1');
  assert.strictEqual(entry.communicationId, 'c2');
  assert.deepStrictEqual(posted[1].contactMethods, [{ contactMethodId: '1' }]);
});
