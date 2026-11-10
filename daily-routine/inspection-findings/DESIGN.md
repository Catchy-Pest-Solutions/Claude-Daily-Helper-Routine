# Inspection findings routine: design (agreed with Daniel, Nov 5-6, 2026)

Status: **live since Nov 7, 2026 (tested Nov 6); see README.md.** This is the spec the build follows.
It's a new routine, separate from the new-customer follow-up
(`../lead-followup/`). It may reuse that folder's helper code (`lib/`:
Briostack client, Google, Chromium renderer, templates) and data, but
it never changes how that routine behaves.

## What it does

During the day, technicians post findings from their customers' homes to the
private Slack channel **#inspection-findings** (`C0CF6R073M4`). Every
morning the routine turns each valid finding into a quote for the customer:
an email with a PDF, and a text with a quote card picture. It logs both in
Briostack, creates a call task for Steve B, tracks technician bonuses in a
Google Sheet, and sends Daniel a weekly payroll summary.

Goal: get current customers (and inspection / one-time customers) to add the
plan that fixes a problem the tech actually found, and close it by text or
email so the office call is a backstop.

## Schedule: one run, Mon-Sat at 8:00 AM Eastern

The run processes every channel post since the last successful run (Monday
covers Saturday and Sunday; Saturday covers Friday; a missed run catches up
by itself). Office holidays: reuse `src/callReview/calendar.js`.

1. **Read** new posts (and replies in clarification threads) in
   #inspection-findings with a read-only Slack bot token.
2. **Validate** each post (see Checks).
3. **Quote**: price it (see Pricing), render the quote card and PDF, write the
   email and text.
4. **Send**: emails go out as each one is ready (from 8 AM); texts are
   scheduled for **10:00 AM** through Textable `sendAt`. Texts go to the
   primary and secondary phone only, never a third.
5. **Log** both on the customer's Communications tab, starting
   `[INSPECTION FINDINGS]` (or `[INSPECTION FINDINGS — TEST ...]`), with the
   plan, price, credit amount and credit expiry date.
6. **Task** for Steve B in Briostack (see Tasks). Nothing goes to Steve in
   Slack.
7. **Tech messages** in Slack (sent from Daniel's account): a one-line note
   when a post didn't count and why, or a clarification question when
   something doesn't make sense. The tech replies in the thread; the next
   run reads the reply. If no answer after a few days, tell Daniel.
8. **Sheet**: add a row per post to the Google Sheet (see Bonuses).
9. **Thursdays**: Slack Daniel the pay-week bonus summary (see Bonuses).

Saturday runs: texts and emails go out Saturday; Steve B's task is due
**Monday** at 1 PM until the office works Saturdays (a config switch).

Test mode first (like the follow-up routine): every text and email goes to
Daniel's test phone and email, log entries say TEST. Daniel and Claude test
together for a few days, aiming to go live the week of Nov 9, 2026.

## What techs do (all four required for a bonus)

1. **Photograph the problem up close**, one clear photo per issue.
2. **Step back and take a wide photo** showing where it is on the house (this
   also shows it's a single-family home or business).
3. **Voice-to-text what you see**: what it is, exactly where (side of the
   house, room, corner), how much, active or old, what the customer said,
   and what you checked that looked fine.
4. **Post it to #inspection-findings before leaving the property**: start
   with `Customer: <name> #<ID>`, then the photos and the description, all
   in one post. Posting on site makes the photo timestamp on the customer's
   quote match the visit. If the customer only asked for a quote and there's
   nothing to photograph, start with "Quote request" (no bonus).

## Checks (in order)

- The post names a customer ID, and the name matches Briostack.
- The poster (Slack user mapped to a Briostack employee) had an appointment
  at that customer that day. Open question: how many days late to accept.
- Single-family home or business. Apartments and mobile homes don't count.
- The finding is one of the seven qualifying findings below.
- **Coverage check**: the customer doesn't already have an active plan that
  covers it (techs sometimes don't know, e.g. a Critter plan they weren't
  servicing that day). Catchy Club customers are skipped entirely. If it's
  already covered: nothing goes to the customer, the tech gets a short
  "didn't count, they already have X" note.
- **No repeats for 90 days**: the same customer + plan isn't quoted (or
  paid) again while an earlier offer's credit is open. Checked against both
  the Google Sheet and the `[INSPECTION FINDINGS]` entries on the
  Communications tab. The tech gets "already quoted X on <date>, offer open
  until <date>."
- The photos actually show what the tech described.
- Businesses: no automatic price (commercial is custom). Make a task for
  Steve B to price it; no message to the customer; the tech still earns the
  bonus.

## The seven qualifying findings

| Finding | Plan | Bonus |
|---|---|---|
| Signs of termites (damage or activity) | Carolina TermiteShield | $4 |
| Rodent or wildlife droppings in attic, crawl space or home | HomeShield Critter Control | $3 |
| Carpenter bee burrows | HomeShield Signature | $2 |
| Exclusion needed (a specific gap a mouse could fit through, about pencil width or more) | HomeShield Critter Control | $2 |
| Wood or siding touching the ground | Carolina TermiteShield | $2 |
| Wasp, hornet or yellow jacket nest | HomeShield Signature | $1 |
| Mole, vole or groundhog burrows in the yard | HomeShield Critter Control (no exclusion) | $1 |
| Quote request with nothing to photograph | (whatever they asked for) | $0 |

- Leads from an **Inspection / Consultation (12501)** or **One Time Service
  (12504)** visit pay **1.5x** (extra-thorough inspections on those visits).
- **One lead per customer per plan**: carpenter bees plus a wasp nest is one
  Signature lead, paid at the higher amount.
- No weekly cap for now.
- Future findings (not yet): crawl space encapsulation, attic insulation
  removal/replacement, vent covers, moisture readings over 20%, standing
  water, falling crawl space insulation, mold. Those will aim for a booked
  assessment (Steve H by phone for now), not a price. Build the findings list
  as config so they're new rows later.

What each plan covers (for the coverage check):

- **HomeShield Signature**: 30+ pests: ants, spiders, ticks, fleas, carpenter
  bees, carpenter ants, wasps, hornets, yellow jackets, roaches, stink bugs,
  Asian lady beetles, centipedes, boxelder bugs, millipedes, beetles,
  earwigs, silverfish, carpet beetles, pantry pests, moths, indoor gnats,
  flies.
- **HomeShield Critter Control**: mice, rats, moles, meadow voles,
  chipmunks, flying squirrels (if requested), snakes, grey squirrels,
  raccoons, opossums, groundhogs, skunks.
- **Carolina TermiteShield**: subterranean termites (the only termites in
  this area).
- **Catchy Club**: everything above (skip these customers).

## Pricing (12-month price by default)

**Customer has another active plan** ("buy one, get any other 50% off"):

| Adding | Initial (covers 3 months) | Then every 4 weeks |
|---|---:|---:|
| Signature | $174 (normally $347) | $44 (normally $59) |
| Critter Control, with exclusion | $324 (normally $647) | $34 (normally $49) |
| Critter Control, no exclusion | $224 (normally $447) | $34 |
| TermiteShield (1,200-3,000 sq ft) | $399 (normally $797) | $19 (normally $29) |

No-annual-commitment version: $50 more on the initial fee, same monthly.
Halves round up to whole dollars.

**Customer's only service was an Inspection (12501) or One Time Service
(12504)**, no other active plan: regular 12-month initial price minus what
they paid for that visit (read the real amount from Briostack; usually $149
or $247), with the regular monthly fee. Examples: Signature $347 - $149 =
$198; Critter $647 - $247 = $400; TermiteShield $797 - $149 = $648.

**No active plan otherwise**: regular 12-month price.

The 50% (or the visit credit) is presented as an **account credit in an
exact dollar amount, good for 90 days** ("You have a $173 credit toward
this, good through Feb 3"). It is not entered in Briostack; the office
honors it at booking from the Communications log.

## Messages

- **Signed by the tech**, from Catchy Pest Solutions: "Joey here, I did your
  service Thursday and noticed ... I had the office put together this
  quote." Name the visit day, not "yesterday." Never mention AI.
- **Pitch the fix, not a plan**: here's the problem, here's what it costs to
  fix (the initial fee). The plan name and monthly fee are secondary.
- **Text**: short, confident, assumes the sale. Initial fee only and, in a
  few fixed words, what it covers ("$399, which covers the soil treatment
  and bait stations, with a damage warranty"), then "(details in the
  picture)". Don't mention the 12-month plan in the text.
  Ends with an easy close: "Reply YES and the office will get you
  scheduled." One picture: the quote card.
- **Quote card** (texted picture, 1080x1920, a phone screen): the tech's
  photo of their home stamped with the address, date and time (from the
  Slack post), the problem, the price, the credit and its expiry, the
  "Price covers" list ending "Then $X a month, starting month 4", and the
  plan name (12-month plan).
- **Email**: subject **"What I found at <street address>"**. More
  explanation: the tech's photos (stamped), what was found and where, why it
  matters (researched, accurate claims), the fix and price with the same
  covers words as the text, "How we fix it", terms (12-month plan, monthly
  fee starting month 4) in the details, the infographic for that finding labeled as
  an example, and the plan's video link at the very bottom.
- **PDF** attached to the email: the same, laid out as a short proposal,
  with the card's "Price covers" list and "How we fix it". One page plus
  the infographic when it fits; otherwise the fix gets its own page 2.
- **Credibility ("menu")**: say what the tech checked and didn't see,
  phrased as "During today's visit I didn't see any signs of ...". Only for
  things the tech actually checked. Never state "no termites" or "no
  wood-boring beetles" in writing unless the tech says they inspected for
  them (liability).
- Billing: "monthly" = every 4 weeks; say "a month" to customers.
- YES replies: the office books them, no questions asked. The routine
  doesn't book anything.

Why-it-matters claims must be verified against reliable sources (CDC,
university extension services, NPMA) before they go into the knowledge base.
Notes from the design discussion: carpenter bee tunnels are usually 6-10 in
the first year and get extended over years; woodpeckers dig for the larvae;
yellow jacket nests grow to thousands of workers over a summer and queens
favor the same spots (old nests aren't reused); about 60 US sting deaths a
year (CDC); rodent fire risk from chewed wiring (don't use the unsourced "X%
of house fires" stat); rodent diseases: hantavirus, salmonella,
leptospirosis, LCMV; moles mostly live alone, voles in colonies (don't claim
foundation damage); termites ~$5B a year US damage and homeowners insurance
usually doesn't cover it.

Assets: Daniel's infographics (carpenter bee damage, stinging insects,
rodent droppings, yard burrowing, exclusion needed, signs of termites,
termite entry points) go in the email and PDF; convert to JPG/PNG (no WebP
in email). Videos (email bottom only):
Signature https://youtube.com/shorts/VVmB4DXNLFw,
Critter https://youtube.com/shorts/jPJk2au6hZg,
Termite https://youtube.com/shorts/S2_D-WmwC9s.

## Tasks (Briostack)

One task per quote, assigned to **Steve B (employee 16635)**, task type
**`BID_FOLLOWUP`**, no priority, due **1:00 PM Eastern** the day the quote
goes out (Saturday runs: Monday 1 PM). Linked to the customer (`partyId`)
and the tech's appointment (`appointmentId`). Description: what was found
and where, the tech, the quote and credit, when the email and text went out,
the PDF link. Steve checks his task list (no notification), skips the call
if the customer already said yes, notes what happened in the task and closes
it. Mind the timezone: Briostack task times carry a -07:00 offset.

## Bonuses and payroll

A **Google Sheet** in office@'s Drive, created by the routine (its Google
token can only edit files it created) and shared with Daniel. "Leads" tab:
one row per post: date, tech, customer ID, finding, plan, quote, counted
(yes/no and why), bonus. Daniel can override any bonus by hand; the summary
reads the sheet, so edits stick.

Payroll runs Thursday 5-8 PM; the pay period is Friday-Thursday. With the
one-day lag, **Thursday's 8 AM run** Slacks Daniel each tech's total for
visits from the previous Thursday through Wednesday, plus a sheet link.
Thursday's visits roll into next week.

Low participation: the routine knows who worked from Briostack
appointments. To start, flag a tech who worked 3+ days with zero counted
leads; set a real minimum after 2-3 weeks of data.

## IDs and setup

- Slack: #inspection-findings `C0CF6R073M4` (private; add all six techs and
  the "Inspection Findings Reader" app). Daniel `U09LQDUPQTC`.
- Briostack employees: Steve B 16635 (office sales, gets the tasks), Steve H
  17047 (technician), Aaron W 15783, Sidney M 15724 (also "sidney Martinez"
  15990), Dustin M. 17829, Max R. 17907, Joey J 19570. Map Slack users to
  these in config.
- Environment: `SLACK_BOT_TOKEN` (read-only bot: `channels:history`,
  `groups:history`, `files:read`, `users:read`) and network access to
  `slack.com` and `files.slack.com`, plus everything the follow-up routine
  already uses. The Google token may need the Sheets scope (check).
- Briostack fields seen (Nov 6): appointments carry `serviceCategoryId`
  (`12501`, `12504`, `RODENT`, ...), `price`, `primaryTechnicianId`,
  `scheduledTime`, `serviceAddress`; services carry `statusId`
  (`CSC_ACTIVE`, `CSC_COMPLETE`, `CSC_SCRATCH`, ...).

## Answers to the Nov 6 open questions (Daniel, Nov 6)

1. **Returning-customer discount (10%)**: a customer gets 10% off the
   **initial fee only** (no discount on the monthly fee; halves/percentages
   round up to whole dollars) when they have **no other active service**
   with us, on any of their properties (same address or another one). An
   active service means an active recurring plan: HomeShield Signature,
   Pest Control, HomeShield, Critter Control, Carolina TermiteShield, Catchy
   Club, or Commercial General Pest Control. A "complete" plan (no monthly
   fee) is not active. The 50% "buy one, get one" price applies only when
   another active plan exists. Shown as a credit like the others.
2. **Exclusion rule for rodent signs inside the home, crawl space or
   attic**: quote Critter Control *with* exclusion unless the tech says
   exclusion isn't needed. If the tech says it's needed, or says nothing
   about it, assume exclusion. The visit credit is the **full amount paid**
   (inspection + one-time, $247 in the test post). Test post #19602 says
   "No entry points", which means no exclusion needed (Daniel confirmed):
   $447 - $247 = **$200**. Rule: "no entry points" counts as the tech
   saying exclusion isn't needed.
3. **Late posts**: accept a post on the appointment day or **one day
   after** the appointment was completed. Older posts don't count. (The
   Nov 6 test posts are on customers not visited recently; test mode lets
   a post skip this check so the rest of the flow can be tested.)
4. **Test tasks go to Daniel W (Briostack employee 12883)**, not Steve B.
   Live tasks still go to Steve B (16635). This is a config value
   (`taskAssigneeTest` / `taskAssignee`).

## Setup status (Nov 6)

- `SLACK_BOT_TOKEN` works: after Daniel added the app to #inspection-findings,
  `conversations.history` read both test posts and `url_private_download`
  fetched all 5 photos at full size (IMG_0583, IMG_0563 on #15910; IMG_3331,
  IMG_3332, IMG_1554 on #19602).
- Slack strips EXIF from the photos (no DateTimeOriginal, no camera model),
  so the quote card's date/time stamp comes from the Slack post time, as
  planned.
- Who counts as having "another active plan" can only be decided per
  customer ID across all their properties. The coverage and pricing checks
  must read every service on the customer, not just the visited address.

## Later decisions (Daniel, Nov 6)

- **Exclusion needed** counts only for a specific gap a mouse could fit
  through that our normal exclusion work can fix: in scope, not
  unreasonably small or big, and fixing it actually helps the customer.
- **Bats** (rare) count as rodent droppings: same Critter Control quote,
  plus a one-line alert to #office-only (`C09LNB93MQW`) for a custom quote.
- **Customer notes** (preferences, deadlines, who to call) from the tech's
  post go on the office task under "Customer notes", never to the customer.
- Bonuses are paid for every lead that counts, whether or not the customer
  buys, on the normal Thursday/Friday payroll. The old $25/$50 upsell
  bonuses end when this rolls out.
- Office: when a customer cancels one plan, their other plan goes back to
  its regular price (done by hand, part of cancellation procedures). The
  credit is booked by entering the lower price.
- **Quote requests** for one of the three plans are priced and sent like
  a finding, just without photos (card shows a plain "Your quote" panel;
  email subject "Your quote for <street>"). $0 bonus. Requests for other
  services still become a task for the office.
- **What the price covers** (Nov 10, Daniel): customers who don't read
  email only see the text and the card, so both say what the initial fee
  covers. The words are fixed in `config.json` `priceCovers` (card and
  PDF list, the text's covers words, "How we fix it", fine print) and
  filled in by the scripts, the tech's specific finding first, then the
  plan's other benefits. Each list ends "Then $X a month, starting month 4"
  (plain, not bold) with the customer's real monthly fee. "3-month
  warranty" is gone: it only ever meant what the initial fee covers.
  - Signature: the finding's line (carpenter bee holes foamed and outside
    wood treated; nests treated, removed and an outside treatment that
    prevents new ones), first 3 treatments over 3 months (first two 2 weeks
    apart; the third usually comes right before billing starts in month 4),
    30+ pests inside and out, free return visits between treatments.
  - Critter: inspection and full trap/station setup, 7 days of daily
    visits, the two-week follow-up (droppings and burrows), entry points
    sealed with foam, copper mesh and hardware cloth (with-exclusion price
    only; never for yard burrows), granular repellent, 3 months of
    coverage. The email and PDF say we don't repair foundations or replace
    siding, shingles or roofing.
  - TermiteShield: the finding treated directly, liquid soil treatment,
    bait stations installed (about every 15-20 feet), retreatment and
    damage warranty. The warranty covers new damage while the plan is
    active, never existing damage, and never names a payout amount.
