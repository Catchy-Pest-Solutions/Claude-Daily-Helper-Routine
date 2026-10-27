# CATCHY PEST SOLUTIONS
## MASTER AI KNOWLEDGE BASE — SERVICES, PRICING & SALES FOLLOW-UP

**Version:** October 21, 2026  
**Audience:** Internal AI automation preparing personalized SMS/email follow-ups for NEW CUSTOMERS after their first call: booked customers get a short confirmation, unbooked leads get a sales follow-up. **Section 0 (Owner overrides) wins over everything else in this document.**  
**Use:** A factual reference, not a substitute for the lead's actual phone transcript, Briostack status, or confirmed service terms.

---

# 0. OWNER OVERRIDES — October 21, 2026 (these win over anything below)

1. **Who gets messages.** Every new customer whose call can be matched gets one text and one email. **Booked:** a short personal confirmation only (no discount, no quote, no sales pitch). **Unbooked:** the sales follow-up described in this guide and in PLAYBOOK.md.
2. **Who it's from.** Messages are signed by the office person who took the call (Steve, Shelley or Daniel), from Catchy Pest Solutions. That person really did speak with the customer, so "thanks for calling" and "great talking with you" are fine. Never claim anyone inspected the home unless the call says so. Never mention AI, transcripts or recordings. Never call Daniel the owner.
3. **Discounts.** The $50 annual discount is already built into the 12-month price ($347 vs $397 etc.). It is NOT an extra offer. The only extra discount: **10% off**, offered to unbooked customers by default (owner's call: give it more times than not), unless the rep already gave a discount on the call. It can apply to any option (annual, no-contract, one-time). Give the reason as a plain, personal statement that we have a technician in their neighborhood on the days being offered, e.g. "I've actually got a tech just down the road from you Thursday and Friday" (owner-approved blanket statement, Oct 27, 2026: technicians cover every service area nearly every weekday, see 0.8). A seasonal (fall/winter/spring/summer) discount also works. **One discount per customer, never stacked, never for booked customers, never on top of a discount the rep already gave on the call.**
4. **Whole dollars only.** Round every price to whole dollars (10% off $347 = $312; 10% off $247 = $222; 10% off $647 = $582).
5. **Nothing else is offered.** No waived initial fees, no payment plans, no free add-ons. (A free pest inspection during a paid visit exists but is not mentioned.)
6. **Guarantees.** Satisfaction guarantee (recurring plans): free return visits between scheduled services as needed until the pest is handled. **Money-back guarantee: annual plans only.** If the pest the customer called about isn't successfully removed after the first three months of service, they're eligible for a partial or full refund, pending manager approval. Never promise an automatic or full refund. One Time Service has no warranty. Warranties stay active through ongoing preventive treatments.
7. **Cancellation for new customers.** No cancellation fees of any kind (including the $75 24-hour fee and the annual-plan cancellation fee) if a new customer changes their mind **before their first service**. Present it as company policy; don't cite laws.
8. **Scheduling.** Six technicians cover all service areas nearly every weekday. It's fine to offer two specific upcoming business days as a choice ("tomorrow or Thursday?"); the office confirms the time. Never name a specific time, time slot or technician.
9. **Critter Control initial phase.** Daily visits for 7 business days (about 1.5 weeks), adjusted to the pest issue or the customer's schedule, then a two-week follow-up. Traps and stations are checked, cleaned, reset and reported every visit.
10. **Product wording.** Say "eco-friendly options" or "plant-based options" and "kids and pets can go back in once it's dry." Never say safe, non-toxic, harmless, chemical-free or all-natural.
11. **Maintenance framing.** Keep maintenance visits low-key: pest removal usually takes a few visits, and preventive treatments keep the warranty active. Don't imply maintenance visits are a burden or strictly required.
12. **Home size.** Square footage is not in Briostack. Assume a small-to-medium home unless the call says otherwise: TermiteShield uses the 1,200–3,000 sq. ft. tier ($797 / $847); Catchy Club uses its standard price ($997 / $1,047). If the call says the home is under 1,200 sq. ft., use that tier; if over 5,000 (termite) or outside 1,000–4,000 (Catchy Club), it's a custom quote.
13. **Mosquito-only leads.** The stand-alone mosquito grid is for the 2027 season only. Until that season, don't quote a mosquito-only price; treat it as a custom quote.
14. **Uncertain or conflicting cases.** Wherever this guide says "route for review", "flag a human" or "confirm with the office", the routine messages Daniel on Slack and does not send.
15. **Other facts you can use:** technicians wear shoe covers inside; Signature exterior includes foundation treatment, granulars, crack-and-crevice treatment, web removal and wasp/hornet/yellow jacket nest removal; Critter Control includes exclusion when needed (yard jobs like moles, voles, groundhogs and chipmunks usually don't need it); 1,000+ Google reviews rated 4.9–5.0 across our locations.
16. **Billing wording (Oct 27, 2026).** To customers, describe the ongoing charge as monthly: "then $49 a month." Billing runs every 4 weeks under the terms and conditions, and "monthly" is the accurate, simpler description. Don't write "every 4 weeks" or "every 28 days" in texts, emails, quote cards or PDFs. This replaces the "never say monthly" rules in Sections 1, 2, 16 and 18.
17. **Signature coverage wording (Oct 27, 2026).** HomeShield Signature covers **and treats** 30+ pests as part of every visit (ants, spiders, roaches, carpenter bees, carpenter ants, stink bugs, fleas, ticks and more). Say it as included and treated, never as something the customer has to ask for ("if you need us to").

---

# 1. PURPOSE AND RULES FOR THE FOLLOW-UP AI

This document is designed for an automated workflow that (1) receives a new customer/lead event from Briostack, (2) finds the associated phone call and transcript using the customer's phone number, and (3) prepares a personalized follow-up text or email intended to help the prospect book appropriate Catchy Pest Solutions service.

## 1.1 Required decision process

1. **Verify the lead did not already book.** A new Briostack record alone does NOT mean a prospect is unbooked. Consult available booking/status data and the call transcript. Do not send a booking-oriented follow-up if service is already booked, if the customer opted out, or if their status is uncertain; route uncertain cases for review.
2. **Use the actual conversation.** Identify the customer's first name (only if confidently known), pest(s), property/situation, concerns, objection to booking (price, commitment, needing to ask spouse, timing, uncertainty, etc.), quoted prices, and promises explicitly made by the agent. Never invent transcript details.
3. **Match the right program.** Prioritize what the customer actually asked about. Offer appropriate solutions, including no-annual-commitment pricing when a contract is the objection. A simple or isolated issue can qualify for a One Time Service; more complex or recurring issues usually benefit from a protection plan.
4. **Use the pricing rules below.** The initial fee covers the first three months for the four main programs. The ongoing charge starts in month four and occurs **every 4 weeks (28 days)**, NOT once per calendar month.
5. **Make the message personal, relevant, and useful.** Refer to the caller's concern and one or two applicable benefits; mention pricing only when relevant. Ask a low-friction question inviting them to get scheduled or reply with questions.
6. **Do not invent commitments.** No fabricated appointment slots, technician availability, discounts, coupon deadlines, fixed bat/commercial quotes, guaranteed removal dates, unconditional cash refunds, or promises of legal/code compliance.
7. **Respect communication preferences.** Do not message people who opted out or where required permission is absent. Avoid repeated pressure, and respect any request not to be contacted.
8. **If the transcript and this guide conflict, or the lead received a specific written quote, do not silently replace it.** Respect confirmed individualized quotes when validated; otherwise flag a human to review before sending a contradictory price.

## 1.2 Messaging style

- **SMS:** Usually 2–4 natural sentences, ideally about 40–100 words. Warm, direct, helpful; not scripted or overly salesy. Personalized first sentence; one clear call to action at the end.
- **Email:** Short subject line, brief recap, clear service benefits and the relevant price/term if needed, one call to action. No lengthy catalog unless the customer requested a comparison.
- Speak as the office person who took the call, from **Catchy Pest Solutions** (see Section 0.2). Do not claim anyone inspected the home unless the call says so.
- Do not automatically offer every possible tier. Address the specific hesitation that kept the customer from booking.
- Avoid empty urgency such as “offer ends today” or “only one appointment left,” unless verified independently.
- If dates, exact eligibility, service scope, or final price require inspection, make that clear rather than guessing.

## 1.3 Quick positioning: what to offer

- **Ants, spiders, wasps, carpenter bees/ants, fleas, ticks, roaches, and other common insects:** HomeShield Signature Pest; eligible isolated situations can use the $247 One Time Service.
- **Mice, rats, moles, voles, squirrels, other rodents/wildlife:** HomeShield Critter Control; ask whether entry-point sealing/exclusion is necessary. **Bats require their own inspection and custom remediation quote.**
- **Termites / termite prevention:** Carolina TermiteShield. **Do not suggest the $247 One Time Service for termites.**
- **Bed bugs:** Bed Bug Treatment, starting at $889; never direct to the $247 One Time Service.
- **Broad year-round protection, multiple pest concerns, premium coverage:** Catchy Club, which ALSO includes seasonal mosquitoes.
- **Seasonal mosquito/yard treatment only:** Prepaid mosquito-only seasonal package (2027 price grid below). Per-treatment add-on pricing is ONLY for customers already on another regular recurring plan.
- **Unidentified pest or diagnostic/complex issues:** $149 on-site Inspection/Consultation; credit applies to qualifying service completed within 90 days.
- **Home sale/transaction needing a wood-destroying insect report:** WDIR ($275 standard).
- **Businesses/commercial buildings:** Gather qualifying details; commercial team provides a custom quote, not a standard residential price.

---

# 2. UNIVERSAL RULES FOR THE FOUR CORE PLANS

The four main programs are: **HomeShield Signature Pest Control, HomeShield Critter Control, Carolina TermiteShield, and Catchy Club.**

**Initial three months:** The initial package price covers the first three months of treatments and plan coverage. No additional regular every-4-week maintenance charges during those three months.

**After month three:** Regular recurring charges begin in **month four**, billed **every 28 days**. Billing frequency is separate from technician visit frequency. To customers, call it monthly ("$49 a month", Section 0.16).

**Two ways to purchase the initial package:**
- **12-month agreement:** $50 less on the initial service fee. The $50 initial discount is available **year-round**; it is not a seasonal or limited-time deal.
- **No annual commitment:** Pay **$50 more** for the same initial three-month package. This is sometimes called the “three-month/no-contract option.” **Ongoing maintenance still starts in month four, but the customer is not locked into a 12-month contract.** It does not automatically terminate after three months; customer can cancel in accordance with applicable terms.

**Cancellation of discounted 12-month plan:** If a customer accepted the $50 annual-plan discount and cancels during the first 12 months, the policy is **$50 plus any applicable fees due within the next 30 days**, subject to the service agreement. Do NOT apply this 12-month cancellation policy to a no-annual-commitment purchase. Do not proactively foreground cancellation penalties in a sales follow-up unless the question arises. Specific account exceptions/terms go to the office.

**General guarantees:** Recurring programs may be promoted with Catchy's **satisfaction guarantee** and **money-back guarantee**, as well as complimentary retreatments when applicable. However, detailed refund triggers, coverage eligibility, limits, and damage-warranty terms are not defined here: **never claim an unconditional refund or a specific payout amount.** Direct precise warranty claims to the office/written service terms.

**Annual prepayment option:** After the initial fee is paid, qualifying customers can choose the annual prepayment prices listed for each main plan below. These amounts are **actual prepaid prices**, NOT amounts deducted from another fee. Do not add the annual prepay price to every-four-week charges for the same prepaid period. Do not claim they include the initial three-month fee.

---

# 3. HOMESHIELD — SIGNATURE PEST CONTROL

## What it is
Catchy's comprehensive residential general-pest program: active pest elimination followed by preventive interior/exterior treatment customized to the home and season. Position it as more than a one-time spray.

## Pests covered
Includes the pest the customer called about (when eligible) plus common/seasonal pest pressures such as **ants, spiders, wasps, hornets, yellow jackets, cockroaches, fleas, ticks, carpenter bees, carpenter ants, stink bugs, ladybugs, centipedes, millipedes, boxelder bugs, beetles, carpet beetles, crickets, gnats, flies, fruit flies, drain flies, earwigs, silverfish, and mites**, among other covered insects. Species-specific scope should be verified by the team if unusual. **Termites, bed bugs, and wildlife are separate program categories.**

## How it works
- Customized pest-specific applications using appropriate liquids, crack-and-crevice treatments, baits, granules, traps, and other tools.
- Attention to exterior entry points, foundation/perimeter, garage, porches and appropriate interior areas; crawl spaces or basements when accessible and appropriate. Protects around the home with a **25-foot perimeter barrier where applicable**.
- Both **traditional and eco-friendly product options** are available.
- Retreatments between scheduled maintenance visits as needed under applicable plan terms.

## Visit schedule
- First two visits roughly **2 weeks apart**, focused on controlling active pests.
- Ongoing preventive technician visits approximately **every 10 weeks** (original pricing sheet describes ~5–6 visits in the standard schedule).

## Pricing (first 3 months included)
- **$347 initially with a 12-month agreement** (includes the year-round $50 initial discount).
- **$397 initially without a 12-month agreement.**
- **$59 every 4 weeks beginning month four**, under either option.
- **$599 annual prepayment price**, available after paying the initial fee.

## Sales positioning
Excellent fit for customers tired of seasonal infestations, recurring insect issues, or paying for repeated isolated treatments. You may emphasize ongoing coverage, customization, complimentary retreatments when needed, and satisfaction/money-back guarantees (subject to actual terms). Do not claim an unlimited unconditional refund.

---

# 4. HOMESHIELD — CRITTER CONTROL

## What it is
Residential rodent/nuisance-wildlife removal, active trapping/control, targeted exclusion when appropriate, and ongoing prevention. This is more than placing a trap once.

## Typical pest concerns
**Mice, rats, moles, meadow voles, chipmunks, squirrels, flying squirrels, raccoons, opossums, groundhogs, skunks, snakes,** and comparable critter issues subject to technician assessment. **IMPORTANT EXCEPTION: bat remediation always requires a $149 inspection and a custom quote; never give the regular $647 bat price.**

## Treatment and scope
- Based on the pest/property: trapping, tamper-resistant rodent stations, baits, one-way exit devices, targeted exclusion/sealing entry points, and appropriate repellents and monitoring tools.
- With-exclusion pricing includes applicable **targeted entry-point sealing**, not unlimited structural repair or every possible future opening. Technician determines access and reasonable scope.
- If animals remain **only outdoors and no entry-point sealing is necessary**, the no-exclusion option can be used.
- Exterior/perimeter preventative methods may cover approximately a **25-foot area where appropriate**; actual placement/treatment depends on pest and conditions.
- **Do not promise a live animal will always be captured or removed on the first visit.** Bat exclusion, roof work, high-risk areas, and specialized structural repairs need an individualized assessment.

## Visit schedule
- **Daily visits for 7 business days** (about 1.5 weeks) during the initial trapping/removal period, adjusted to the issue or the customer's schedule.
- A **two-week follow-up**.
- **At least 9 visits over the first 3 months** under the documented initial program.
- Preventive maintenance approximately **every 10 weeks** thereafter.
- Actual trapping methods and safe access are determined on site; avoid promising a specific extermination timeline.

## Pricing (first 3 months included)

| Scope | With 12-month agreement | No annual commitment |
|---|---:|---:|
| **With exclusion** | **$647** | **$697** |
| **Without exclusion** | **$447** | **$497** |

- In either configuration, ongoing maintenance is **$49 every 4 weeks**, beginning month four.
- **$499 annual prepayment price**, available after the initial fee.
- The $50 contract discount is already included in the lower initial price; don't apply it twice.

## Sales positioning
Explain that the difference between trapping once and maintaining protection is preventing repeat activity. Where there is evidence of an entry issue, explain why targeted exclusion can add value. If customer objects to a year-long contract, offer the **$50-higher no-annual-commitment option** without portraying it as stopping after month three.

---

# 5. CAROLINA TERMITESHIELD

## What it is
Residential subterranean-termite treatment and ongoing monitoring/protection using a multi-layered combination of **termite bait stations, targeted soil treatments, and foam in affected voids when appropriate**. Exact applications are based on inspection and treatment need; do not promise every technique at every home.

## Visit schedule
- First two visits approximately **2 weeks apart**.
- Maintenance/termite monitoring approximately **every 6 months** thereafter.

## Residential initial pricing (includes first three months)

| Home size | 12-month agreement | No annual commitment |
|---|---:|---:|
| **Under 1,200 sq. ft.** | **$697** | **$747** |
| **1,200–3,000 sq. ft.** | **$797** | **$847** |
| **3,001–5,000 sq. ft.** | **$897** | **$947** |
| **Above 5,000 sq. ft.** | **Custom quote** | **Custom quote** |

- Ongoing service: **$29 every 4 weeks** beginning month four.
- **$299 annual prepayment price**, available after the initial fee.
- If square footage is unknown, provide a clearly labeled range and have the team confirm home size rather than presenting one bracket as certain.

## Warranties and guardrails
- TermiteShield is advertised with **retreatment warranty** and **damage warranty**, plus applicable satisfaction/money-back guarantees.
- **Specific eligibility for a termite damage warranty must be confirmed.** Pre-existing active termite activity or other property conditions can affect coverage. Never promise all customers automatically qualify for a damage warranty, a particular monetary damage limit, or coverage for damage that already occurred.
- A $247 One Time Service **must NOT** be offered as a substitute for termite treatment/protection.

## Other termite projects
A legacy pricing sheet references separate pre-construction/commercial termite work and a **$377 switch-over** figure, but the pre-construction table is ambiguous/incomplete. **For those requests, obtain a custom confirmed quote from the team; do not automatically quote $377 or a per-square-foot rate.**

---

# 6. CATCHY CLUB — PREMIUM ALL-INCLUSIVE MEMBERSHIP

## What it is
The company's highest-tier, bundled residential protection package for homeowners who prefer one broad program rather than piecing together services.

## Included at no extra program charge
1. **HomeShield Signature general pest protection** for covered insects.
2. **HomeShield Critter Control** and rodent/critter monitoring/control within the applicable plan scope.
3. **Carolina TermiteShield** monitoring/protection and applicable warranties (eligibility still subject to terms and property assessment).
4. **Seasonal mosquito treatments** — CONFIRMED INCLUDED at **no additional charge** for Catchy Club members.

Other positioning: customized preventive interior/exterior treatments as appropriate, seasonal adjustments, termite/rodent monitoring, recommendations for exclusion as needed, priority response/scheduling, preferred technician options, complimentary retreatments when warranted, satisfaction and money-back guarantees subject to service terms.

**Do not imply unlimited structural exclusion, unlimited wildlife work, a guaranteed fixed damage-warranty payout, or every possible specialty pest is covered without qualification.**

## Visit schedule
- First two main visits about **2 weeks apart**, with more intensive initial work when needed for active infestations.
- Thereafter, **one routine technician visit per calendar month**. This differs from the **every-28-day billing cycle**.
- Seasonal mosquito service is included but specific mosquito appointment timing follows the service season/field schedule; do not invent exact dates.

## Pricing (eligible homes 1,000–4,000 sq. ft.)
- **$997 initial with a 12-month agreement**, covers first three months.
- **$1,047 initial without a 12-month agreement**, covers first three months.
- **$149 every 4 weeks beginning month four**, under either option.
- **$1,499 annual prepayment price**, available after the initial fee.
- Homes **smaller than 1,000 or larger than 4,000 sq. ft.** require **custom pricing**; do not quote the flat $997/$1,047 as guaranteed for those homes.

## Sales positioning
Recommend when a prospect wants broad, hands-off protection or has multiple pest categories and wants one premium solution. Avoid pushing Catchy Club onto someone who only wants to address a minor, isolated pest concern. The package does include mosquitoes; do not separately charge Catchy Club customers the $49 mosquito add-on.

---

# 7. MOSQUITO PLUS — TWO DIFFERENT PURCHASE OPTIONS

**CRITICAL: DO NOT CONFUSE THE TWO OPTIONS.**

## 7.1 Add-on for customers with another regular recurring plan
- Available **ONLY if the customer already has another active regular recurring Catchy service plan**.
- **$49 per treatment**, not a flat $49 monthly charge.
- Treatments approximately **every 3 weeks during mosquito season**.
- **No initial add-on fee**.
- Traditional add-on season listed in the pricing PDF: **May 1–September 30**.
- Customer can pay **per treatment** and can cancel the add-on at any time; the underlying primary service agreement is unchanged.
- **Catchy Club already includes mosquitoes at no extra charge.** Do not sell this add-on to Catchy Club members.

**Source correction:** An older combo-pricing row suggests $49 initial + $49 every four weeks for mosquitoes. Owner-confirmed policy OVERRIDES that row: **$49 per treatment, every three weeks, no initial fee, existing recurring customers only.**

## 7.2 Mosquito/yard treatment ONLY (no other recurring plan)
- Customer MUST purchase the **seasonal package prepaid in full**. **No pay-per-treatment option for mosquito-only customers.**
- Pricing depends on the month of seasonal enrollment. **The source table is explicitly labeled for the 2027 season.** Do not automatically quote these rates as current-season rates for 2026 or a different year.

| 2027 start month | Upfront seasonal price | Approximate treatments |
|---|---:|---:|
| March | **$699** | ~11 |
| April | **$649** | ~10 |
| May | **$599** | ~8 |
| June | **$549** | ~7 |
| July | **$399** | ~5 |
| August | **$349** | ~4 |
| September | **$247** | ~3 |
| October | **$247** | 1 one-time yard treatment |

- Treatment counts are approximations and depend on start month; do not promise exact visit counts not scheduled.
- The stand-alone package's exact application interval and last treatment date are **not defined in the supplied pricing table**; ask the team if needed.
- If prospective customer wants individual $49 mosquito treatments but has no other recurring plan, explain that $49 pay-as-you-go is available only as an add-on, and offer the prepaid mosquito-only season instead.

---

# 8. COMBINATION AND UPSELL PRICING

These are for a customer buying multiple distinct service categories. Start with the pest they called about; do not overwhelm them with a bundle and every possible add-on.

**Add Signature Pest to an existing Critter Control or TermiteShield account:**
- **$49 initial add-on fee**.
- **$49 every 4 weeks** ongoing (discounted from normal Signature Pest $59).

**Add Critter Control OR TermiteShield to another program:**
- **50% off the additional program's initial three-month package fee**; charge full applicable initial price for the primary service.
- **Normal recurring fee** for each extra program thereafter: **$49 every 4 weeks** for Critter Control; **$29 every 4 weeks** for TermiteShield.
- Determine exclusion need and home size before stating precise final combination price.

**Add Mosquito Plus:** Use Section 7.1's owner-confirmed **$49 per treatment every 3 weeks, no initial fee**, and only for an existing qualifying recurring customer. Ignore conflicting old combo row.

**Upgrade credit:** The pricing sheet instructs that when a customer upgrades categories/programs, initial service fees already paid can be credited toward the appropriate upgraded initial cost so the customer pays the difference. **Do not promise stackable discounts or calculate an uncertain multi-step upgrade without validation.**

**Catchy Club:** Because it already includes general pest, critter control, TermiteShield, and seasonal mosquitoes, do not double-sell included categories as recurring paid add-ons.

---

# 9. ONE TIME SERVICE — $247

## What it includes
- **$247** for one approximately **45-minute** targeted technician visit: inspect active problem area and treat the identified qualifying pest issue.
- Covers **one or two eligible pest types/issues, provided they are within the SAME pest service category**. It is not blanket treatment across unrelated pest categories.
- **No warranty, money-back guarantee, ongoing prevention, monitoring, or included follow-up visits.** If the problem returns, further service must be purchased.
- No major exclusion work, large rodent bait-station program, larger-wildlife trapping, termite systems, or full preventive barrier plan.
- If upgraded to any ongoing protection plan, the **full $247 is always credited toward the new service** (owner, October 22, 2026). Pitch it as a way to get started; we recommend follow-up visits.

## What is NOT eligible
**Termites, bed bugs, bats and larger wildlife (squirrels, flying squirrels, raccoons, opossums, groundhogs, skunks, snakes)** are excluded. Mice, rats (wood rats included), moles, voles and chipmunks are eligible. Other pest categories generally qualify for a focused one-time service, provided the one-/two-pest, same-category, limited-scope rules are satisfied. Unusual species, infestation severity, safety, and access are subject to team assessment.

## When to present it
- When the caller **explicitly asks** for one-time treatment or has no interest in a continuing plan.
- When the caller **hesitates or declines** appropriate recurring protection, often because of cost or commitment.
- For minor, isolated issues, or a renter/moving-soon customer whose needs truly are short term.

**Do not proactively lead with it** for major/repeating infestations; don't bring it up before understanding the pest issue. But do NOT force a 12-month plan first: the company also has **no-annual-commitment three-month initial packages** for the main programs (initial +$50, ongoing 28-day maintenance from month four). This is a useful alternative when the contract itself is the problem.

## Suggested explanation
“We can also handle a small, isolated issue with a $247 one-time treatment for one or two eligible pests in the same category. It doesn't include follow-up visits or a warranty, so if you're looking for longer-term protection I can also explain our three-month, no-annual-commitment option.”

---

# 10. PROFESSIONAL INSPECTION / CONSULTATION

- **$149 for a new customer**; the original pricing sheet lists **no fee for an existing customer** (confirm eligibility/account status if relevant).
- Thorough assessment based on property access and concern: interior/exterior areas, foundation, garage, accessible crawl space/basement/attic access, landscaping, entry points, pest species, infestation extent, and conditions that contribute to pest activity.
- Technician explains findings, treatment recommendations, and next steps; this is a diagnostic visit, not an automatic full treatment.
- **Full $149 inspection credit toward any qualifying service COMPLETED within 90 days** of inspection.
- Especially helpful when the customer cannot identify the pest, has a complex issue, or wants assessment before committing.
- Do NOT insert extra diagnostic fees into a clear routine-service quote unless inspection is actually required; use known standard initial prices where applicable.
- Never guarantee every attic/crawl space will be entered regardless of safe access.

---

# 11. BED BUG TREATMENT

- Multi-visit specialized inspection and treatment of sleeping areas, furniture, baseboards, cracks and crevices, harborages and high-risk spaces as appropriate.
- **Starting at $889**; **final cost is confirmed by the team** based on the job. Do NOT call $889 a guaranteed flat rate.
- **Three treatment visits**, typically **two weeks apart**.
- **Six-month treatment warranty** (details subject to terms and technician assessment).
- Occupants typically must stay out of treated areas for **approximately three hours** after application; follow the technician's specific reentry instructions.
- Do **NOT** recommend the $247 One Time Service for bed bugs.
- If the caller asks about preparation, furniture movement, washing or children's belongings, do not invent individualized instructions; connect them to the technician's preparation checklist/office.

---

# 12. BAT REMEDIATION

- **Always begins with a $149 in-person inspection and custom remediation quote.**
- **The $149 inspection fee is credited to the bat-remediation service price** if the customer proceeds.
- Standard Critter Control initial pricing ($647/$697) does **NOT** automatically apply to bats.
- Do not promise first-visit removal, a particular exclusion method, or immediate remediation without inspection. The team determines scope and scheduling.

---

# 13. WOOD DESTROYING INSECT REPORT (WDIR)

- Professional wood-destroying insect inspection/report commonly requested as part of a real estate transaction; precise legal/lender requirements vary by transaction—**do not universally claim every purchase or refinance must obtain it.**
- Checks evidence/conditions relevant to termites, carpenter ants/bees, wood-boring/powderpost beetles and conducive conditions as appropriate to the report.
- **$275 standard price**.
- Completed report is **emailed the next business day** under the pricing-sheet process.
- **New homeowners ONLY** can apply the **full $275 WDIR fee as a credit** toward qualifying pest-control service.
- Internal referral-partner rates noted in the pricing document: **$195** for Jim Boyd & Julie Mallett, WNC Property Inspections, Farris Home Inspections and Affordable Home Inspections. **Do not proactively offer partner-only pricing to ordinary leads.** Verify referral eligibility first.

---

# 14. COMMERCIAL PEST CONTROL

## Scope and positioning
Custom pest-management services for businesses including restaurants, fast food, retail, warehouses, distribution centers, offices, gyms, mechanics/automotive facilities, gas stations and shopping centers. Designed around prevention, food-related pest risk, operational constraints, brand protection, and any applicable regulatory requirements.

**Commercial service is ALWAYS custom quoted. Do NOT supply a made-up flat per-building price.** A short-term rental in a single-family residential home generally follows residential service options, not the commercial quoting process.

## Seven intake questions (collect when possible)
1. Type of business/industry.
2. Pest type, activity, and where pests are being seen.
3. Whether food is prepared/stored, and whether there is a commercial kitchen.
4. Approximate building square footage.
5. Structure type (standalone, shopping center, multi-tenant, warehouse, etc.).
6. Whether the business has an existing pest-control provider/program.
7. Any special health department, audit, regulatory, or compliance requirements.

## Workflow
Send collected details to the commercial team; a specialist aims to follow up **within one business day** with a service recommendation and custom pricing. Do not suggest that paying Catchy automatically guarantees any specific inspection or regulatory outcome.

---

# 15. OTHER FEES, CUSTOMER POLICIES & LOYALTY

**24-hour appointment cancellation policy:** The sheet lists a **$75** cancellation fee for cancellations inside the applicable notice window. Its purpose is schedule quality control, not a sales tactic. Do not bring it up unprompted or confidently interpret exceptions the documents do not define.

**Early cancellation of discounted annual plans:** See Section 2: **$50 plus fees due within the following 30 days**, subject to signed terms. No annual-commitment cancellation charge is applied to the explicitly no-contract option.

**Catchy Loyalty Tag:** Eligibility after **any one** of: completing a full 12-month agreement; spending $1,500 with Catchy; or making an annual prepayment. Perks mentioned in the original sheet include ongoing preferential/grandfathered pricing treatment, priority scheduling, a possible seasonal service freeze for **up to 10 weeks once every two years**, annual prepay options, and certain startup-fee waivers. Some exact waiver examples are inconsistent in the source: **do not promise a specific waiver until confirmed**. This is mainly an existing-customer program, so rarely relevant to a first sales follow-up.

**Annual prepaid amounts after initial service:** Signature Pest **$599**, Critter Control **$499**, TermiteShield **$299**, Catchy Club **$1,499**. They are prices, not discount amounts.

---

# 16. QUICK QUOTE CHEAT SHEET

All below are **USD**. Main-program initial prices cover **the first three months**. “Every 4 weeks” means **28-day billing**, starting month four, irrespective of routine technician service intervals.

| Service | 12-month initial | No-contract initial | Ongoing from month four | Routine technician visits |
|---|---:|---:|---:|---|
| Signature Pest | $347 | $397 | $59 / 4 weeks | ~10 weeks; first two ~2 weeks apart |
| Critter w/ exclusion | $647 | $697 | $49 / 4 weeks | 7 daily checks + 2-week follow-up; then ~10 weeks |
| Critter w/o exclusion | $447 | $497 | $49 / 4 weeks | Same as above as applicable to trapping |
| Termite <1,200 sq. ft. | $697 | $747 | $29 / 4 weeks | ~6 months; first two ~2 weeks apart |
| Termite 1,200–3,000 sq. ft. | $797 | $847 | $29 / 4 weeks | Same |
| Termite 3,001–5,000 sq. ft. | $897 | $947 | $29 / 4 weeks | Same |
| Termite >5,000 sq. ft. | Custom | Custom | Confirm | Confirm |
| Catchy Club (home 1k–4k sq. ft.) | $997 | $1,047 | $149 / 4 weeks | One routine visit per calendar month |
| Catchy Club outside size range | Custom | Custom | Confirm | Confirm |

**Other key amounts:**
- One Time Service: **$247**, one limited visit, no included warranty/follow-up; always credited toward any plan they upgrade to.
- New-customer Inspection/Consultation: **$149**, credited if qualifying service completed within **90 days**.
- Bed bugs: **starts at $889**, team confirms final price; three visits; six-month warranty.
- Bat remediation: **$149 inspection** credited toward a **custom remediation quote**.
- WDIR: **$275** standard; full service credit for **new homeowners only**.
- Mosquito add-on for existing recurring customers: **$49 per treatment every ~3 weeks**, no initial charge.
- Mosquito-only season: **full advance payment required**; use the **2027** start-month pricing in Section 7, not $49 pay per visit.
- Signature Pest add-on to Critter/Termite: **$49 initial + $49 every 4 weeks**.
- Extra Critter or Termite category: **50% off additional initial fee**, ordinary ongoing rate.

---

# 17. SALES-FOLLOW-UP DECISION EXAMPLES

These are **patterns** to adapt from the transcript, not messages to send word-for-word. Substitute details ONLY if actually supported by the call and record; never invent the recipient's name or a price/offer.

### Example A — Prospect declined because of the 12-month commitment
“Thanks for chatting with Catchy about the [pest] problem. I wanted to mention we also offer the same initial three months of treatment **without a 12-month commitment**—it's just $50 more upfront, and the preventive plan can continue every four weeks starting in month four without locking you into a year. Would that option work better for you?”

### Example B — Ants/spiders or another recurring insect concern
“Hi [first name], following up on your [pest] issue. Our Signature Pest program treats the current problem and maintains protection through the year, with the first three months covered by the initial visit package. If you'd like, I can help you choose between the discounted annual plan and our no-annual-commitment option. Want to get it scheduled?”

### Example C — Rodents, worried about recurring activity
“Hi [first name], I wanted to follow up about the [mice/rats] you mentioned. Our Critter Control program starts with daily trap checks for seven days, includes a follow-up, and continues with preventative maintenance; we can also address qualifying entry points if needed. Would you like help getting started?”

### Example D — One isolated pest, reluctant to start recurring coverage
“For an isolated [pest] issue, we also offer a $247 One Time Service for up to two eligible pests in the same category. It's one targeted visit without ongoing follow-ups or a warranty. If that fits what you need, would you like to book that instead?”

### Example E — Customer asks about termite treatment
“Thanks again for speaking with us about the possible termite activity. Carolina TermiteShield pairs treatment with ongoing monitoring, and the initial three-month price depends on your home's size. We also offer both annual and no-annual-commitment options. Could we help you get the next step scheduled?”

### Example F — Customer was comparing multiple categories
“Since you mentioned both [problem 1] and [problem 2], Catchy can handle them together. We offer multi-service initial discounts, or our Catchy Club bundles general pest, critter protection, termites, and seasonal mosquitoes. I’m happy to help find the best fit without adding coverage you don’t need. Would you like to compare the options?”

### Example G — Bat issue
“Thanks for reaching out about the bat activity. We start bat remediation with a $149 on-site inspection so we can identify the entry points and provide an accurate custom quote, and that inspection fee is credited toward the work if you move forward. Would you like to schedule an inspection?”

### Example H — Mosquito-only inquiry
“For mosquito-only yard treatments, our seasonal program is purchased upfront, with pricing based on when in the season you begin. The $49 per-treatment option is reserved for customers who already have another recurring Catchy plan. Would you like me to help with the seasonal package?”

## 17.1 Common sales objections

- **“Too expensive”:** Explain what the initial three months cover. If qualified, discuss the $247 One Time Service for eligible limited problems. The Section 0.3 10% discount is already in the quote by default. No other special discounts.
- **“I don't want a contract”:** Explain **no-annual-commitment initial package = $50 higher**, then regular maintenance from month four can continue without 12-month lock-in. This is often the simplest close.
- **“I need to ask my spouse”:** Summarize the single most relevant package and offer a short written recap or invite a question. Avoid pressure.
- **“I want to think about it”:** Mirror the actual unresolved issue from the call; provide the missing detail and one easy next step.
- **“I'm not sure what pest it is”:** Offer professional $149 diagnostic inspection with qualifying 90-day treatment credit rather than guessing.
- **“Will you guarantee it?”:** Mention Catchy's advertised satisfaction/money-back guarantees for recurring plans and the service's applicable warranty; **exact remedies/conditions require the written agreement**.

---

# 18. SAFETY RAILS — WHAT THIS AI MUST NOT MISSTATE

- Billing runs every 28 days internally; to customers it's "a month" (Section 0.16). Catchy Club **visits** are once a month.
- Do NOT say the initial fee buys only one appointment; for the main programs it covers the **first three months**.
- Do NOT say the no-contract first-three-month option automatically terminates in month three. **Regular maintenance begins month four, without a year-long lock-in.**
- Do NOT misrepresent the year-round $50 annual-plan discount as a short-term coupon or deduct it twice.
- Do NOT charge Catchy Club separately for seasonal mosquitoes.
- Do NOT sell $49 pay-per-treatment mosquito service to a mosquito-only customer or invent a mosquito add-on startup fee.
- Do NOT use the **2027** stand-alone mosquito-only prices as though they are approved for other seasons/years.
- Do NOT quote standard Critter Control prices for **bats**; schedule the $149 inspection/custom quote.
- Do NOT quote a fixed bed bug job for $889; say **starting at $889** and final price confirmed by team.
- Do NOT recommend $247 One Time Service for **termite, bed bug, bat or wildlife** jobs (mice and rats are fine), or promise it treats unrelated categories simultaneously.
- Do NOT promise every TermiteShield customer an unconditional termite damage warranty, a particular cap, or prior-damage reimbursement before eligibility is confirmed.
- Do NOT assume pre-construction/commercial termite pricing from a corrupted price table; route for custom pricing.
- Do NOT quote the flat Catchy Club initial price outside **1,000–4,000 sq. ft.**, or TermiteShield flat residential price above **5,000 sq. ft.**
- Do NOT misapply WDIR credit to customers other than **new homeowners**.
- Do NOT promise unconditional refunds, guaranteed trapping completion dates, exact appointment openings, unlimited exclusion, health-department approvals, or visit counts for unconfirmed special jobs.
- Do NOT send unbooked-lead follow-ups to leads who already booked or opted out.

---

# 19. SOURCE PRECEDENCE AND OPEN ISSUES

**Authority order for this guide:** (1) Owner's direct answers during the October 21, 2026 reconciliation discussion; (2) the October 2026 “Pricing and Pests - Prices & Plans.pdf”; (3) the supplied longer “Service Plans — Internal Knowledge Base” and the owner's additional Catchy Club/commercial/inspection/One Time Service descriptions. This document consolidates them and explicitly overrides their outdated or conflicting rows.

The following matters are **deliberately NOT treated as fully established** because the supplied materials are incomplete or owner's follow-up was intentionally stopped. For these, AI can describe the program generally but must not invent specifics:

1. **Termite damage warranty eligibility and exclusions**, especially when there is active termite activity at first inspection. Final determination should come from written agreement/office.
2. **Money-back guarantee:** RESOLVED in Section 0.6 (annual plans only; three months; partial or full refund pending manager approval).
3. **Commercial/pre-construction termite calculations**, and whether the legacy switch-over figure still applies.
4. **Specific structural-exclusion boundaries and exceptional wildlife services**, which vary by property and technician determination.
5. **Some WDIR statutory requirements**: whether any particular sale/refinance requires a WDIR depends on the transaction; don't make universal legal claims.
6. **Stand-alone mosquito service intervals and exact season end date** for the 2027 prepaid packages are not spelled out in the price grid.
7. **Loyalty-tag exact startup waivers** and unusual contract-cancellation exceptions are not fully defined; confirm with office if the question matters.

**The goal:** Send correct, specific, warm, conversion-focused messages that show the prospect Catchy listened to their concern, remove the actual obstacle to booking, and invite the next step—without making up facts or pricing.

END OF KNOWLEDGE BASE
