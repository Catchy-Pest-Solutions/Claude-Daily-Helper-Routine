const test = require('node:test');
const assert = require('node:assert/strict');

const cal = require('../src/callReview/calendar');
const config = require('../src/callReview/config');
const { analyzeCalls, normalizePhone, busyScore, cleanCallerName } = require('../src/callReview/callAnalysis');
const { buildTask } = require('../src/callReview/taskBuilder');
const { runCallReview } = require('../src/callReview/run');

// One ATS /search leg. `at` is Eastern wall time on the given date.
function leg(callId, date, at, fields) {
  const ms = cal.easternToMs(date, at);
  const start = new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  const dur = fields.total_duration ?? 10;
  const end = new Date(ms + dur * 1000).toISOString().slice(0, 19).replace('T', ' ');
  return {
    call_id: callId,
    caller_id: '8285550100',
    caller_name: 'JANE DOE',
    callee_id: '8282634804',
    callee_name: '8282634804',
    exit_name: 'Connect',
    queue_duration: 0,
    total_duration: dur,
    dnis: '8282634804',
    start_time: start,
    end_time: end,
    ...fields,
  };
}

const D = '2026-09-29'; // a Tuesday
const answered = (id, at, phone, ext) => [
  leg(id, D, at, { caller_id: phone, exit_name: 'Connect', total_duration: 14 }),
  leg(id, D, bump(at, 1), { caller_id: phone, callee_id: `${ext}wp`, exit_name: 'Term: Bye', total_duration: 300 }),
];
const voicemail = (id, at, phone, queue = '190') => [
  leg(id, D, at, { caller_id: phone, exit_name: 'Connect', total_duration: 13 }),
  leg(id, D, bump(at, 1), { caller_id: phone, callee_name: queue, exit_name: 'No Answer', total_duration: 15 }),
  leg(id, D, bump(at, 1), { caller_id: phone, callee_name: 'Call-Queue', exit_name: 'Connect', total_duration: 0 }),
  leg(id, D, bump(at, 1), { caller_id: phone, callee_name: queue, exit_name: 'No Answer', total_duration: 15 }),
  leg(id, D, bump(at, 2), { caller_id: phone, callee_name: 'VMail', exit_name: 'Orig: Bye', total_duration: 45 }),
];
const menuHangup = (id, at, phone) => [leg(id, D, at, { caller_id: phone, exit_name: 'No digit', total_duration: 20 })];
const outbound = (id, at, ext, phone, dur = 120) => [
  leg(id, D, at, { caller_id: String(ext), caller_name: 'Catchy Pest', callee_id: phone, callee_name: phone, exit_name: 'Moved', total_duration: 0 }),
  leg(id, D, at, { caller_id: String(ext), caller_name: 'Steve Barona', callee_id: phone, callee_name: phone, exit_name: 'Orig: Bye', total_duration: dur }),
];
function bump(hhmm, minutes) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + minutes;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

const windowFor = (nowIso) => {
  const nowMs = Date.parse(nowIso);
  return { ...cal.runWindow(nowMs), nowMs };
};

test('holidays include observed dates and the day-after-Thanksgiving', () => {
  const h2026 = cal.holidaysForYear(2026);
  assert.equal(h2026['2026-07-03'], 'Independence Day'); // July 4 is a Saturday
  assert.equal(h2026['2026-05-25'], 'Memorial Day');
  assert.equal(h2026['2026-09-07'], 'Labor Day');
  assert.equal(h2026['2026-11-26'], 'Thanksgiving');
  assert.equal(h2026['2026-11-27'], 'Black Friday');
  assert.equal(h2026['2026-12-24'], 'Christmas Eve');
  assert.equal(h2026['2026-12-25'], 'Christmas Day');
  assert.equal(h2026['2026-12-31'], "New Year's Eve");
  // 2027: Christmas is a Saturday, so it's observed on Friday Dec 24.
  assert.equal(cal.holidayName('2027-12-24'), 'Christmas Eve / Christmas Day');
  // 2028: Jan 1 is a Saturday, observed Friday Dec 31 2027.
  assert.match(cal.holidayName('2027-12-31'), /New Year's Day/);
});

test('run window: noon to noon, Monday covers the weekend, skips weekends and holidays', () => {
  const tue = cal.runWindow(Date.parse('2026-09-29T16:03:00Z'));
  assert.equal(tue.startDate, '2026-09-28');
  assert.equal(new Date(tue.startMs).toISOString(), '2026-09-28T16:00:00.000Z');
  assert.equal(new Date(tue.endMs).toISOString(), '2026-09-29T16:00:00.000Z');

  const mon = cal.runWindow(Date.parse('2026-10-05T16:03:00Z'));
  assert.equal(mon.startDate, '2026-10-02');

  const afterLabor = cal.runWindow(Date.parse('2026-09-08T16:03:00Z'));
  assert.equal(afterLabor.startDate, '2026-09-04');

  assert.equal(cal.runWindow(Date.parse('2026-10-03T16:03:00Z')).skip, true); // Saturday
  assert.equal(cal.runWindow(Date.parse('2026-11-26T17:03:00Z')).reason, 'Thanksgiving');

  // Across the DST change (Nov 1 2026): noon Eastern is 17:00 UTC after it.
  const nov2 = cal.runWindow(Date.parse('2026-11-02T17:05:00Z'));
  assert.equal(new Date(nov2.startMs).toISOString(), '2026-10-30T16:00:00.000Z');
  assert.equal(new Date(nov2.endMs).toISOString(), '2026-11-02T17:00:00.000Z');
});

test('phone and caller-name cleanup', () => {
  assert.equal(normalizePhone('+18285550100'), '8285550100');
  assert.equal(normalizePhone('(828) 555-0100'), '8285550100');
  assert.equal(normalizePhone('103'), null);
  assert.deepEqual(cleanCallerName('VAUGHAN,JOSHUA'), { name: 'Joshua Vaughan', isPlace: false });
  assert.equal(cleanCallerName('LEICESTER NC').isPlace, true);
  assert.equal(cleanCallerName('WIRELESS CALLER'), null);
  assert.equal(cleanCallerName('NewWIRELESS CALLER'), null);
});

test('classifies calls and only flags misses nobody returned', () => {
  const legs = [
    ...answered('a1', '09:05', '8285550101', 102),
    ...voicemail('v1', '09:30', '8285550102'), // Shelley calls back at 10:00
    ...outbound('o1', '10:00', 102, '8285550102'),
    ...voicemail('v2', '13:30', '8285550103', '191'), // Steve at lunch, never returned
    ...menuHangup('m1', '10:15', '8285550104'), // caller gets through later
    ...answered('a2', '10:40', '8285550104', 103),
    ...menuHangup('m2', '18:30', '8285550105'), // after hours, texted back
    ...menuHangup('m3', '19:00', '8285550106'), // after hours, nothing
    ...menuHangup('m4', '19:05', '8285550106'), // same caller again
  ];
  const w = windowFor('2026-09-30T16:05:00Z');
  w.startMs = cal.easternToMs(D, '00:00');
  const texts = [{ to_phone: '8285550105', texted_bool: true, texted_dt: '2026-09-29 23:00:00' }];
  const r = analyzeCalls(legs, w, config, { outboundTexts: texts });

  assert.equal(r.stats.inboundTotal, 8);
  assert.equal(r.stats.answered, 2);
  assert.equal(r.stats.missed, 6);

  const byId = Object.fromEntries(r.missedCalls.map((m) => [m.id, m]));
  assert.equal(byId.v1.outcome, 'voicemail');
  assert.equal(byId.v1.handled.kind, 'callback');
  assert.equal(byId.v1.handled.delaySec, 30 * 60);
  assert.equal(byId.m1.handled.kind, 'caller_got_through');
  assert.equal(byId.m2.handled.kind, 'texted');
  assert.equal(byId.v2.context.period, 'lunch');
  assert.equal(byId.m3.context.label, 'after 5 PM');

  assert.deepEqual(
    r.needsCallback.map((n) => [n.phone, n.misses.length]),
    [
      ['8285550103', 1],
      ['8285550106', 2],
    ],
  );
  assert.equal(r.needsCallback[0].callerTypeFromQueue, 'new');
  assert.equal(r.stats.byType.new.total, 1);
  assert.equal(r.stats.agents[102].inboundAnswered, 1);
  assert.equal(r.stats.agents[103].inboundAnswered, 1);
  assert.equal(r.stats.agents[102].outbound, 1);
  // Only v1 was called back; 30 minutes inside office hours.
  assert.equal(r.stats.callbackCount, 1);
  assert.equal(r.stats.avgCallbackOfficeSec, 30 * 60);
  assert.equal(r.stats.team.talkSec, r.stats.agents[102].talkSec + r.stats.agents[103].talkSec);
});

test('calls before the window start belong to the previous run', () => {
  const legs = [...menuHangup('old', '11:50', '8285550107'), ...menuHangup('new', '12:10', '8285550108')];
  const r = analyzeCalls(legs, windowFor('2026-09-30T16:05:00Z'), config);
  assert.deepEqual(
    r.missedCalls.map((m) => m.id),
    ['new'],
  );
});

test('task routing: menu choice first, then Briostack status', () => {
  const opts = { config, today: '2026-09-30', checkedAtMs: Date.parse('2026-09-30T16:05:00Z') };
  const miss = { startMs: Date.parse('2026-09-30T14:00:00Z'), outcome: 'menu_hangup', totalSec: 12, context: { label: 'Shelley free, Steve free' } };
  const entry = (extra) => ({ phone: '8285550100', callerName: 'Jane Doe', callerNameIsPlace: false, callerTypeFromQueue: null, misses: [miss], ...extra });

  assert.equal(buildTask(entry({ callerTypeFromQueue: 'new' }), { id: 1, statusId: 'CUSTOMER_ACTIVE', name: 'X' }, opts).assigneeName, 'Steve');
  assert.equal(buildTask(entry({ callerTypeFromQueue: 'current' }), null, opts).assigneeName, 'Shelley');
  assert.equal(buildTask(entry(), { id: 1, statusId: 'CUSTOMER_ACTIVE', name: 'Jane Doe' }, opts).assigneeName, 'Shelley');
  const former = buildTask(entry(), { id: 1, statusId: 'CUSTOMER_CANCEL_OUT', name: 'Jane Doe' }, opts);
  assert.equal(former.assigneeName, 'Steve');
  assert.match(former.title, /\(Former customer\)/);
  const unknown = buildTask(entry(), null, opts);
  assert.equal(unknown.assigneeName, 'Steve');
  assert.equal(unknown.customerId, null);
  assert.match(unknown.title, /^PRIORITY - Call back \(NEW caller\): Jane Doe \(828\) 555-0100$/);
  assert.equal(unknown.dueDate, '2026-09-30T17:00:00.000-04:00');
  assert.match(unknown.description, /double call/);
  const current = buildTask(entry({ callerTypeFromQueue: 'current' }), null, opts);
  assert.equal(current.dueDate, '2026-10-01T17:00:00.000-04:00');
  assert.doesNotMatch(current.description, /double call/);
  assert.match(buildTask(entry({ callerName: 'Leicester NC', callerNameIsPlace: true }), null, opts).title, /Unknown caller \(Leicester NC\)/);
});

test('double-call check on unanswered callbacks', () => {
  const w = windowFor('2026-09-30T16:05:00Z');
  w.startMs = cal.easternToMs(D, '00:00');
  const legs = [
    ...voicemail('v1', '09:00', '8285550201', '191'),
    ...outbound('o1', '09:10', 103, '8285550201', 4), // no answer...
    ...outbound('o2', '09:11', 103, '8285550201', 40), // ...second call a minute later
    ...voicemail('v2', '09:20', '8285550202', '191'),
    ...outbound('o3', '09:30', 103, '8285550202', 5), // one short call, nothing after
    ...voicemail('v3', '09:40', '8285550203', '191'),
    ...outbound('o4', '09:45', 102, '8285550203', 300), // connected
  ];
  const r = analyzeCalls(legs, w, config);
  const byId = Object.fromEntries(r.missedCalls.map((m) => [m.id, m.handled.doubleCall]));
  assert.equal(byId.v1.followed, true);
  assert.equal(byId.v2.followed, false);
  assert.equal(byId.v2.agent, 103);
  assert.equal(byId.v3, null);
});

test('busy score stays within 1-10', () => {
  assert.equal(busyScore(0, 0, 480), 1);
  assert.equal(busyScore(480 * 60, 100, 480), 10);
  assert.equal(busyScore(0, 0, 0), null);
});

test('runner: skips weekends, reports ATS failure instead of throwing', async () => {
  const sat = await runCallReview({ nowMs: Date.parse('2026-10-03T16:05:00Z'), ats: {}, brio: null });
  assert.equal(sat.status, 'skipped');

  const ats = {
    searchCalls: async () => {
      throw new Error('ATS auth failed: 401');
    },
    requestCount: () => 1,
  };
  const r = await runCallReview({ nowMs: Date.parse('2026-09-30T16:05:00Z'), ats, brio: null });
  assert.equal(r.status, 'error');
  assert.equal(r.step, 'ATS call log');
  assert.match(r.ownerMessage, /didn’t run successfully/);
});

test('runner: builds tasks and messages, creating tasks through Briostack', async () => {
  const legs = [...voicemail('v', '09:30', '8285550102', '191')].map((l) => ({
    ...l,
    start_time: l.start_time.replace('2026-09-29', '2026-09-30'),
    end_time: l.end_time.replace('2026-09-29', '2026-09-30'),
  }));
  const ats = { searchCalls: async () => legs, searchInboundTexts: async () => [], searchOutboundTexts: async () => [], requestCount: () => 3 };
  const created = [];
  const brio = {
    listOpenTasks: async () => [],
    findCustomerByPhone: async () => null,
    createTask: async (t) => {
      created.push(t);
      return 'T1';
    },
    requestCount: () => 2,
  };
  const r = await runCallReview({ nowMs: Date.parse('2026-09-30T16:05:00Z'), ats, brio });
  assert.equal(r.status, 'ok');
  assert.equal(created.length, 1);
  assert.equal(created[0].assigneeName, 'Steve');
  assert.equal(r.tasks[0].created, true);
  assert.match(r.officeOnlyMessage, /Still need a callback\*\n• 🆕 .*\(828\) 555-0102 — missed Wed, Sep 30 9:30 AM, went to voicemail → \*Steve\*$/m);
  assert.match(r.ownerMessage, /ran cleanly/);
  assert.match(r.ownerMessage, /^<@U09LQDUPQTC>/);
});

test('briostack client sends only the fields the API accepts', async () => {
  const { createBriostackCallbackClient } = require('../src/callReview/briostack');
  const sent = [];
  const fetchImpl = async (url, opts) => {
    sent.push({ url, ...opts, body: JSON.parse(opts.body) });
    return { ok: true, status: 201, text: async () => JSON.stringify({ taskId: '555' }) };
  };
  const brio = createBriostackCallbackClient({ baseUrl: 'https://x/rest/v1', apiKey: 'k', config: { ...config, taskTypeId: 'T' }, fetchImpl, pauseMs: 0 });
  const id = await brio.createTask({ title: 't', description: 'd', startDate: 's', dueDate: 'u', assigneeExt: 103, customerId: null });
  assert.equal(id, '555');
  assert.equal(sent[0].url, 'https://x/rest/v1/tasks');
  assert.deepEqual(sent[0].body, { title: 't', taskTypeId: 'T', statusId: 'ORDER_REQMNT_CREATED', description: 'd', startDate: 's', dueDate: 'u', employeeId: '16635' });

  const noType = createBriostackCallbackClient({ baseUrl: 'https://x/rest/v1', apiKey: 'k', config: { ...config, taskTypeId: null }, fetchImpl, pauseMs: 0 });
  await assert.rejects(noType.createTask({ assigneeExt: 103 }), /no callback task type/);
});

test('runner: skips callers with an open task, links matched customers', async () => {
  const onDay = (legs) => legs.map((l) => ({ ...l, start_time: l.start_time.replace(D, '2026-09-30'), end_time: l.end_time.replace(D, '2026-09-30') }));
  const legs = onDay([...menuHangup('a', '09:30', '8285550301'), ...menuHangup('b', '09:40', '8285550302')]);
  const ats = { searchCalls: async () => legs, searchInboundTexts: async () => [], searchOutboundTexts: async () => [], requestCount: () => 3 };
  const created = [];
  const brio = {
    listOpenTasks: async () => [{ title: 'PRIORITY - Call back (NEW caller): Someone (828) 555-0301' }],
    findCustomerByPhone: async () => ({ id: '17321', name: 'Kenny Edwards', statusId: 'CUSTOMER_ACTIVE', services: [] }),
    createTask: async (t) => {
      created.push(t);
      return 'T2';
    },
    requestCount: () => 3,
  };
  const r = await runCallReview({ nowMs: Date.parse('2026-09-30T16:05:00Z'), ats, brio });
  assert.deepEqual(r.alreadyOpen, ['8285550301']);
  assert.equal(created.length, 1);
  assert.equal(created[0].customerId, '17321');
  assert.equal(created[0].assigneeName, 'Shelley'); // active customer, no menu choice
  assert.match(r.ownerMessage, /already had an open callback task/);
});

test('briostack phone lookup uses the filter expression', async () => {
  const { createBriostackCallbackClient } = require('../src/callReview/briostack');
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    const body = url.includes('/services') ? [] : [{ customerId: '17321', firstName: 'Kenny', lastName: 'Edwards', statusId: 'CUSTOMER_ACTIVE', primaryAddress: { address: '631 Ave', city: 'Asheville' } }];
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const brio = createBriostackCallbackClient({ baseUrl: 'https://x/rest/v1/', apiKey: 'k', config, fetchImpl, pauseMs: 0 });
  const c = await brio.findCustomerByPhone('8287755793');
  assert.equal(decodeURIComponent(urls[0]), 'https://x/rest/v1/customers?filter=primaryPhone.number="+18287755793"');
  assert.equal(c.name, 'Kenny Edwards');
  assert.equal(c.address, '631 Ave, Asheville');
});

test('briostack falls back to caller-ID name + secondary phone', async () => {
  const { createBriostackCallbackClient, searchableName } = require('../src/callReview/briostack');
  assert.deepEqual(searchableName('Kenneth Edward'), { first: 'Kenneth', last: 'Edward' });
  assert.deepEqual(searchableName('J Johnson'), { first: null, last: 'Johnson' });
  assert.equal(searchableName('Madonna'), null);
  assert.deepEqual(searchableName('O"Brien Smith"'), { first: 'OBrien', last: 'Smith' }); // quotes can't reach the filter

  const many = Array.from({ length: 10 }, (_, i) => ({ customerId: String(100 + i), lastName: 'Edwards' }));
  const urls = [];
  const fetchImpl = async (url) => {
    const u = decodeURIComponent(url);
    urls.push(u);
    let body = [];
    if (u.includes('primaryPhone.number')) body = [];
    else if (u.includes('firstName like')) body = [{ customerId: '18240' }];
    else if (u.includes('lastName like')) body = many;
    else if (u.endsWith('/customers/18240')) body = { customerId: '18240', firstName: 'Joseph & Emily', lastName: 'Edwards', statusId: 'CUSTOMER_ACTIVE', secondaryPhone: { number: '+18282429649' } };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  const brio = createBriostackCallbackClient({ baseUrl: 'https://x/rest/v1/', apiKey: 'k', config, fetchImpl, pauseMs: 0 });
  const c = await brio.findCustomerByPhone('8282429649', 'Emily Edwards');
  assert.equal(c.id, '18240');
  assert.equal(c.matchedOn, 'secondary phone');
  assert.ok(urls.some((u) => u.includes('lastName like "Edwards%" and firstName like "%Emily%"')));
  assert.equal(await brio.findCustomerByPhone('8282429649', null), null); // no name -> primary only
});

test('runner: town-only callers silent ~1 minute at the menu are likely robocalls, not tasks', async () => {
  const onDay = (legs) => legs.map((l) => ({ ...l, start_time: l.start_time.replace(D, '2026-09-30'), end_time: l.end_time.replace(D, '2026-09-30') }));
  const silent = (id, at, phone, name, sec = 60) => [leg(id, D, at, { caller_id: phone, caller_name: name, exit_name: 'No digit', total_duration: sec })];
  const legs = onDay([
    ...silent('r1', '09:00', '8645550401', 'ANDERSON SC'), // robocall
    ...silent('r2', '09:05', '8645550402', 'ANDERSON SC'), // ...but Briostack knows the number
    ...silent('r3', '09:10', '8285550403', 'LEOS WINE BAR'), // a name, not a town
    ...silent('r4', '09:15', '8285550404', 'MARSHALL NC', 34), // hung up sooner
    ...silent('r5', '09:20', '8285550405', 'SYLVA NC'), // silent once...
    ...voicemail('r6', '09:25', '8285550405', '191').map((l) => ({ ...l, caller_name: 'SYLVA NC' })), // ...then left a voicemail
  ]);
  const ats = { searchCalls: async () => legs, searchInboundTexts: async () => [], searchOutboundTexts: async () => [], requestCount: () => 3 };
  const brio = {
    listOpenTasks: async () => [],
    findCustomerByPhone: async (phone) => (phone === '8645550402' ? { id: '1', name: 'Pat Known', statusId: 'CUSTOMER_ACTIVE', services: [] } : null),
    createTask: async () => 'T',
    requestCount: () => 1,
  };
  const r = await runCallReview({ nowMs: Date.parse('2026-09-30T16:05:00Z'), ats, brio });
  assert.equal(r.status, 'ok', r.error);
  assert.deepEqual(r.likelyRobocalls.map((x) => x.phone), ['8645550401']);
  assert.deepEqual(r.tasks.map((t) => t.phone).sort(), ['8285550403', '8285550404', '8285550405', '8645550402']);
  assert.doesNotMatch(r.officeOnlyMessage, /555-0401/);
  assert.match(r.officeOnlyMessage, /🤖 Checked for robocalls: 1 number \(1 call\) looked like a robocall and isn't on this list/);
  assert.match(r.ownerMessage, /Likely robocalls, no callback task: 1/);
  assert.match(r.ownerMessage, /Anderson SC \(864\) 555-0401 — missed Wed, Sep 30 9:00 AM/);
  assert.match(r.ownerMessage, /Hung up at menu: 5 \(1 likely robocalls\)/);
  assert.match(r.ownerMessage, /4 callers hung up at the phone menu before pressing 1 or 2 \(not counting 1 likely robocall\)/);

  // Briostack down: no lookup, so the robocall still gets a task.
  const down = { ...brio, findCustomerByPhone: async () => { throw new Error('503'); } };
  const r2 = await runCallReview({ nowMs: Date.parse('2026-09-30T16:05:00Z'), ats, brio: down });
  assert.equal(r2.likelyRobocalls.length, 0);
  assert.ok(r2.tasks.some((t) => t.phone === '8645550401'));
});

test('office message: short recap, team stats, earlier open tasks and within-the-hour callbacks', async () => {
  const onDay = (legs) => legs.map((l) => ({ ...l, start_time: l.start_time.replace(D, '2026-09-30'), end_time: l.end_time.replace(D, '2026-09-30') }));
  const legs = onDay([
    ...answered('a', '09:05', '8285550501', 102),
    ...voicemail('v1', '09:20', '8285550502'),
    ...outbound('o1', '09:40', 102, '8285550502'), // back in 20 min
    ...voicemail('v2', '09:30', '8285550503'),
    ...outbound('o2', '11:00', 103, '8285550503'), // back in 90 min
  ]);
  const ats = { searchCalls: async () => legs, searchInboundTexts: async () => [], searchOutboundTexts: async () => [], requestCount: () => 1 };
  const open = [
    { title: 'PRIORITY - Call back (NEW caller): A (828) 555-0901', employeeId: '16635', dueDate: '2026-09-29T17:00:00.000-04:00' },
    { title: 'PRIORITY - Call back (NEW caller): B (828) 555-0902', employeeId: '16635', dueDate: '2026-10-01T17:00:00.000-04:00' },
    { title: 'Call back (Current customer): C (828) 555-0903', employeeId: '16195', dueDate: '2026-10-01T17:00:00.000-04:00' },
    { title: 'Bid follow-up: D', employeeId: '16635' }, // not a callback task
  ];
  const brio = { listOpenTasks: async () => open, findCustomerByPhone: async () => null, createTask: async () => 'T', requestCount: () => 1 };
  const r = await runCallReview({ nowMs: Date.parse('2026-09-30T16:05:00Z'), ats, brio });
  const m = r.officeOnlyMessage;
  assert.match(m, /^📊 \*Daily call recap\* — Tue, Sep 29 12:00 PM → Wed, Sep 30 12:00 PM _\(noon to noon\)_/);
  assert.match(m, /Still need a callback:\* none 🎉/);
  assert.match(m, /📂 Still open from earlier days: Steve 2 \(1 overdue\) · Shelley 1$/m);
  assert.match(m, /• 3 calls in · 1 answered \(33%\) · 2 calls out/);
  assert.match(m, /median to answer · 🕐 busiest 9 AM \(3 calls\)/);
  assert.match(m, /⚡ 1 of 2 office-hours misses called back within an hour/);
  assert.match(m, /\*Shelley\* — .* busy \d+\/10 · 1 answered · 1 out · /);
  assert.match(m, /\*Steve\* — /);
  assert.match(m, /↩️ 55 min average time to call back a missed call _\(2 callbacks, office hours only\)_/);
  assert.match(m, /\*Office total\* — .* busy \d+\/10 · .* on the phone$/m);
  assert.match(m, /🤖 Checked for robocalls: none found/);
  assert.match(m, /Daniel gets the full report/);
  assert.ok(m.split('\n').length <= 19, m);

  // Tasks without assignee fields: total only.
  const { earlierCallbackTasks } = require('../src/callReview/run');
  assert.deepEqual(earlierCallbackTasks([{ title: 'Call back (NEW caller): X' }], 0), { total: 1, byPerson: { Unassigned: { open: 1, overdue: 0 } } });
  assert.equal(earlierCallbackTasks(null, 0), null);
});
