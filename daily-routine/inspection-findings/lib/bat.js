// Bat Remediation pricing (Daniel, Nov 11). One charge that covers the
// 1-year bat-free guarantee, no monthly fee. Pure functions, unit-tested.
//
//   base       1 story $1,100; 2+ stories $1,600
//   size       +$100 per full 500 sq ft over 1,500 (up to +$400)
//   activity   +$200 for live bats, major guano or nesting inside
//   access     +$200 for 3 stories, a steep or high roofline, a log home
//   kept between $1,000 and $2,500
//   credit     minus the consultation credit: $250 existing customer, $149 new
//   rounding   the customer's price is rounded down to end in 95
//              ($2,050 -> $1,995), and the credit is shown on top of it
//
// Daniel approves every bat quote before it goes out; he can change the
// price ("approve $1,795"), which replaces the formula's.

const money = (n) => `$${Number(n).toLocaleString('en-US')}`;

// "What the customer pays" rounded down to end in 95.
function endIn95(n) {
  const r = Math.floor((n - 95) / 100) * 100 + 95;
  return r > 0 ? r : n;
}

// inputs: { sqft, stories, heavyActivity, hardAccess, existingCustomer }
function batPrice(inputs, config, { approvedPrice = null } = {}) {
  const c = config.batRemediation;
  const stories = Number(inputs.stories) || 1;
  const sqft = Number(inputs.sqft) || 0;
  const steps = [];
  let price = stories >= 2 ? c.base.twoStory : c.base.oneStory;
  steps.push(`${stories >= 2 ? `${stories}-story` : '1-story'} base ${money(price)}`);
  if (sqft >= c.size.over + c.size.step) {
    const add = Math.min(c.size.max, Math.floor((sqft - c.size.over) / c.size.step) * c.size.add);
    price += add;
    steps.push(`${sqft.toLocaleString('en-US')} sq ft: +${money(add)}`);
  }
  if (inputs.heavyActivity) {
    price += c.heavyActivity;
    steps.push(`heavy activity: +${money(c.heavyActivity)}`);
  }
  if (inputs.hardAccess) {
    price += c.hardAccess;
    steps.push(`hard access: +${money(c.hardAccess)}`);
  }
  const formula = price;
  price = Math.max(c.min, Math.min(c.max, price));
  if (price !== formula) steps.push(`kept between ${money(c.min)} and ${money(c.max)}: ${money(price)}`);
  const credit = inputs.existingCustomer === false ? c.credit.new : c.credit.existing;
  const formulaFinal = endIn95(price - credit);
  steps.push(`${money(price)} - ${money(credit)} consultation credit = ${money(price - credit)}, rounded down to ${money(formulaFinal)}`);
  const final = approvedPrice != null ? Number(approvedPrice) : formulaFinal;
  if (approvedPrice != null && final !== formulaFinal) steps.push(`Daniel approved ${money(final)}`);
  return { formula: formulaFinal, final, credit, list: final + credit, steps, stories, sqft };
}

// The inputs a bat decision must carry (decisions.json "bat").
function checkBatInputs(bat) {
  const errs = [];
  if (!bat || typeof bat !== 'object') return ['a bat quote needs "bat": { sqft, sqftSource, stories, heavyActivity, hardAccess, exterior, attic, ... }'];
  if (!(Number(bat.sqft) > 0)) errs.push('bat.sqft: the home size (from a listing, or your estimate from the photos)');
  if (!bat.sqftSource) errs.push('bat.sqftSource: where the size came from ("Zillow listing", "estimate from photos")');
  if (![1, 2, 3].includes(Number(bat.stories))) errs.push('bat.stories: 1, 2 or 3');
  if (typeof bat.heavyActivity !== 'boolean') errs.push('bat.heavyActivity: true for live bats, major guano or nesting inside');
  if (typeof bat.hardAccess !== 'boolean') errs.push('bat.hardAccess: true for 3 stories, a steep or high roofline, a log home');
  if (!bat.exterior) errs.push('bat.exterior: the siding type from the photos');
  return errs;
}

module.exports = { batPrice, checkBatInputs, endIn95 };
