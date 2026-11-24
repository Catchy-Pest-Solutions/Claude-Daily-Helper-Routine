const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../lib/report');
const Q = require('../../inspection-findings/lib/quote');
const { parsePost } = require('../../inspection-findings/lib/slack');
const { loadConfig } = require('../../inspection-findings/lib/common');
const { FIELDS } = require('../lib/render');

const config = loadConfig();
const post = {
  ts: '5.1', postDate: '2026-11-23',
  tech: { name: 'Joey', fullName: 'Joey J' },
  customer: { id: '18136', firstName: 'Laura', lastName: 'Penny', street: '62 Upper Moffitt Rd' },
  visit: { date: '2026-11-23', appointmentId: '40001', serviceAddress: { address: '62 Upper Moffitt Rd', city: 'Asheville', stateOrProvince: 'NC', postalCode: '28806' } },
  photos: [{ path: 'a.jpg' }, { path: 'b.jpg' }],
};
const base = {
  ts: '5.1', action: 'wdir',
  wdir: {
    termites: null, powderPostBeetles: null, oldHouseBorers: null,
    others: { type: 'Carpenter bees', box: 2, location: 'Signs of carpenter bee burrows observed in the front porch fascia. Treatment is recommended. See photo 1.' },
    conducive: ['Wood-to-ground contact at the back porch steps (photo 2).'],
    remarks: [],
  },
  photos: [{ index: 1, caption: 'Carpenter bee burrows in the porch fascia.' }, { index: 2, caption: 'Back porch steps on the soil.' }],
};
const withW = (patch) => ({ ...base, wdir: { ...base.wdir, ...patch } });

test('a good WDIR decision passes and fills the form', () => {
  assert.deepEqual(W.checkWdir(base, post, config), []);
  assert.deepEqual(Q.checkDecision(base, post, config, [post]), []);
  assert.equal(Q.leadKey(base), '5.1:wdir');
  const m = W.reportModel(base, post, config);
  assert.equal(m.address, '62 Upper Moffitt Rd, Asheville, NC 28806');
  assert.deepEqual([m.sellers, m.buyers], ['Not provided', 'Not provided']);
  assert.equal(m.dateSlash, '11/23/2026');
  assert.equal(m.fileNumber, '40001');
  assert.equal(m.noVisibleEvidence, false); // D found: box 4 stays empty
  assert.equal(m.quoteNeeded, true);
  assert.match(m.inaccessible, /^Attic not inspected\./);
  assert.equal(m.firm.license, '2592PW');
});

test('box rules: D is only carpenter bees/ants and never box 3; box 1 only when we treated', () => {
  assert.match(W.checkWdir(withW({ others: { ...base.wdir.others, type: 'Drywood termites' } }), post, config).join(), /only Carpenter bees/);
  assert.match(W.checkWdir(withW({ others: { ...base.wdir.others, box: 3 } }), post, config).join(), /never box 3/);
  const treated = withW({ termites: { box: 1, location: 'Signs of termites observed at the sill plate. See photo 1.' } });
  assert.match(W.checkWdir(treated, post, config).join(), /only when we treated/);
  assert.deepEqual(W.checkWdir({ ...treated, wdir: { ...treated.wdir, treatedByUs: true } }, post, config), []);
  assert.match(W.checkWdir(withW({ powderPostBeetles: { box: 4, location: 'x' } }), post, config).join(), /box must be 1, 2 or 3/);
});

test("our words never say damage, active/inactive, live/dead or how bad (Daniel, Nov 24)", () => {
  for (const word of ['damage', 'active', 'inactive', 'live', 'dead', 'activity', 'extensive']) {
    const d = withW({ termites: { box: 2, location: `Termite ${word} observed at the sill plate.` } });
    assert.match(W.checkWdir(d, post, config).join(), /never damage/, word);
  }
  // The form's printed labels are fine; "No fresh powder observed" is our wording for beetles.
  assert.deepEqual(W.checkWdir(withW({ powderPostBeetles: { box: 3, location: 'Powder post beetle exit holes observed in the subfloor. No fresh powder observed. See photo 2.' } }), post, config), []);
});

test('previous treatment with no signs of termites: A unchecked, box 4, note in A\'s box', () => {
  const d = withW({ others: null, conducive: [], termitesNote: 'No signs of termites observed. Termite bait stations from a previous treatment were noted around the home. See photo 1.' });
  assert.deepEqual(W.checkWdir(d, post, config), []);
  const m = W.reportModel(d, post, config);
  assert.equal(m.insects[0].found, false);
  assert.match(m.insects[0].location, /bait stations/);
  assert.equal(m.noVisibleEvidence, true);
  assert.equal(m.quoteNeeded, false);
  assert.match(W.summaryLines(m).join(' '), /No visible evidence of infestation/);
  // termitesNote can't sit next to a checked A.
  assert.match(W.checkWdir({ ...d, wdir: { ...d.wdir, termites: { box: 2, location: 'Signs of termites observed. See photo 1.' } } }, post, config).join(), /termitesNote/);
});

test('every photo the tech took goes on the report, captioned, and photo references must exist', () => {
  assert.match(W.checkWdir({ ...base, photos: [base.photos[0]] }, post, config).join(), /every photo.*5\.1#2/);
  assert.match(W.checkWdir({ ...base, photos: [base.photos[0], { index: 2, caption: '' }] }, post, config).join(), /photo 2 needs a caption/);
  assert.match(W.checkWdir(withW({ conducive: ['Wood-to-ground contact (photo 7).'] }), post, config).join(), /refers to photo 7/);
  assert.deepEqual(W.photoRefs('See photos 2-4 and photo 6.'), [2, 3, 4, 6]);
});

test('section 2: standard line, attic only when not inspected, plus the tech\'s areas', () => {
  const m = W.reportModel(withW({ atticInspected: true, inaccessibleExtra: 'Crawl space partially obstructed by ductwork.' }), post, config);
  assert.doesNotMatch(m.inaccessible, /Attic not inspected/);
  assert.match(m.inaccessible, /Also: Crawl space partially obstructed by ductwork\.$/);
});

test('email to the office: subject, summary from the report, quote line only with findings', () => {
  const mail = W.emailContent(W.reportModel(base, post, config), config);
  assert.equal(mail.subject, 'Wood-Destroying Insect Report – 62 Upper Moffitt Rd, Asheville, NC 28806');
  assert.match(mail.text, /Carpenter bees: Signs of carpenter bee burrows/);
  assert.match(mail.text, /reply to this email or give us a call/);
  assert.match(mail.filename, /^WDIR - 62 Upper Moffitt Rd, Asheville, NC 28806 - 11-23-2026\.pdf$/);
  const clean = W.emailContent(W.reportModel(withW({ others: null, conducive: [] }), post, config), config);
  assert.doesNotMatch(clean.text, /quote/);
});

test('WDIR posts are recognized in the channel, and every form field exists', () => {
  assert.equal(parsePost('WDIR Laura Penny #18136 carpenter bees on porch').wdir, true);
  assert.equal(parsePost('Wood destroying insect report for Laura Penny 18136').wdir, true);
  assert.equal(parsePost('Laura Penny #18136 wood to ground').wdir, false);
  for (const i of W.INSECTS) for (const f of [i.field, i.locField, ...i.boxes]) assert.ok(FIELDS[f], f);
});
