const test = require('node:test');
const assert = require('node:assert');
const pricing = require('../lib/pricing');
const { parsePost } = require('../lib/slack');
const Q = require('../lib/quote');
const sheet = require('../lib/sheet');
const { loadConfig } = require('../lib/common');
const { taskDue, textSendAt } = require('../send');
const { payWindow, summarize } = require('../payroll');
const { nameMatch, findVisit } = require('../collect');
const cal = require('../../src/callReview/calendar');

const config = loadConfig();
const svc = (serviceCategoryId, statusId, extra = {}) => ({ serviceCategoryId, statusId, serviceCategoryName: serviceCategoryId, initialAmount: 0, ...extra });

// A test customer on Nov 6: a scratched one-time, a completed inspection ($149)
// and a completed one-time ($98).
const inspectionOnly = [
  svc('12504', 'CSC_SCRATCH', { initialAmount: 247, lastAppointmentDate: '2026-10-09' }),
  svc('12501', 'CSC_COMPLETE', { initialAmount: 149, lastAppointmentDate: '2026-10-21' }),
  svc('12504', 'CSC_COMPLETE', { initialAmount: 98, lastAppointmentDate: '2026-11-02' }),
];

test('inspection-only customer gets a credit for everything paid ($447 - $247 = $200)', () => {
  const a = pricing.analyzeServices(inspectionOnly, config, { todayDate: '2026-11-06' });
  assert.equal(a.visitPaid, 247);
  const p = pricing.priceFor('critter', a, config, { exclusion: false });
  assert.deepEqual([p.tier, p.initial, p.monthly, p.credit, p.noAnnualInitial], ['visit_credit', 200, 49, 247, 250]);
  assert.equal(pricing.priceFor('critter', a, config).initial, 400);
});

test('a completed plan with nothing active is a returning customer: 10% off the initial only', () => {
  const a = pricing.analyzeServices([svc('RODENT', 'CSC_COMPLETE', { initialAmount: 375 })], config);
  const p = pricing.priceFor('termite', a, config);
  assert.deepEqual([p.tier, p.initial, p.monthly, p.credit], ['returning', 718, 29, 79]);
  assert.equal(pricing.priceFor('signature', a, config).initial, 313);
});

test('another active plan (any property) gets 50% off, halves rounded up', () => {
  const a = pricing.analyzeServices([svc('GPCONETIME', 'CSC_ACTIVE'), ...inspectionOnly], config);
  const c = pricing.priceFor('critter', a, config);
  assert.deepEqual([c.tier, c.initial, c.monthly, c.credit], ['other_plan', 324, 34, 323]);
  assert.equal(pricing.priceFor('signature', a, config).initial, 174); // covered, but the price math still holds
  assert.equal(pricing.priceFor('termite', a, config).initial, 399);
  assert.equal(pricing.priceFor('critter', a, config, { exclusion: false }).initial, 224);
  assert.equal(a.covered.signature, 'GPCONETIME');
});

test('Catchy Club covers everything; pending/complete plans cover nothing', () => {
  const club = pricing.analyzeServices([svc('11001', 'CSC_ACTIVE')], config);
  assert.ok(club.catchyClub);
  assert.ok(club.covered.termite && club.covered.critter && club.covered.signature);
  const done = pricing.analyzeServices([svc('TERMSRV', 'CSC_COMPLETE')], config);
  assert.deepEqual(done.covered, {});
});

test('exclusion: assumed for rodent signs unless the tech says no; never for yard burrows', () => {
  assert.equal(pricing.exclusionFor(['rodent_droppings'], {}, config), true);
  assert.equal(pricing.exclusionFor(['rodent_droppings'], { techSaysNoExclusion: true }, config), false);
  assert.equal(pricing.exclusionFor(['yard_burrows'], {}, config), false);
  assert.equal(pricing.exclusionFor(['yard_burrows', 'exclusion_needed'], {}, config), true);
  assert.equal(pricing.exclusionFor(['termites'], {}, config), null);
});

test('bonus: every finding is paid, even on one quote; 1.5x on inspection / one-time visits', () => {
  assert.deepEqual(pricing.bonusFor(['carpenter_bees', 'stinging_nest'], {}, config).perPlan, { signature: 3 });
  assert.deepEqual(pricing.bonusFor(['exclusion_needed', 'yard_burrows'], {}, config).perPlan, { critter: 3 });
  assert.equal(pricing.bonusFor(['rodent_droppings'], { visitCategory: '12504' }, config).total, 4.5);
  assert.equal(pricing.bonusFor(['termites', 'rodent_droppings'], { visitCategory: 'GPCONETIME' }, config).total, 7);
});

test('parsePost reads both post formats', () => {
  assert.deepEqual(
    (({ customerId, name }) => ({ customerId, name }))(parsePost('Pat Sample *Customer ID: 15910*\ntermite damage')),
    { customerId: '15910', name: 'Pat Sample' },
  );
  assert.equal(parsePost('Customer: Jane Doe #12345 wasp nest by the deck').customerId, '12345');
  assert.equal(parsePost('Customer: Jane Doe #12345 wasp nest').name, 'Jane Doe');
  assert.ok(parsePost('Quote request: Jane Doe #12345 wants mosquito').quoteRequest);
  assert.equal(parsePost('no id here').customerId, null);
});

test('nameMatch tolerates a typo in the last name', () => {
  assert.equal(nameMatch('Pat Samplle', { firstName: 'Pat', lastName: 'Sample' }), 'close');
  assert.equal(nameMatch('Pat Sample', { firstName: 'Pat', lastName: 'Sample' }), 'exact');
  assert.equal(nameMatch('Joe Smith', { firstName: 'Pat', lastName: 'Sample' }), 'none');
});

test('findVisit accepts the post day or one day after, by that tech only', () => {
  const tech = { employeeId: '17829' };
  const appts = [{ appointmentId: '1', appointmentDate: '2026-11-05', statusId: 'SVC_TICK_COMPLETED', primaryTechnicianId: '17829' }];
  assert.equal(findVisit(appts, { tech, postDate: '2026-11-06', config: { ...config, testAllowAnyVisit: false }, test: false }).appointmentId, '1');
  assert.equal(findVisit(appts, { tech, postDate: '2026-11-07', config: { ...config, testAllowAnyVisit: false }, test: false }), null);
  assert.equal(findVisit(appts, { tech: { employeeId: '15783' }, postDate: '2026-11-05', config: { ...config, testAllowAnyVisit: false }, test: false }), null);
  assert.equal(findVisit(appts, { tech, postDate: '2026-11-09', config, test: true }).waived, true);
});

const post = {
  ts: '1.1', postDate: '2026-11-06', postedAt: '2026-11-06T10:15:00.000-05:00', postTime: '10:15 AM', link: 'x',
  tech: { name: 'Dustin', fullName: 'Dustin M.' },
  customer: { id: '99999', firstName: 'Pat', lastName: 'Sample', street: '1 Test Lane', serviceAddress: '1 Test Lane, Asheville, NC', phones: [] },
  visit: { date: '2026-11-06', category: '12504' }, photos: [{ path: 'a.jpg' }],
  plans: pricing.analyzeServices(inspectionOnly, config, { todayDate: '2026-11-06' }),
  checks: { covered: {}, priorOfferPlans: [] },
};
const decision = {
  ts: '1.1', action: 'quote', findings: ['rodent_droppings'], plan: 'critter', techSaysNoExclusion: true, headline: 'Rodent droppings',
  found: ['x'], email: { intro: ['Hi Pat,'] },
  text: { body: 'Hi Pat, it\'s Dustin. I did your service Friday and found droppings. We can take care of it for $200 (details in the picture). Reply YES and the office will get you scheduled.' },
};

test('a good decision passes; the text must quote the computed price and the right day', () => {
  assert.deepEqual(Q.checkDecision(decision, post, config), []);
  const m = Q.quoteModel(decision, post, config, { today: '2026-11-06' });
  assert.equal(m.initial, '$200');
  assert.equal(m.creditExpiresYmd, '2027-02-04');
  assert.equal(Q.checkTextPrice(decision.text.body, m), null);
  assert.match(Q.checkTextPrice(decision.text.body.replace('$200', '$400'), m), /initial fee \$200/);
  assert.equal(Q.checkDayNames([decision.text.body], m), null);
  assert.match(Q.checkDayNames([decision.text.body.replace('Friday', 'Thursday')], m), /visit was Friday/);
});

test('decisions that must not go out are refused', () => {
  const covered = { ...post, checks: { covered: { critter: 'HomeShield - Critter Control' }, priorOfferPlans: [] } };
  assert.match(Q.checkDecision(decision, covered, config).join(), /already covered/);
  const repeat = { ...post, checks: { covered: {}, priorOfferPlans: ['critter'] } };
  assert.match(Q.checkDecision(decision, repeat, config).join(), /already quoted/);
  assert.match(Q.checkDecision({ ...decision, text: { body: 'Our AI found it for $200. Reply YES' } }, post, config).join(), /AI/);
  assert.match(Q.checkDecision({ ...decision, text: { body: '$200 on a 12-month plan. Reply YES' } }, post, config).join(), /12-month/);
  assert.match(Q.checkDecision({ ...decision, findings: ['termites', 'rodent_droppings'] }, post, config).join(), /one plan/);
});

test('one text and one email per customer: the first quote carries the text for all of them', () => {
  const termite = { ts: '1.2', action: 'quote', findings: ['wood_to_ground'], plan: 'termite', headline: 'Siding to ground', found: ['x'], email: { body: ['Siding touches the ground.'] } };
  const other = { ...post, ts: '1.2' };
  const posts = [post, other, { ...post, ts: '2.1', customer: { ...post.customer, id: '11111' } }];
  const decisions = [decision, termite, { ...decision, ts: '2.1' }];
  const groups = Q.customerGroups(decisions, posts);
  assert.equal(groups.get('1.1:critter').primary, true);
  assert.equal(groups.get('1.2:termite').primary, false);
  assert.equal(groups.get('1.2:termite').group.length, 2);
  assert.equal(groups.get('2.1:critter').group.length, 1);
  // The second quote has no text of its own; it needs its email section.
  assert.deepEqual(Q.checkDecision(termite, other, config, posts, { secondary: true }), []);
  assert.match(Q.checkDecision({ ...termite, text: { body: 'x' } }, other, config, posts, { secondary: true }).join(), /leave text\.body off/);
  // The one text quotes both prices, each in its covers words, and the email.
  const models = [Q.quoteModel(decision, post, config, { today: '2026-11-06' }), Q.quoteModel(termite, other, config, { today: '2026-11-06' })];
  const good = `We can take care of the mice for ${models[0].initial}, which covers ${models[0].coversText}, and protect your home for ${models[1].initial}, which covers ${models[1].coversText} (details in the pictures). I also emailed you the photos and details. Reply YES`;
  assert.deepEqual(Q.checkGroupText(good, models, { hasEmail: true }), []);
  assert.match(Q.checkGroupText(good.replace(models[1].initial, '$1'), models, { hasEmail: true }).join(), /TermiteShield initial fee/);
  assert.match(Q.checkGroupText(good.replace(' I also emailed you the photos and details.', ''), models, { hasEmail: true }).join(), /emailed them/);
  assert.match(Q.checkGroupText(good, models, { hasEmail: false }).join(), /no email address/);
});

test("techs who don't sign: no name in the customer's messages, cards say 'What we found'", () => {
  const unsigned = { ...post, tech: { ...post.tech, signMessages: false } };
  assert.match(Q.checkDecision(decision, unsigned, config).join(), /Dustin doesn't sign/);
  const plain = { ...decision, text: { body: decision.text.body.replace("it's Dustin", 'this is Catchy Pest Solutions') } };
  assert.deepEqual(Q.checkDecision(plain, unsigned, config), []);
  const m = Q.quoteModel(plain, unsigned, config, { today: '2026-11-06' });
  assert.equal(m.foundBy, 'What we found');
  assert.equal(m.signed, false);
  assert.equal(Q.quoteModel(decision, post, config, { today: '2026-11-06' }).foundBy, 'What Dustin found');
});

test('texts go at 10 AM; tasks are due 1 PM, Saturday runs move to Monday', () => {
  const sat8 = cal.easternToMs('2026-11-07', '08:00');
  assert.equal(taskDue(sat8, config), cal.easternIso(cal.easternToMs('2026-11-09', '13:00')));
  assert.equal(taskDue(sat8, { ...config, officeWorksSaturday: true }), cal.easternIso(cal.easternToMs('2026-11-07', '13:00')));
  assert.equal(textSendAt(cal.easternToMs('2026-11-06', '08:00'), config), cal.easternToMs('2026-11-06', '10:00'));
  assert.equal(textSendAt(cal.easternToMs('2026-11-06', '11:00'), config), null);
});

test('pay week: Thursday covers last Thursday through Wednesday', () => {
  assert.deepEqual(payWindow('2026-11-12'), { start: '2026-11-05', end: '2026-11-11' });
  const rows = [
    { 'Visit date': '2026-11-05', Tech: 'Dustin M.', Counted: 'yes', Bonus: '$4.50', Customer: 'A', Plan: 'critter' },
    { 'Visit date': '11/12/2026', Tech: 'Dustin M.', Counted: 'yes', Bonus: '3', Customer: 'B', Plan: 'critter' },
    { 'Visit date': '2026-11-06', Tech: 'Dustin M.', Counted: 'no', Bonus: '0' },
  ];
  const d = summarize(rows, Object.values(config.technicians), payWindow('2026-11-12'), { 17907: 4 }).find((t) => t.tech === 'Dustin M.');
  assert.deepEqual([d.total, d.counted, d.notCounted], [4.5, 1, 1]);
  const max = summarize(rows, Object.values(config.technicians), payWindow('2026-11-12'), { 17907: 4 }).find((t) => t.tech === 'Max R.');
  assert.ok(max.lowParticipation);
});

test('sheet CSV round-trips commas, quotes and newlines', () => {
  const rows = [['Post ID', 'Reason'], ['1.1', 'said "no", then\nyes']];
  assert.deepEqual(sheet.parseCsv(sheet.toCsv(rows)), rows);
});

test('sheet layout: pay weeks newest first, each tech followed by a SUMIFS total, then the week', () => {
  assert.equal(sheet.payWeekOf('2026-11-06'), 'Nov 5 - Nov 11, 2026');
  assert.equal(sheet.payWeekOf('11/12/2026'), 'Nov 12 - Nov 18, 2026');
  const out = sheet.layout([
    { 'Visit date': '2026-11-06', Tech: 'Dustin M.', Bonus: 4.5, Quote: 200, 'Post ID': '1:critter' },
    { 'Visit date': '2026-11-13', Tech: 'Aaron W', Bonus: 4, 'Post ID': '2:termite' },
    { 'Visit date': '2026-11-07', Tech: 'Aaron W', Bonus: 2, 'Post ID': '3:signature' },
  ]);
  const col = (name) => sheet.COLUMNS.indexOf(name);
  assert.equal(out[1][col('Pay week')], 'Nov 12 - Nov 18, 2026');
  assert.equal(out[2][col('Tech')], 'Aaron W - week total');
  assert.equal(out[2][col('Bonus')], '=DOLLAR(SUMIFS(F:F,A:A,A2,B:B,"Aaron W"))');
  assert.equal(out[3][col('Tech')], 'ALL TECHS - week total');
  assert.equal(out[5][col('Tech')], 'Aaron W'); // older week, sorted by tech
  assert.equal(out[6][col('Tech')], 'Aaron W - week total'); // right under Aaron's leads
  assert.equal(out[7][col('Bonus')], '$4.50');
  assert.equal(out[7][col('Quote')], '$200');
  assert.equal(out[8][col('Tech')], 'Dustin M. - week total');
  assert.equal(out[9][col('Tech')], 'ALL TECHS - week total');
  // Reading it back skips the total rows.
  const back = sheet.rowsToObjects(sheet.parseCsv(sheet.toCsv(out))).items;
  assert.deepEqual(back.map((r) => r['Post ID']), ['2:termite', '3:signature', '1:critter']);
});

test('office task: customer ID first, customer notes and custom-quote alert when given', () => {
  const { taskDescription } = require('../send');
  const m = Q.quoteModel(decision, post, config, { today: '2026-11-06' });
  const text = taskDescription({ decision: { ...decision, customerNotes: 'Wants it before Thanksgiving. Call his wife Ann.', officeAlert: 'Possible bats.' }, post, model: m, results: { email: 'sent', text: 'scheduled', textAtMs: Date.parse('2026-11-06T15:00:00Z') }, action: 'quote', sentAtMs: Date.parse('2026-11-06T13:05:00Z') });
  assert.match(text, /^Customer ID: 99999\n/);
  assert.match(text, /Customer notes:\nWants it before Thanksgiving\.\nCall his wife Ann\./);
  assert.match(text, /Custom quote needed:\nPossible bats\./);
  assert.doesNotMatch(text, /slack|appointment|drive\.google/i);
  assert.doesNotMatch(taskDescription({ decision, post, model: m, results: { email: 'sent', text: 'sent' }, action: 'quote', sentAtMs: Date.now() }), /Customer notes/);
});

test('quote request for one of our plans is priced like a finding, without photos, $0 bonus', () => {
  const req = {
    ts: '1.1', action: 'quote', findings: ['quote_request'], plan: 'termite', headline: 'Termite protection',
    found: ['Asked about termite protection.'], email: { intro: ['Hi Pat,'] },
    text: { body: 'Hi Pat, it\'s Dustin. When I did your service Friday you asked about termite protection. We can protect your home for $550 (details in the picture). Reply YES and the office will get you scheduled.' },
  };
  const noPhotos = { ...post, photos: [] };
  assert.deepEqual(Q.checkDecision(req, noPhotos, config), []);
  const m = Q.quoteModel(req, noPhotos, config, { today: '2026-11-06' });
  assert.deepEqual([m.request, m.plan, m.initial, m.bonus], [true, 'termite', '$550', 0]);
  assert.equal(Q.checkTextPrice(req.text.body, m), null);
  // Critter requests include exclusion unless the tech says otherwise.
  assert.equal(Q.quoteModel({ ...req, plan: 'critter' }, noPhotos, config, { today: '2026-11-06' }).exclusion, true);
  assert.equal(Q.quoteModel({ ...req, plan: 'critter', techSaysNoExclusion: true }, noPhotos, config, { today: '2026-11-06' }).exclusion, false);
  // Needs one of our plans; a finding still needs photos.
  assert.match(Q.checkDecision({ ...req, plan: 'mosquito' }, noPhotos, config).join(), /quote request needs plan/);
  assert.match(Q.checkDecision(decision, noPhotos, config).join(), /no photos/);
});

test('price covers: the tech\'s finding goes to the top, exclusion only on the with-exclusion price, monthly line last', () => {
  const sig = Q.priceCovers('signature', ['stinging_nest'], null, '$44', config);
  assert.match(sig.lines[0], /^Active nests treated and removed/);
  assert.ok(!sig.lines.some((l) => /carpenter/i.test(l)));
  assert.deepEqual(sig.items[0], { text: sig.lines[0], top: true });
  assert.equal(sig.monthlyLine, 'Then $44 a month, starting month 4');
  assert.match(sig.text, /removing the nests/);

  const gap = Q.priceCovers('critter', ['exclusion_needed'], true, '$49', config);
  assert.match(gap.lines[0], /^Entry points sealed/);
  assert.match(gap.text, /^sealing the entry points/);
  assert.match(gap.details[0], /don't do construction repairs/);

  const burrows = Q.priceCovers('critter', ['yard_burrows'], false, '$49', config);
  assert.ok(!burrows.lines.some((l) => /Entry points/.test(l)));
  assert.ok(burrows.lines.some((l) => /Two-week follow-up/.test(l)));
  assert.ok(!/entry points/.test(burrows.text));
  assert.match(burrows.text, /granular repellent/);

  const droppings = Q.priceCovers('critter', ['rodent_droppings'], true, '$49', config);
  assert.ok(droppings.lines.some((l) => /Entry points/.test(l)));
  assert.match(droppings.text, /sealing the entry points/);

  const termite = Q.priceCovers('termite', ['wood_to_ground'], null, '$29', config);
  assert.equal(termite.lines[0], 'Wood-to-ground areas treated directly');
  assert.equal(termite.text, 'the soil treatment and bait stations, with a damage warranty');
  assert.match(termite.finePrint.join(' '), /not damage that's already there/);
  const request = Q.priceCovers('termite', ['quote_request'], null, '$29', config);
  assert.ok(request.items.every((i) => !i.top));
});

test('the text must say what the price covers in the fixed words', () => {
  const m = Q.quoteModel(decision, post, config, { today: '2026-11-06' });
  assert.equal(m.monthlyLine, `Then ${m.monthly} a month, starting month 4`);
  assert.match(Q.checkTextCovers(decision.text.body, m), /which covers 7 days of daily visits/);
  const good = decision.text.body.replace('$200 (details', `$200, which covers ${m.coversText} (details`);
  assert.equal(Q.checkTextCovers(good, m), null);
  assert.equal(Q.checkTextCovers(good.replace('7 days', '7  Days'), m), null);
});

test('one quote per plan: text pieces join, and other posts merge in with their own findings', () => {
  assert.equal(Q.priceCovers('signature', ['carpenter_bees', 'stinging_nest'], null, '$44', config).text, 'foaming the carpenter bee holes, removing the nests and your first 3 treatments');
  assert.equal(Q.priceCovers('critter', ['exclusion_needed', 'yard_burrows'], true, '$49', config).text, 'sealing the entry points, 7 days of daily visits and a granular repellent');

  // Entry points in one post, mole burrows in another: one Critter quote with exclusion.
  const gapPost = { ...post, ts: '1.1' };
  const burrowPost = { ...post, ts: '2.2' };
  const merged = { ...decision, findings: ['exclusion_needed'], techSaysNoExclusion: false, alsoPosts: [{ ts: '2.2', findings: ['yard_burrows'] }] };
  assert.deepEqual(Q.checkDecision(merged, gapPost, config, [gapPost, burrowPost]), []);
  assert.deepEqual(Q.allFindings(merged), ['exclusion_needed', 'yard_burrows']);
  const m = Q.quoteModel(merged, gapPost, config, { today: '2026-11-06' });
  assert.equal(m.exclusion, true);
  assert.equal(m.bonus, 3); // this post's own finding ($2 x 1.5 one-time visit); the burrow post is paid on its own row

  const stranger = { ...burrowPost, customer: { ...post.customer, id: '11111' } };
  assert.match(Q.checkDecision(merged, gapPost, config, [gapPost, stranger]).join(), /different customer/);
  assert.match(Q.checkDecision(merged, gapPost, config, [gapPost]).join(), /no collected post/);
  assert.match(Q.checkMerges(merged, [merged, { ts: '2.2', action: 'quote', findings: ['yard_burrows'] }], config).join(), /can't have its own critter decision/);
  assert.deepEqual(Q.checkMerges(merged, [merged, { ts: '2.2', action: 'quote', findings: ['termites'] }], config), []);
});

test('a merged post gets its own sheet row: its findings, its bonus, no second quote', () => {
  const { mergedRows } = require('../send');
  const other = { ...post, ts: '2.2', tech: { name: 'Aaron', fullName: 'Aaron W' }, visit: { date: '2026-11-06', category: 'RODENT' } };
  const merged = { ...decision, findings: ['exclusion_needed'], techSaysNoExclusion: false, alsoPosts: [{ ts: '2.2', findings: ['yard_burrows'] }] };
  const m = Q.quoteModel(merged, post, config, { today: '2026-11-06' });
  const [row] = mergedRows({ decision: merged, model: m, posts: [post, other], config });
  assert.equal(row['Post ID'], '2.2:critter');
  assert.equal(row.Tech, 'Aaron W');
  assert.equal(row.Bonus, 1);
  assert.equal(row.Quote, '');
  assert.equal(row.Status, 'quoted');
  assert.match(row.Finding, /burrows/);
  assert.match(row.Notes, /same quote as post 1\.1/);
  const [noBonus] = mergedRows({ decision: { ...merged, alsoPosts: [{ ts: '2.2', findings: ['yard_burrows'], missingSteps: ['wide photo'] }] }, model: m, posts: [post, other], config });
  assert.deepEqual([noBonus.Bonus, noBonus.Counted], [0, 'no']);
});

test('sheet Post IDs always keep a ":" so Google Sheets doesn\'t round the Slack ts', () => {
  const { sheetPostId } = require('../send');
  assert.equal(sheetPostId({ ts: '1794243334.617239', action: 'skip' }), '1794243334.617239:none');
  assert.equal(sheetPostId({ ts: '1794251167.644139', action: 'quote', plan: 'termite' }), '1794251167.644139:termite');
});

test('bats on a Critter Control customer: custom_quote, a task for the office, no coverage stop', () => {
  const covered = { ...post, checks: { covered: { critter: 'HomeShield - Critter Control' }, priorOfferPlans: [] } };
  const bats = { ts: '1.1', action: 'custom_quote', findings: ['rodent_droppings'], plan: 'critter', officeAlert: 'Possible bats.' };
  assert.deepEqual(Q.checkDecision(bats, covered, config), []);
  assert.match(Q.checkDecision({ ...bats, action: 'quote' }, covered, config).join(), /already covered/);
});

test('tech notes: thank you with the bonus and the pay-week total, read from the sheet', () => {
  const { notesFor } = require('../tech-notes');
  const week = 'Nov 5 - Nov 11, 2026';
  const rows = [
    { 'Pay week': week, Tech: 'Aaron W', Customer: 'Karen Gerry', Quote: '$399', Plan: 'Carolina TermiteShield', Bonus: '$2', Counted: 'yes', 'Post ID': '1.1:termite' },
    { 'Pay week': week, Tech: 'Aaron W', Customer: 'Jim Kerley', Quote: '$324', Bonus: '$0', Counted: 'no', 'Post ID': '2.2:critter' },
    { 'Pay week': week, Tech: 'Aaron W', Customer: 'Susan Justus', Quote: '$399', Bonus: '$2', Counted: 'yes', 'Post ID': '3.3:termite' },
  ];
  const posts = ['1.1', '2.2', '3.3', '4.4'].map((ts) => ({ ts, tech: { name: 'Aaron', fullName: 'Aaron W' } }));
  const notes = notesFor({
    rows,
    posts,
    decisions: [
      { ts: '1.1', action: 'quote', plan: 'termite' },
      { ts: '2.2', action: 'quote', plan: 'critter', techMessage: 'Next time add a second photo.' },
      { ts: '4.4', action: 'skip', techMessage: "Didn't count: they already have Critter Control." },
    ],
  });
  assert.equal(notes[0].text, 'Quote sent to Karen Gerry (TermiteShield, $399). $2 bonus added, thank you Aaron! Your bonuses this pay week (Nov 5 - Nov 11): $4.');
  assert.equal(notes[1].text, 'Quote sent to Jim Kerley (Critter Control, $324). Next time add a second photo. Your bonuses this pay week (Nov 5 - Nov 11): $4.');
  assert.equal(notes[2].text, "Didn't count: they already have Critter Control.");
});
