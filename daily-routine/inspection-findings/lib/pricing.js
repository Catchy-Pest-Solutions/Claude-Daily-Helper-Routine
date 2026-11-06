// Pricing, coverage and bonuses for the inspection findings routine
// (DESIGN.md "Pricing" and Daniel's Nov 6 answers). Pure functions: no API
// calls, so they're unit-tested in ../test.
//
// Price tiers, first match wins:
//   1. other_plan  - the customer has another active recurring plan
//                    (config.otherPlanCategories, CSC_ACTIVE): 50% off the
//                    initial fee (halves round up), discounted monthly.
//   2. visit_credit - the customer's only services were Inspection (12501)
//                    and/or One Time Service (12504): regular initial minus
//                    everything they paid for those visits, regular monthly.
//   3. returning   - anyone else (a completed plan, nothing active): 10% off
//                    the initial fee (price rounds up), regular monthly.
// No-annual-commitment version: $50 more on the initial fee, same monthly.
// The discount is always shown as a dollar credit good for 90 days.
const cal = require('../../src/callReview/calendar');

const ACTIVE = 'CSC_ACTIVE';
const DEAD = new Set(['CSC_SCRATCH', 'CSC_CANCELLED', 'CSC_CANCELED']);
const trimCat = (s) => String(s?.serviceCategoryId ?? '').trim();

function planOfCategory(categoryId, config) {
  for (const [key, plan] of Object.entries(config.plans)) if (plan.categories.includes(categoryId)) return key;
  return null;
}

// Services from every Briostack record the customer has (same address or
// another property). Each service gets customerId so the summary can say where.
function analyzeServices(services, config, { todayDate } = {}) {
  const live = services.filter((s) => !DEAD.has(s.statusId));
  const active = live.filter((s) => s.statusId === ACTIVE);
  const catchyClub = active.some((s) => config.catchyClubCategories.includes(trimCat(s)));
  const commercial = active.some((s) => config.commercialCategories.includes(trimCat(s)));
  const covered = {};
  for (const s of active) {
    const p = planOfCategory(trimCat(s), config);
    if (p) covered[p] = String(s.serviceCategoryName || '').trim();
  }
  if (catchyClub) for (const k of Object.keys(config.plans)) covered[k] = covered[k] || 'Catchy Club';
  const otherPlans = active.filter((s) => config.otherPlanCategories.includes(trimCat(s)));

  // Inspection / one-time visits paid (not scratched).
  const inspections = live.filter((s) => config.inspectionCategories.includes(trimCat(s)));
  const nonInspection = live.filter((s) => !config.inspectionCategories.includes(trimCat(s)));
  let recentInspections = inspections;
  if (todayDate && config.visitCreditLookbackDays) {
    const cutoff = cal.addDays(todayDate, -config.visitCreditLookbackDays);
    recentInspections = inspections.filter((s) => !s.lastAppointmentDate || s.lastAppointmentDate >= cutoff);
  }
  const visitPaid = recentInspections.reduce((sum, s) => sum + (Number(s.initialAmount) || 0), 0);

  return {
    active: active.map((s) => ({ customerId: s.customerId, category: trimCat(s), name: String(s.serviceCategoryName || '').trim(), monthly: s.regularAmount })),
    catchyClub,
    commercialPlan: commercial,
    covered, // plan key -> the active service that already covers it
    otherPlans: otherPlans.map((s) => String(s.serviceCategoryName || '').trim()),
    inspectionOnly: inspections.length > 0 && nonInspection.length === 0,
    visitPaid,
    visitServices: recentInspections.map((s) => ({ name: String(s.serviceCategoryName || '').trim(), paid: Number(s.initialAmount) || 0, date: s.lastAppointmentDate || null, status: s.statusId })),
  };
}

// The quote for one plan. exclusion only matters for critter.
function priceFor(planKey, analysis, config, { exclusion = true } = {}) {
  const plan = config.plans[planKey];
  if (!plan) throw new Error(`unknown plan ${planKey}`);
  const base = planKey === 'critter' && !exclusion ? plan.prices.noExclusion : plan.prices.standard;
  const regular = { initial: base.initial, monthly: base.monthly };
  let tier;
  let initial;
  let monthly = regular.monthly;
  let reason;
  if (analysis.otherPlans.length) {
    tier = 'other_plan';
    initial = Math.ceil(regular.initial / 2);
    monthly = plan.prices.withOtherPlan?.monthly ?? regular.monthly;
    reason = `50% off because they already have ${analysis.otherPlans[0]}`;
  } else if (analysis.inspectionOnly && analysis.visitPaid > 0) {
    tier = 'visit_credit';
    initial = Math.max(0, regular.initial - analysis.visitPaid);
    reason = `credit for the $${analysis.visitPaid} they paid for their inspection / one-time visit`;
  } else {
    tier = 'returning';
    initial = Math.ceil((regular.initial * (100 - config.returningDiscountPercent)) / 100);
    reason = `${config.returningDiscountPercent}% returning-customer discount on the initial fee`;
  }
  return {
    plan: planKey,
    planName: plan.name,
    exclusion: planKey === 'critter' ? Boolean(exclusion) : null,
    tier,
    reason,
    regularInitial: regular.initial,
    regularMonthly: regular.monthly,
    initial,
    monthly,
    credit: regular.initial - initial,
    noAnnualInitial: initial + config.noAnnualExtra,
  };
}

// Every plan, both critter variants: what collect.js hands the routine.
function allPrices(analysis, config) {
  const out = {};
  for (const key of Object.keys(config.plans)) {
    out[key] = priceFor(key, analysis, config);
    if (key === 'critter') out.critter_no_exclusion = priceFor(key, analysis, config, { exclusion: false });
  }
  return out;
}

// Rodent signs inside the home, crawl space or attic: exclusion unless the
// tech says it isn't needed ("no entry points" counts). Yard burrows: never.
function exclusionFor(findingKeys, { techSaysNoExclusion = false } = {}, config) {
  const defs = findingKeys.map((k) => config.findings.find((f) => f.key === k)).filter((f) => f && f.plan === 'critter');
  if (!defs.length) return null;
  if (findingKeys.includes('exclusion_needed')) return true;
  if (defs.every((f) => f.exclusionDefault === false)) return false;
  return !techSaysNoExclusion;
}

// One lead per customer per plan, paid at the highest finding's bonus;
// 1.5x when the visit was an Inspection or One Time Service.
function bonusFor(findingKeys, { visitCategory } = {}, config) {
  const byPlan = {};
  for (const k of findingKeys) {
    const f = config.findings.find((x) => x.key === k);
    if (!f) throw new Error(`unknown finding ${k}`);
    const p = f.plan || 'quote_request';
    byPlan[p] = Math.max(byPlan[p] ?? 0, f.bonus);
  }
  const mult = config.inspectionCategories.includes(String(visitCategory || '')) ? config.bonusMultiplierInspection : 1;
  const perPlan = Object.fromEntries(Object.entries(byPlan).map(([p, b]) => [p, Math.round(b * mult * 100) / 100]));
  return { perPlan, multiplier: mult, total: Object.values(perPlan).reduce((a, b) => a + b, 0) };
}

// "Feb 4" style expiry, creditDays after the quote date (YYYY-MM-DD).
function creditExpiry(quoteDate, config) {
  return cal.addDays(quoteDate, config.creditDays);
}

module.exports = { analyzeServices, priceFor, allPrices, exclusionFor, bonusFor, creditExpiry, planOfCategory };
