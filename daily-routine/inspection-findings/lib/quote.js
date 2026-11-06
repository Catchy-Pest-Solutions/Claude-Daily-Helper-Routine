// Turns one routine decision (decisions.json) plus the collected post
// (posts.json) into the numbers and words render.js and send.js use. Prices
// always come from pricing.js here, never from the decision, so a typo in a
// message can't change what the customer is quoted: the message is checked
// against the computed price instead.
const pricing = require('./pricing');
const cal = require('../../src/callReview/calendar');

const ACTIONS = ['quote', 'commercial', 'quote_request', 'skip', 'ask'];
const money = (n) => `$${Number(n).toLocaleString('en-US')}`;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const longDate = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

function leadKey(decision) {
  return decision.plan ? `${decision.ts}:${decision.plan}` : String(decision.ts);
}

// Problems with a decision; empty when it can go ahead.
function checkDecision(decision, post, config) {
  const errs = [];
  if (!ACTIONS.includes(decision.action)) errs.push(`action must be one of ${ACTIONS.join(', ')}`);
  if (!post) return [`no collected post with ts ${decision.ts}`];
  const findings = decision.findings || [];
  for (const k of findings) if (!config.findings.some((f) => f.key === k)) errs.push(`unknown finding "${k}"`);
  if (['skip', 'ask'].includes(decision.action)) {
    if (!String(decision.techMessage || '').trim()) errs.push(`${decision.action} needs techMessage (the note to the tech)`);
    return errs;
  }
  if (decision.action === 'quote_request') return errs;
  if (!findings.length) errs.push('needs findings');
  const plans = [...new Set(findings.map((k) => config.findings.find((f) => f.key === k)?.plan).filter(Boolean))];
  if (plans.length !== 1) errs.push(`findings must all point at one plan (got ${plans.join(', ') || 'none'}); write one decision per plan`);
  if (decision.plan && plans[0] && decision.plan !== plans[0]) errs.push(`plan "${decision.plan}" doesn't match the findings (${plans[0]})`);
  if (decision.action === 'commercial') return errs;

  // Hard stops the routine should already have caught.
  const plan = decision.plan || plans[0];
  if (post.checks?.catchyClub) errs.push('Catchy Club customer: skip');
  if (post.checks?.covered?.[plan]) errs.push(`already covered by ${post.checks.covered[plan]}: skip`);
  if ((post.checks?.priorOfferPlans || []).includes(plan) && !decision.allowRepeat) errs.push(`${plan} was already quoted and the offer is still open: skip`);
  if (post.checks?.commercial) errs.push('business: use action "commercial"');
  if (!post.visit) errs.push('no matching visit');
  if (!post.photos?.length) errs.push('no photos');

  const t = String(decision.text?.body || '');
  if (!t.trim()) errs.push('needs text.body');
  if (!String(decision.headline || '').trim()) errs.push('needs headline (the problem, for the card)');
  if (String(decision.headline || '').length > 70) errs.push('headline is over 70 characters');
  if (!(decision.email?.intro || []).length) errs.push('needs email.intro paragraphs');
  if (!(decision.found || []).length) errs.push('needs found (what was found and where, for the PDF)');
  for (const [label, s] of [['text.body', t], ['email', JSON.stringify(decision.email || {})], ['found', JSON.stringify(decision.found || [])]]) {
    if (/\b(AI|artificial intelligence|ChatGPT|Claude|automated)\b/.test(s)) errs.push(`${label} mentions AI/automation`);
  }
  if (/12[- ]month|annual|contract/i.test(t)) errs.push("text.body mustn't mention the 12-month plan (it's in the picture)");
  if (!/reply yes/i.test(t)) errs.push('text.body should end with the "Reply YES" close');
  return errs;
}

// Everything the templates and messages need for a quote decision.
function quoteModel(decision, post, config, { today }) {
  const plan = decision.plan || config.findings.find((f) => f.key === decision.findings[0]).plan;
  const exclusion = plan === 'critter' ? pricing.exclusionFor(decision.findings, { techSaysNoExclusion: Boolean(decision.techSaysNoExclusion) }, config) : null;
  const price = pricing.priceFor(plan, post.plans, config, { exclusion: exclusion ?? true });
  const creditExpires = pricing.creditExpiry(today, config);
  const bonus = pricing.bonusFor(decision.findings, { visitCategory: post.visit?.category }, config);
  const visitDate = post.visit?.date || post.postDate;
  return {
    key: leadKey({ ...decision, plan }),
    plan,
    planName: price.planName,
    exclusion,
    price,
    initial: money(price.initial),
    monthly: money(price.monthly),
    regularInitial: money(price.regularInitial),
    credit: price.credit > 0 ? money(price.credit) : null,
    creditReason: { other_plan: `50% off with your ${post.plans.otherPlans[0] || 'current plan'}`, visit_credit: 'what you paid for your inspection visit', returning: 'returning-customer discount' }[price.tier],
    creditExpires: shortDate(creditExpires),
    creditExpiresLong: longDate(creditExpires),
    creditExpiresYmd: creditExpires,
    noAnnualInitial: money(price.noAnnualInitial),
    fixLine: `${money(price.initial)} to take care of it, then ${money(price.monthly)} a month on ${price.planName}.`,
    bonus: bonus.perPlan[plan] ?? 0,
    bonusMultiplier: bonus.multiplier,
    techName: post.tech?.name || 'your technician',
    visitDate,
    visitDay: DAY_NAMES[cal.weekdayOf(visitDate)],
    visitLong: longDate(visitDate),
    visitPhrase: post.visit?.category === '12501' ? 'your inspection' : 'your service',
    address: post.customer?.serviceAddress || '',
    street: post.customer?.street || post.customer?.serviceAddress || '',
    stampWhen: `${new Date(post.postedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}, ${post.postTime}`,
    customerName: [post.customer?.firstName, post.customer?.lastName].filter(Boolean).join(' '),
    video: config.plans[plan].video,
  };
}

// The text must quote the computed initial fee and no other price.
function checkTextPrice(body, model) {
  const amounts = [...String(body).matchAll(/\$\s?([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
  const allowed = new Set([model.price.initial, model.price.credit]);
  if (!amounts.includes(model.price.initial)) return `text.body must quote the initial fee ${model.initial}`;
  const bad = amounts.filter((a) => !allowed.has(a));
  return bad.length ? `text.body has a price that isn't this quote: ${bad.map(money).join(', ')}` : null;
}

// A weekday named in a message must be the visit day ("I did your service
// Thursday"). Catches the routine getting the day wrong.
function checkDayNames(texts, model) {
  for (const t of texts) {
    for (const m of String(t || '').matchAll(/\b(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\b/g)) {
      if (m[1] !== model.visitDay) return `a message says ${m[1]} but the visit was ${model.visitDay} ${model.visitLong}`;
    }
  }
  return null;
}

// "I didn't see any signs of A, B or C" from the tech's checked-ok list.
function checkedSentence(items, visitPhrase = 'the visit') {
  const list = (items || []).map((s) => String(s).trim()).filter(Boolean);
  if (!list.length) return null;
  const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} or ${list[list.length - 1]}` : list[0];
  return `During ${visitPhrase} I didn't see any signs of ${joined}.`;
}

module.exports = { ACTIONS, checkDecision, quoteModel, checkTextPrice, checkDayNames, checkedSentence, leadKey, money, longDate, shortDate };
