# NC Wood-Destroying Insect Report (WDIR 100): rules

**Status: DRAFT, collecting Daniel's parameters (Nov 24, 2026). Not approved yet.**

How the routine fills the Official North Carolina Wood-Destroying Insect
Information Report (form WDIR 100, NCPCA / NCDA&CS) from a technician's
inspection. The routine only transcribes what the technician reported and
photographed. It never adds a finding the technician didn't report, never
guesses at a measurement, and never judges how bad something is.

## Output

- **The report PDF:** form pages 1-2 (front and "Conditions Governing This
  Report"), filled and flattened (it can't be edited), with Daniel's
  signature on "Signature of Authorized Company Rep". Then the
  technician's photos on added pages ("Photographs", numbered and
  captioned, with the property address and inspection date on each
  page). The addendum page ("Wood Destroying Organism Inspection Report
  Addendum") is added only when a description doesn't fit its box. The
  graph page is not used (we provide photos, not a graph).
- **A Gmail draft** from office@catchypestsolutions.com with no
  recipients: the office adds them and sends it. Subject: "Wood-Destroying
  Insect Report – <service address>". The body is a short, plain summary
  of the findings. When something needs a quote: "If you'd like a quote to
  address this, reply to this email or give us a call and we'll be glad to
  put one together." No prices and no sales pitch (agents and closing
  attorneys read these). The report PDF is attached.
- The purchaser's signature and "Date Acknowledged" (page 2) stay blank:
  the closing agent gets those signatures.

## Every report

| Field | Value |
|---|---|
| Firm | Catchy Pest Solutions |
| PCO Lic No. | 2592PW |
| Address | 1854 Hendersonville Rd, Suite A8, Asheville, NC 28803 |
| Telephone | (828) 263-4804 (to confirm) |
| Title | General Manager |
| Signature | Daniel Wilde's e-signature (kept as a protected environment setting, never in the repo) |
| Date (every date field) | The inspection date (the technician's visit), not the day the report is written |
| File Number | The Briostack appointment number |

## Section 1

- **Seller's Name(s) / Buyer's Name(s):** "Not provided", unless the job
  notes name them. Who ordered the report (a home inspection company, a
  realtor) goes in Remarks: "Inspection requested by <name>."
- **Address of Property:** the Briostack service address.
- **Structure(s) Inspected:** "A. Main Residence Only" by default. When
  the technician inspected a detached building, check "B. Other"
  instead (not both: A says "Only") and describe them: "Main residence
  and detached garage". Only a building the technician actually
  inspected, never one he merely mentions (Condition 4 excludes
  detached buildings unless they're listed).

## Section 2: areas obstructed or inaccessible

One standard line, plus anything specific the technician reports:

> Attic not inspected. Areas concealed by finished walls, ceilings, floor
> coverings, insulation, furniture or stored items; areas requiring
> ladders, drills or removal of materials; and areas deemed unsafe or
> not readily accessible (see Conditions 2 & 3 on reverse).

"Attic not inspected" is left out when the technician says he inspected
the attic. Then add what he reports, e.g. "Also: crawl space partially
obstructed by ductwork at the rear."

## Section 3: visible evidence

General:

- **Location boxes** (to the right of A-D): the technician's findings,
  rewritten in clear, correct sentences, with where they are, ending
  "See photos 2-3." This is where the findings go, not Remarks.
- For each insect found, check its letter and exactly one of 1, 2 or 3.
  If an insect isn't found, its whole section stays unchecked. Box 1
  ("Control measures were performed") only when we treated this property
  ourselves for that insect (confirmed in Briostack); we normally don't,
  so it's almost never checked.
- Box 4 only when A-D are all unchecked. Box 5 stands on its own (it can
  go with box 4).
- Words: describe what was seen and where. Never "damage", "active",
  "live", "dead", "activity", "inactive" in our own words (the form's
  printed box labels are fine), and never how bad, how old or how
  extensive. This is an insect report, not a damage report.
- A description too long for its box continues on the addendum page:
  "Continued on addendum."
- Wood rot (decay fungi) isn't an insect: never in section 3. If reported,
  it goes in section 5 (moisture conditions).

### A. Subterranean termites

The only termites in our area. "Signs of termites" covers:

- Mud tubes (shelter tubes) anywhere: on or next to the structure,
  inside, crawl space, basement, on wood, landscaping or mulch touching
  the home.
- The insect itself (a worker or a swarmer): "termite insect bodies
  observed at ...".
- Termite galleries or tunneling in any wood of the structure (porches,
  subfloor, joists, sill plate, drywall paper, etc.), described as
  "signs of termites observed at the sill plate", never as damage.

Boxes:

- **A2 (no control measures performed):** the usual case.
- **A3 (previously treated, now appears inactive):** signs of termites
  plus evidence of a full previous treatment: a bait station system
  around the home, or drill holes around the entire foundation.
- **A1:** only if we treated this property for termites (see above).

Previous treatment with no signs of termites: A stays unchecked, box 4 is
checked (if nothing else was found), and A's location box says so
without implying termites: "No signs of termites observed. Termite bait
stations from a previous treatment were noted around the home."

Drill holes at only one spot are not evidence of a treatment. Note them
in A's location box only: "Drill holes noted at the front porch slab
only." They never make A3.

### B. Powder post beetles

Small round exit holes in wood anywhere in or around the home (interior
flooring and trim, crawl space joists and subfloor, porches). Common, and
usually old.

- **B3 (appears inactive):** the technician says inactive (no fresh
  powder at the holes).
- **B2 (no control measures performed):** the technician says active
  (fine powder falling from the holes).
- If the technician doesn't say which, the routine asks him in Slack
  before drafting the report.

Example: "Powder post beetle exit holes observed in the subfloor, front
left crawl space. No fresh powder observed. See photo 4."

### C. Old house borers (wood-boring beetles)

Like powder post beetles but rarer, with larger oval exit holes, in any
wood of the house. Same boxes: C3 when the technician says inactive, C2
when he sees fresh sawdust/powder below the holes, ask him if he doesn't
say.

### D. Others: carpenter bees or carpenter ants only

Write the insect on the "Others" line ("Carpenter bees", "Carpenter
ants", or "Carpenter bees and carpenter ants").

- **Carpenter bees** (the most common finding on these reports): "Signs
  of carpenter bee burrows observed at the front porch fascia. Treatment
  is recommended. See photo 5." Always D2: carpenter bees can't be judged
  inactive (they're seasonal and eggs and larvae stay in the burrows
  year round), so we never call them inactive and always recommend
  treatment.
- **Carpenter ants:** galleries in wood like termites but with no mud
  tubes, and the galleries are very smooth. D2 unless we treated (D1).
  Never D3 unless Daniel says otherwise.

## Section 4

Checked only when the technician found no signs of any of A-D. A previous
treatment with no signs of termites still gets box 4.

## Section 5: conditions conducive to subterranean termites

Termites only. Check it and list what the technician reported, briefly:

- **Wood-to-ground contact** anywhere: crawl space supports, porches,
  steps, decks, wood siding, trim.
- **Siding-to-ground contact** (vinyl, fiber cement, brick, stone, any
  siding): "a hidden entry point for termites".
- **Cellulose material** in or around the home: firewood or lumber piled
  against the house, loose wood or debris in the crawl space.
- **Moisture:** standing water in the crawl space or next to the home,
  moisture meter readings over 20% on crawl space wood (only the reading
  the technician gives; never a guessed number), wood rot.

Only conditions the technician reported. Overflow continues on the
addendum.

## Remarks

Mostly unused. "Inspection requested by <name>." when known, and "Photos
attached." Anything else only when it clarifies a statement above.

## Still to decide

- How technicians submit WDIR inspections (a Slack template, Briostack
  notes) and which Briostack service category marks a WDIR job.
- Which technicians may perform WDIR inspections (the routine only
  drafts reports for techs on that list).
- Company telephone for the form.
- Gmail: the office account's connection needs the "create drafts"
  permission (gmail.compose) added once.
- South Carolina (CL-100) after NC works.
