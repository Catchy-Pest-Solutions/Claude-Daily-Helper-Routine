// Turns one routine decision (decisions.json) plus the collected post
// (posts.json) into the numbers and words render.js and send.js use. Prices
// always come from pricing.js here, never from the decision, so a typo in a
// message can't change what the customer is quoted: the message is checked
// against the computed price instead.
const pricing = require('./pricing');
const bat = require('./bat');
const cal = require('../../src/callReview/calendar');

const ACTIONS = ['quote', 'commercial', 'custom_quote', 'quote_request', 'skip', 'ask'];
const money = (n) => `$${Number(n).toLocaleString('en-US')}`;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const longDate = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
const shortDate = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

// "Mon, Nov 9, 2026, 11:55 AM": the Slack post time stamped on its photos.
const stampWhen = (post) => `${new Date(post.postedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}, ${post.postTime}`;

// Every finding on a quote: its own post's plus any other posts merged into
// it (alsoPosts: same customer, same plan, one quote).
const allFindings = (d) => [...new Set([...(d.findings || []), ...(d.alsoPosts || []).flatMap((a) => a.findings || [])])];

const isQuoteRequest = (d) => d.action === 'quote' && (d.findings || []).length === 1 && d.findings[0] === 'quote_request';

function leadKey(decision) {
  return decision.plan ? `${decision.ts}:${decision.plan}` : String(decision.ts);
}

// Problems with a decision; empty when it can go ahead.
// allPosts (every collected post) is needed to check alsoPosts.
function checkDecision(decision, post, config, allPosts = [], { secondary = false } = {}) {
  const errs = [];
  if (!ACTIONS.includes(decision.action)) errs.push(`action must be one of ${ACTIONS.join(', ')}`);
  if (!post) return [`no collected post with ts ${decision.ts}`];
  const findings = allFindings(decision);
  for (const a of decision.alsoPosts || []) {
    const other = allPosts.find((p) => p.ts === a.ts);
    if (!['quote', 'commercial', 'custom_quote'].includes(decision.action)) errs.push('alsoPosts only goes on a quote, commercial or custom_quote decision');
    else if (!other) errs.push(`alsoPosts: no collected post with ts ${a.ts}`);
    else if (a.ts === decision.ts) errs.push('alsoPosts lists the decision\'s own post');
    else if (String(other.customer?.id) !== String(post.customer?.id)) errs.push(`alsoPosts ${a.ts} is a different customer`);
    else if (!(a.findings || []).length || a.findings.includes('quote_request')) errs.push(`alsoPosts ${a.ts} needs its findings`);
    else if (!other.photos?.length) errs.push(`alsoPosts ${a.ts} has no photos`);
  }
  for (const k of findings) if (!config.findings.some((f) => f.key === k)) errs.push(`unknown finding "${k}"`);
  if (['skip', 'ask'].includes(decision.action)) {
    if (!String(decision.techMessage || '').trim()) errs.push(`${decision.action} needs techMessage (the note to the tech)`);
    return errs;
  }
  if (decision.action === 'quote_request') return errs;
  if (!findings.length) errs.push('needs findings');
  // A quote request ("Quote request", nothing to photograph) for one of our
  // plans is quoted like a finding, without photos: findings
  // ["quote_request"] plus the plan the customer asked about.
  const request = isQuoteRequest(decision);
  if (request && !config.plans[decision.plan]) errs.push(`a quote request needs plan: one of ${Object.keys(config.plans).join(', ')} (anything else: action "quote_request", a task for the office)`);
  const plans = request ? [decision.plan] : [...new Set(findings.map((k) => config.findings.find((f) => f.key === k)?.plan).filter(Boolean))];
  if (plans.length !== 1) errs.push(`findings must all point at one plan (got ${plans.join(', ') || 'none'}); write one decision per plan`);
  if (decision.plan && plans[0] && decision.plan !== plans[0]) errs.push(`plan "${decision.plan}" doesn't match the findings (${plans[0]})`);
  // A task for the office to price, nothing to the customer: a business,
  // or a custom job (bats) on a customer who already has the plan.
  if (['commercial', 'custom_quote'].includes(decision.action)) return errs;

  // Hard stops the routine should already have caught.
  const plan = decision.plan || plans[0];
  if (plan === 'bat') {
    errs.push(...bat.checkBatInputs(decision.bat));
    if (decision.bat?.approved) {
      const ok = batApproval(post);
      if (!ok) errs.push('bat.approved: Daniel hasn\'t replied "approve" in the post\'s thread yet (leave approved off: it goes to him as a draft)');
      else if (ok.price != null && Number(decision.bat.approvedPrice) !== ok.price) errs.push(`bat.approvedPrice must be the $${ok.price} Daniel approved`);
      else if (ok.price == null && decision.bat.approvedPrice != null) errs.push('Daniel approved without a price: leave bat.approvedPrice off (the formula price goes out)');
    } else if (decision.bat?.approvedPrice != null) errs.push('bat.approvedPrice only goes with bat.approved');
  }
  if (post.checks?.catchyClub) errs.push('Catchy Club customer: skip');
  if (post.checks?.covered?.[plan]) errs.push(`already covered by ${post.checks.covered[plan]}: skip`);
  if ((post.checks?.priorOfferPlans || []).includes(plan) && !decision.allowRepeat) errs.push(`${plan} was already quoted and the offer is still open: skip`);
  if (post.checks?.commercial) errs.push('business: use action "commercial"');
  if (!post.visit) errs.push('no matching visit');
  if (!post.photos?.length && !request) errs.push('no photos');

  const t = String(decision.text?.body || '');
  if (!secondary && !t.trim()) errs.push('needs text.body');
  if (secondary && t.trim()) errs.push("this customer's first quote decision has the one text for all their quotes: leave text.body off this one");
  if (!String(decision.headline || '').trim()) errs.push('needs headline (the problem, for the card)');
  if (String(decision.headline || '').length > 70) errs.push('headline is over 70 characters');
  if (!secondary && !(decision.email?.intro || []).length) errs.push('needs email.intro paragraphs');
  if (secondary && !(decision.email?.body || []).length) errs.push("needs email.body (this quote's part of the customer's one email)");
  if (!(decision.found || []).length) errs.push('needs found (what was found and where, for the PDF)');
  for (const [label, s] of [['text.body', t], ['email', JSON.stringify(decision.email || {})], ['found', JSON.stringify(decision.found || [])]]) {
    if (/\b(AI|artificial intelligence|ChatGPT|Claude|automated)\b/.test(s)) errs.push(`${label} mentions AI/automation`);
  }
  if (/12[- ]month|annual|contract/i.test(t)) errs.push("text.body mustn't mention the 12-month plan (it's in the picture)");
  if (!secondary && !/reply yes/i.test(t)) errs.push('text.body should end with the "Reply YES" close');
  // Techs who don't want their name on customer messages (signMessages
  // false in config.technicians): everything comes from Catchy Pest.
  const first = post.tech?.name;
  if (post.tech?.signMessages === false && first) {
    const words = [t, JSON.stringify(decision.email || {}), decision.headline || ''].join(' ');
    if (new RegExp(`\\b${first}\\b`, 'i').test(words)) errs.push(`${first} doesn't sign customer messages: write them from Catchy Pest Solutions without his name`);
  }
  return errs;
}

// A post merged into another post's quote (alsoPosts) can't get its own
// decision for that plan, and can only be merged once.
function checkMerges(decision, decisions, config) {
  const errs = [];
  const planOf = (d) => d.plan || config.findings.find((f) => f.key === (d.findings || [])[0])?.plan || null;
  for (const a of decision.alsoPosts || []) {
    if (decisions.some((d) => d !== decision && d.ts === a.ts && ['quote', 'commercial', 'custom_quote'].includes(d.action) && planOf(d) === planOf(decision))) errs.push(`post ${a.ts} is merged into this quote, so it can't have its own ${planOf(decision)} decision`);
    if (decisions.some((d) => d !== decision && (d.alsoPosts || []).some((x) => x.ts === a.ts) && planOf(d) === planOf(decision))) errs.push(`post ${a.ts} is merged into two quotes`);
  }
  return errs;
}

// One text and one email per customer (Daniel, Nov 11): a customer's quote
// decisions in one run go out together. The first one (in decisions.json
// order) is the primary: its text.body covers every quote, its email.intro
// and email.closing wrap the email; every quote adds its own section
// (headline, photos, email.body, why, the fix box). Returns lead key ->
// { primary, group: [decisions] } for every quote decision.
// A bat quote Daniel hasn't approved yet: rendered and sent to him only.
const isBatDraft = (d) => d.action === 'quote' && d.plan === 'bat' && !d.bat?.approved;

function customerGroups(decisions, posts) {
  const byCustomer = new Map();
  for (const d of decisions.filter((x) => x.action === 'quote' && !isBatDraft(x))) {
    const post = posts.find((p) => p.ts === d.ts);
    const id = String(post?.customer?.id || d.ts);
    if (!byCustomer.has(id)) byCustomer.set(id, []);
    byCustomer.get(id).push(d);
  }
  const out = new Map();
  for (const group of byCustomer.values()) group.forEach((d, i) => out.set(leadKey(d), { primary: i === 0, group }));
  return out;
}

// The customer's one text must quote every initial fee in the group (and
// no other price), say what each covers in the fixed words, and mention
// the email when there is one.
function checkGroupText(body, models, { hasEmail }) {
  const errs = [];
  const amounts = [...String(body).matchAll(/\$\s?([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
  const allowed = new Set(models.flatMap((m) => [m.price.initial, m.price.credit]));
  for (const m of models) {
    if (!amounts.includes(m.price.initial)) errs.push(`text.body must quote the ${m.planName} initial fee ${m.initial}`);
    const c = checkTextCovers(body, m);
    if (c) errs.push(models.length > 1 ? `${c} (${m.planName})` : c);
  }
  const bad = amounts.filter((a) => !allowed.has(a));
  if (bad.length) errs.push(`text.body has a price that isn't this quote: ${bad.map(money).join(', ')}`);
  const mentions = /\be-?mail/i.test(body);
  if (hasEmail && !mentions) errs.push('text.body should say we emailed them too ("I also emailed you the photos and details.")');
  if (!hasEmail && mentions) errs.push("text.body mentions an email, but there's no email address on file");
  return errs;
}

// Every check on the words of a quote decision that depends on its
// customer group: the one text (on the primary) and the day names.
function checkQuoteMessages(decision, post, config, decisions, posts, { today }) {
  const info = customerGroups(decisions, posts).get(leadKey(decision)) || { primary: true, group: [decision] };
  const model = quoteModel(decision, post, config, { today });
  const errs = [];
  if (info.primary) {
    const models = info.group.map((d) => quoteModel(d, posts.find((p) => p.ts === d.ts), config, { today }));
    errs.push(...checkGroupText(decision.text.body, models, { hasEmail: Boolean(post.customer?.email) }));
  }
  const dayErr = checkDayNames([decision.text?.body, ...(decision.email?.intro || []), ...(decision.email?.body || []), ...(decision.email?.closing || [])], model);
  if (dayErr) errs.push(dayErr);
  return errs;
}

// What the initial fee covers (config.priceCovers), for this plan, these
// findings and with/without exclusion. Items for the tech's findings go to
// the top; the list always ends with the monthly fee.
function priceCovers(plan, findings, exclusion, monthly, config) {
  const def = config.priceCovers?.[plan];
  if (!def) throw new Error(`config.priceCovers has no "${plan}"`);
  const has = (keys) => (keys || []).some((k) => findings.includes(k));
  const applies = (item) => (!item.findings || has(item.findings)) && (item.exclusion === undefined || item.exclusion === Boolean(exclusion));
  const top = (item) => Boolean(item.findings || has(item.topFor));
  const sorted = (items) => {
    const list = (items || []).filter(applies);
    return [...list.filter(top), ...list.filter((i) => !top(i))];
  };
  const pick = (items) => sorted(items).map((i) => i.text);
  const pieces = pick(def.text);
  if (!pieces.length) throw new Error(`config.priceCovers.${plan}.text has nothing for ${findings.join(', ')}`);
  const text = pieces.length > 1 ? `${pieces.slice(0, -1).join(', ')} and ${pieces[pieces.length - 1]}` : pieces[0];
  // The tech's specific concern (a finding's own line) shows in bold.
  const items = sorted(def.lines).map((i) => ({ text: i.text, top: top(i) && !findings.includes('quote_request') }));
  return { lines: items.map((i) => i.text), items, monthlyLine: `Then ${monthly} a month, starting month 4`, text, details: pick(def.details), finePrint: def.finePrint || [] };
}

// Everything the templates and messages need for a quote decision.
function quoteModel(decision, post, config, { today }) {
  const request = isQuoteRequest(decision);
  const findings = allFindings(decision);
  const plan = decision.plan || config.findings.find((f) => f.key === findings[0]).plan;
  const exclusion = plan !== 'critter' ? null : request ? !decision.techSaysNoExclusion : pricing.exclusionFor(findings, { techSaysNoExclusion: Boolean(decision.techSaysNoExclusion) }, config);
  const isBat = plan === 'bat';
  const batQuote = isBat ? bat.batPrice({ ...(decision.bat || {}), existingCustomer: isExistingCustomer(post) }, config, { approvedPrice: decision.bat?.approved ? decision.bat.approvedPrice ?? null : null }) : null;
  const price = isBat ? batPriceObject(batQuote, config) : pricing.priceFor(plan, post.plans, config, { exclusion: exclusion ?? true });
  const creditExpires = pricing.creditExpiry(today, config);
  const bonus = pricing.bonusFor(decision.findings, { visitCategory: post.visit?.category }, config);
  const visitDate = post.visit?.date || post.postDate;
  const covers = priceCovers(plan, findings, exclusion, money(price.monthly), config);
  return {
    key: leadKey({ ...decision, plan }),
    request,
    plan,
    planName: price.planName,
    exclusion,
    price,
    initial: money(price.initial),
    monthly: money(price.monthly),
    regularInitial: money(price.regularInitial),
    credit: price.credit > 0 ? money(price.credit) : null,
    // Bat Remediation: one charge, no monthly fee, a consultation credit.
    recurring: !isBat,
    bat: batQuote,
    batDraft: isBat && !decision.bat?.approved,
    creditLabel: isBat ? 'consultation credit' : 'credit',
    planLine: isBat ? `${price.planName}: one charge, no monthly fee` : `${price.planName}, 12-month plan`,
    detailsLine: isBat
      ? `Details: ${price.planName}, one charge due when the initial installation and exclusion are done, no monthly fee. The full quote and agreement are attached as a PDF.`
      : `Details: ${price.planName}, 12-month plan, billed every 4 weeks. No annual commitment: ${money(price.noAnnualInitial)} initial, same monthly fee. The full quote is attached as a PDF.`,
    creditReason: isBat ? 'your consultation credit' : { other_plan: `50% off with your ${post.plans.otherPlans[0] || 'current plan'}`, visit_credit: 'what you paid for your inspection visit', returning: 'returning-customer discount' }[price.tier],
    creditReasonOffice: isBat ? `${isExistingCustomer(post) ? 'existing-customer' : 'new-customer'} consultation credit` : { other_plan: `50% off because they have ${post.plans.otherPlans[0] || 'another plan'}`, visit_credit: 'what they paid for their inspection visits', returning: '10% returning-customer discount' }[price.tier],
    creditExpires: shortDate(creditExpires),
    creditExpiresLong: longDate(creditExpires),
    creditExpiresYmd: creditExpires,
    noAnnualInitial: money(price.noAnnualInitial),
    fixLine: isBat ? `${money(price.initial)} covers ${covers.text}. One charge, no monthly fee.` : `${money(price.initial)} covers ${covers.text}. Then ${money(price.monthly)} a month, starting month 4, on ${price.planName}.`,
    bonus: request ? bonus.perPlan.quote_request ?? 0 : bonus.perPlan[plan] ?? 0,
    bonusMultiplier: bonus.multiplier,
    // Unsigned techs (signMessages false): "our technician", "What we found".
    signed: post.tech?.signMessages !== false,
    techName: post.tech?.signMessages === false ? 'our technician' : post.tech?.name || 'your technician',
    foundBy: post.tech?.signMessages === false ? 'What we found' : `What ${post.tech?.name || 'your technician'} found`,
    visitDate,
    visitDay: DAY_NAMES[cal.weekdayOf(visitDate)],
    visitLong: longDate(visitDate),
    visitPhrase: post.visit?.category === '12501' ? 'your inspection' : 'your service',
    address: post.customer?.serviceAddress || '',
    street: post.customer?.street || post.customer?.serviceAddress || '',
    stampWhen: stampWhen(post),
    customerName: [post.customer?.firstName, post.customer?.lastName].filter(Boolean).join(' '),
    video: config.plans[plan]?.video || null,
    coversLines: covers.lines,
    coversItems: covers.items,
    monthlyLine: isBat ? '' : covers.monthlyLine,
    coversText: covers.text,
    coversDetails: covers.details,
    finePrint: covers.finePrint,
  };
}

// A customer with any active service (bats are found on service visits,
// so nearly always) gets the $250 consultation credit; new ones $149.
function isExistingCustomer(post) {
  return post.customer?.status === 'CUSTOMER_ACTIVE' || (post.plans?.active || []).length > 0;
}

// A bat quote in the shape pricing.priceFor returns, so the templates and
// checks treat it like any other quote.
function batPriceObject(q, config) {
  return { plan: 'bat', planName: config.batRemediation.name, exclusion: null, tier: 'consult_credit', reason: `${money(q.credit)} consultation credit`, regularInitial: q.list, regularMonthly: 0, initial: q.final, monthly: 0, credit: q.credit, noAnnualInitial: q.final };
}

// Daniel's approval of a bat draft: his latest reply in the post's thread
// that says "approve" (and the price, when he changed it).
function batApproval(post) {
  // Only a reply that starts with "approve": the routine's own posts in
  // the thread come from Daniel's account too (the draft says "Reply approve").
  const replies = (post.thread || []).filter((r) => r.fromDaniel && /^\s*\**approved?\b/i.test(r.text || ''));
  const last = replies[replies.length - 1];
  if (!last) return null;
  const m = /\$\s?([\d,]+)/.exec(last.text);
  return { ts: last.ts, price: m ? Number(m[1].replace(/,/g, '')) : null, text: last.text };
}

// The text must quote the computed initial fee and no other price.
function checkTextPrice(body, model) {
  const amounts = [...String(body).matchAll(/\$\s?([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, '')));
  const allowed = new Set([model.price.initial, model.price.credit]);
  if (!amounts.includes(model.price.initial)) return `text.body must quote the initial fee ${model.initial}`;
  const bad = amounts.filter((a) => !allowed.has(a));
  return bad.length ? `text.body has a price that isn't this quote: ${bad.map(money).join(', ')}` : null;
}

// The text must say what the price covers, in the fixed words from
// config.priceCovers ("$174, which covers <coversText>").
function checkTextCovers(body, model) {
  const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9$]+/g, ' ').trim();
  return norm(body).includes(norm(model.coversText)) ? null : `text.body must say what the price covers, in these words: "which covers ${model.coversText}"`;
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

module.exports = { isBatDraft, batApproval, isExistingCustomer, customerGroups, checkGroupText, checkQuoteMessages, allFindings, stampWhen, checkMerges, isQuoteRequest, ACTIONS, checkDecision, quoteModel, priceCovers, checkTextPrice, checkTextCovers, checkDayNames, checkedSentence, leadKey, money, longDate, shortDate };
