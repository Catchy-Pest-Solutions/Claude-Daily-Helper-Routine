# NC Wood-Destroying Insect Report (WDIR 100): rules

**Status: Daniel's parameters, Nov 24, 2026.** Built into the inspection
findings routine (`ROUTINE_PROMPT.md`, "WDIR posts"): decisions with
`"action": "wdir"`, rendered by `wdir/lib/render.js`, checked by
`wdir/lib/report.js`.

How the routine fills the Official North Carolina Wood-Destroying Insect
Information Report (form WDIR 100, NCPCA / NCDA&CS) from a technician's
inspection. The routine only transcribes what the technician reported and
photographed. It never adds a finding the technician didn't report, never
guesses at a measurement, and never judges how bad something is.

## Output

- **Where the info comes from:** the technician posts the WDIR inspection
  in the inspection findings Slack channel like any other finding, with
  the customer ID and his photos, and "WDIR" (or "wood destroying") in
  the text. Any technician can do these.
- **The report PDF:** form pages 1-2 (front and "Conditions Governing This
  Report"), filled, with Daniel's signature on "Signature of Authorized
  Company Rep" (a private file in the office Drive, never in the repo).
  Then the technician's photos on added pages ("Photographs", two per
  page, numbered and captioned, with the address, inspection date and file
  number). The addendum page ("Wood Destroying Organism Inspection Report
  Addendum") is added only when a description doesn't fit its box (its
  box then says "See addendum."). The graph page is not used: we provide
  photos, not a graph. Remarks always says which pages the photos are on.
- **An email to the office** (office@catchypestsolutions.com, from
  "Catchy Pest Solutions") with the PDF attached: the office forwards it
  to the agent / customer. Subject: "Wood-Destroying Insect Report –
  <address>". The body is written for the person it's forwarded to: a
  one-line intro, a short summary of the findings (the report's own
  words), and, when anything was found (A-D or conducive conditions):
  "If you'd like a quote to address these findings, reply to this email
  or give us a call and we'll be glad to put one together." No prices and
  no sales pitch.
- **Logged** on the customer's Briostack Communications tab ("[WDIR
  REPORT] <address>") with the PDF attached, and a row on the Leads sheet
  ("WDIR report sent", no bonus). The tech's thread gets "WDIR report for
  Jane Smith is done and emailed to the office to send out. Thanks Joey!"
- **Test mode / samples:** every page is stamped "TEST" or "SAMPLE - NOT AN
  OFFICIAL REPORT"; the live send refuses a stamped report.
- The purchaser's signature and "Date Acknowledged" (page 2) stay blank:
  the closing agent gets those signatures.
- **No quote goes to the customer** from a WDIR post (the email offers
  one). A separate regular findings post for the same visit is quoted as
  usual.

## Every report

| Field | Value |
|---|---|
| Firm | Catchy Pest Solutions |
| PCO Lic No. | 2592PW |
| Address | 1854 Hendersonville Rd, Suite A8, Asheville, NC 28803 |
| Telephone | (828) 263-4804 |
| Title | General Manager |
| Signature | Daniel Wilde's e-signature: a private file in the office Google Drive (config `wdir.signatureDriveFileId`), never in the repo |
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

## The decision (decisions.json)

```
{ "ts": "<post ts>", "action": "wdir",
  "wdir": {
    "sellers": "", "buyers": "",                      // "" prints "Not provided"
    "otherStructures": "",                            // "Main residence and detached garage" checks B instead of A
    "atticInspected": false,                          // true only when the tech says he inspected it
    "inaccessibleExtra": "Crawl space partially obstructed by ductwork at the rear.",
    "termites": { "box": 2, "location": "Signs of termites observed: mud tubes on the foundation wall, right rear crawl space. See photos 1-2." },
    "termitesNote": "",                               // only with termites null: previous treatment / spot drill holes
    "powderPostBeetles": null,                        // { "box": 2|3, "location": "..." }
    "oldHouseBorers": null,
    "others": { "type": "Carpenter bees", "box": 2, "location": "Signs of carpenter bee burrows observed in the front porch fascia. Treatment is recommended. See photo 3." },
    "conducive": ["Wood-to-ground contact at the back porch steps (photo 4).", "Siding-to-ground contact along the left side of the home."],
    "remarks": ["Inspection requested by Blue Ridge Home Inspections."],
    "treatedByUs": false                              // true only to allow box 1 (we treated, in Briostack)
  },
  "photos": [{ "index": 1, "caption": "Mud tubes on the foundation wall, right rear crawl space." }, ...],   // every photo, in order: Photo 1, 2, ...
  "alsoPosts": [{ "ts": "<the tech's next post with more photos>" }],                                      // optional; photos from it: { "ts", "index", "caption" }
  "reason": "" }
```

Box 4 (no visible evidence) and box 5 (conducive conditions) are set by
the script from A-D and `conducive`. The scripts refuse: a box other than
1-3, box 1 without `treatedByUs`, D other than carpenter bees/ants or D
box 3, `termitesNote` next to a checked A, a missing photo or caption, a
"photo N" that doesn't exist, and the words damage, active, inactive,
activity, live, dead, infested, minor, extensive, severe or structural in
our text.

When something needed isn't in the post (powder post beetles or old house
borers without active/inactive, which building, where in the house):
`"action": "ask"` with one short question in the thread, as with any
finding. The report goes out on the run after he answers.

## Still to decide

- South Carolina (CL-100) after NC works.
