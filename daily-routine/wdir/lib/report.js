// The Official North Carolina Wood-Destroying Insect Information Report
// (WDIR 100) for one inspection: the routine's "wdir" decision plus the
// collected Slack post -> every value printed on the form, and the checks
// that refuse a report breaking Daniel's rules (wdir/WDIR_RULES.md).
// Pure functions: no API calls.
const cal = require('../../src/callReview/calendar');

const INSECTS = [
  { key: 'termites', letter: 'A', label: 'Subterranean termites', field: 'SubterraneanTermites', boxes: ['SubterraneanTermitesControlMeasuresPerformed', 'SubterraneanTermitesNoControlMeasuresPerformed', 'SubterraneanTermitesVisibleEvidence'], locField: 'SubterraneanTermitesVisibleEvidenceLocation' },
  { key: 'powderPostBeetles', letter: 'B', label: 'Powder post beetles', field: 'PowderPostBeetles', boxes: ['PowderPostBeetlesControlMeasuresPerformed', 'PowderPostBeetlesNoControlMeasuresPerformed', 'PowderPostBeetlesInactiveInfestation'], locField: 'PowderPostBeetlesVisibleEvidenceLocation' },
  { key: 'oldHouseBorers', letter: 'C', label: 'Old house borers', field: 'OldHouseBorers', boxes: ['OldHouseBorersControlMeasuresPerformed', 'OldHouseBorersNoControlMeasuresPerformed', 'OldHouseBorersInactiveInfestation'], locField: 'OldHouseBorersVisibleEvidenceLocation' },
  { key: 'others', letter: 'D', label: 'Others', field: 'Others', boxes: ['OthersControlMeasuresPerformed', 'OthersNoControlMeasuresPerformed', 'OthersInactiveInfestation'], locField: 'OthersVisibleEvidenceLocation' },
];

// Our own words never call anything damage, active, inactive, live or
// dead (Daniel, Nov 24: an insect report, not a damage report). The form's
// printed box labels say "inactive"; that's the form, not us.
// No recommendations either: a checked box says treatment is needed.
const BANNED = /\b(damaged?|damages|damaging|active|inactive|activity|activities|alive|live|dead|infested|severe|extensive|minor|structural|recommend|recommends|recommended|recommendation)\b/i;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const longDate = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
const slashDate = (ymd) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}/${ymd.slice(0, 4)}`;

// Every photo of the post and the posts merged into it, in the order the
// decision lists them: Photo 1, Photo 2, ...
function photoList(decision, post, allPosts = []) {
  const postOf = (ts) => (!ts || ts === post.ts ? post : allPosts.find((p) => p.ts === ts));
  return (decision.photos || []).map((p, i) => ({ n: i + 1, ts: p.ts || post.ts, index: p.index, caption: String(p.caption || '').trim(), photo: postOf(p.ts)?.photos?.[p.index - 1] || null }));
}

// "See photo 3", "photos 2-3", "photos 2 and 4": the numbers a text refers to.
function photoRefs(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/\bphotos?\s+((?:\d+\s*(?:-|–|,|and|&)?\s*)+)/gi)) {
    const nums = m[1].match(/\d+/g).map(Number);
    if (/[-–]/.test(m[1]) && nums.length === 2) for (let n = nums[0]; n <= nums[1]; n++) out.push(n);
    else out.push(...nums);
  }
  return out;
}

function sectionTwo(w, config) {
  const std = w.atticInspected ? config.wdir.inaccessibleStandard.replace(/^Attic not inspected\.\s*/, '') : config.wdir.inaccessibleStandard;
  const extra = String(w.inaccessibleExtra || '').trim();
  return extra ? `${std} Also: ${extra}` : std;
}

// Everything printed on the form, from the decision and the post.
function reportModel(decision, post, config, allPosts = []) {
  const w = decision.wdir || {};
  const firm = config.wdir.firm;
  const sa = post.visit?.serviceAddress || {};
  const street = sa.address || post.customer?.street || '';
  const city = sa.city || '';
  const state = sa.stateOrProvince || 'NC';
  const zip = sa.postalCode || '';
  const date = post.visit?.date || post.postDate;
  const insects = INSECTS.map((def) => {
    const f = w[def.key];
    return { ...def, found: Boolean(f), box: f?.box || null, location: f ? String(f.location || '').trim() : '', type: def.key === 'others' && f ? f.type : '' };
  });
  // A previous treatment with no signs of termites: A stays unchecked, the
  // note goes in A's location box (Daniel, Nov 24).
  if (!w.termites && String(w.termitesNote || '').trim()) insects[0].location = String(w.termitesNote).trim();
  const anyFound = insects.some((i) => i.found);
  const conducive = (w.conducive || []).map((s) => String(s).trim()).filter(Boolean);
  const photos = photoList(decision, post, allPosts);
  return {
    key: `${decision.ts}:wdir`,
    sellers: String(w.sellers || '').trim() || 'Not provided',
    buyers: String(w.buyers || '').trim() || 'Not provided',
    street, city, state, zip,
    address: [street, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    otherStructures: String(w.otherStructures || '').trim(),
    inaccessible: sectionTwo(w, config),
    insects,
    noVisibleEvidence: !anyFound,
    conducive,
    remarks: (w.remarks || []).map((s) => String(s).trim()).filter(Boolean),
    date,
    dateSlash: slashDate(date),
    dateLong: longDate(date),
    visitDay: DAY_NAMES[cal.weekdayOf(date)],
    fileNumber: String(post.visit?.appointmentId || decision.ts),
    inspector: post.tech?.fullName || post.tech?.name || '',
    firm,
    photos,
    quoteNeeded: anyFound || conducive.length > 0,
  };
}

// Problems with a "wdir" decision; empty when the report can be made.
function checkWdir(decision, post, config, allPosts = []) {
  const errs = [];
  const w = decision.wdir;
  if (!w || typeof w !== 'object') return ['needs "wdir": { ... } (see wdir/WDIR_RULES.md)'];
  if (!post.customer?.id) errs.push('no customer: fix the customer ID first');
  if (!post.visit) errs.push('no matching visit by this tech (the inspection date comes from it)');
  const allowedTypes = config.wdir.otherTypes;
  for (const def of INSECTS) {
    const f = w[def.key];
    if (f == null) continue;
    if (![1, 2, 3].includes(f.box)) errs.push(`${def.letter} (${def.label}): box must be 1, 2 or 3`);
    if (!String(f.location || '').trim()) errs.push(`${def.letter} (${def.label}): needs location (what was seen and where)`);
    if (f.box === 1 && !w.treatedByUs) errs.push(`${def.letter}: box 1 (control measures performed) only when we treated this property (set "treatedByUs": true with the Briostack service)`);
    if (def.key === 'others') {
      if (!allowedTypes.includes(f.type)) errs.push(`D (Others) is only ${allowedTypes.join(', ')}; got "${f.type || ''}"`);
      if (f.box === 3) errs.push('D (carpenter bees/ants) is never box 3: carpenter bees and ants are always box 2');
    }
  }
  if (w.termites && String(w.termitesNote || '').trim()) errs.push('termitesNote is only for a previous treatment with no signs of termites (A unchecked)');

  // Photos: every photo the tech posted, each once.
  const photos = photoList(decision, post, allPosts);
  const merged = [post, ...(decision.alsoPosts || []).map((a) => allPosts.find((p) => p.ts === a.ts)).filter(Boolean)];
  for (const a of decision.alsoPosts || []) {
    const other = allPosts.find((p) => p.ts === a.ts);
    if (!other) errs.push(`alsoPosts: no collected post with ts ${a.ts}`);
    else if (String(other.customer?.id) !== String(post.customer?.id)) errs.push(`alsoPosts ${a.ts} is a different customer`);
  }
  for (const p of photos) if (!p.photo) errs.push(`photo ${p.n}: no photo ${p.index} on post ${p.ts}`);
  const want = merged.flatMap((x) => (x.photos || []).map((_, i) => `${x.ts}#${i + 1}`));
  const have = photos.map((p) => `${p.ts}#${p.index}`);
  const missing = want.filter((k) => !have.includes(k));
  if (missing.length) errs.push(`every photo the tech took goes on the report; missing ${missing.join(', ')}`);
  if (new Set(have).size !== have.length) errs.push('a photo is listed twice');
  for (const p of photos) if (!p.caption) errs.push(`photo ${p.n} needs a caption`);

  // Words.
  const texts = [
    ...INSECTS.map((d) => [`${d.letter} location`, w[d.key]?.location]),
    ['termitesNote', w.termitesNote], ['inaccessibleExtra', w.inaccessibleExtra], ['otherStructures', w.otherStructures],
    ...(w.conducive || []).map((c, i) => [`conducive ${i + 1}`, c]),
    ...(w.remarks || []).map((c, i) => [`remarks ${i + 1}`, c]),
    ...photos.map((p) => [`photo ${p.n} caption`, p.caption]),
  ];
  for (const [label, t] of texts) {
    const m = BANNED.exec(String(t || ''));
    if (m) errs.push(`${label} says "${m[0]}": describe what was seen and where ("signs of termites observed at the sill plate"), never damage, active/inactive, live/dead, how bad or a recommendation`);
    for (const n of photoRefs(t)) if (n < 1 || n > photos.length) errs.push(`${label} refers to photo ${n}, but the report has ${photos.length} photo${photos.length === 1 ? '' : 's'}`);
  }
  return errs;
}

// The email's short summary (the office forwards it to the agent or
// customer): the same words as the report, so the two always agree.
function summaryLines(model) {
  const lines = [];
  for (const i of model.insects) {
    if (i.found) lines.push(`${i.key === 'others' ? i.type : i.label}: ${i.location}`);
    else if (i.key === 'termites' && i.location) lines.push(`Subterranean termites: ${i.location}`);
  }
  if (model.noVisibleEvidence) lines.push('No visible evidence of infestation from wood-destroying insects was observed.');
  if (model.conducive.length) lines.push(`Conditions conducive to subterranean termites: ${model.conducive.join(' ')}`);
  return lines;
}

function emailContent(model, config) {
  const subject = `Wood-Destroying Insect Report – ${model.address}`;
  const intro = `Attached is the Official North Carolina Wood-Destroying Insect Information Report for ${model.address}, inspected by ${config.wdir.firm.name} on ${model.visitDay}, ${model.dateLong}.`;
  const quote = model.quoteNeeded ? "If you'd like a quote to address these findings, reply to this email or give us a call and we'll be glad to put one together." : '';
  const lines = summaryLines(model);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const p = 'style="margin:0 0 14px 0;"';
  const html = [
    '<div style="font-family:Arial, Helvetica, sans-serif; font-size:15px; line-height:1.5; color:#0E120E; max-width:640px;">',
    `<p ${p}>Hello,</p>`,
    `<p ${p}>${esc(intro)}</p>`,
    `<p style="margin:0 0 6px 0;"><strong>Summary of findings</strong></p>`,
    `<ul style="margin:0 0 14px 0; padding-left:20px;">${lines.map((l) => `<li style="margin:0 0 6px 0;">${esc(l)}</li>`).join('')}</ul>`,
    quote ? `<p ${p}>${esc(quote)}</p>` : '',
    `<p ${p}>Please see the attached report for the full findings and photos.</p>`,
    `<p ${p}>Thank you,<br>The ${esc(config.wdir.firm.name)} team<br>${esc(config.wdir.firm.phone)} &middot; ${esc(config.company.website)}</p>`,
    '</div>',
  ].join('\n');
  const text = ['Hello,', intro, 'Summary of findings:', ...lines.map((l) => `- ${l}`), quote, 'Please see the attached report for the full findings and photos.', `Thank you,\nThe ${config.wdir.firm.name} team\n${config.wdir.firm.phone} · ${config.company.website}`].filter(Boolean).join('\n\n');
  return { subject, html, text, filename: `WDIR - ${model.address} - ${model.dateSlash.replace(/\//g, '-')}.pdf`.replace(/[\\/:*?"<>|]/g, '') };
}

module.exports = { INSECTS, BANNED, reportModel, checkWdir, summaryLines, emailContent, photoRefs, photoList };
