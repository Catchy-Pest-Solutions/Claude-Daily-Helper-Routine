# CATCHY DAILY SUMMARY — DAILY ROUTINE

Pulls everything from the Briostack API (no reports from Steve B). Includes the
tech heads-up for same-address add-on services.

## Purpose

Each workday morning: pull today's schedule and recent trapping visits straight
from the Briostack API, post the technician briefing to #catchy-company, post a
heads-up in each tech's office channel when the office is adding a same-address
service to their route, post one combined office check-list to #office-only,
create Briostack tasks for trap reevaluation calls and same-day add-ons, and — on
the last workday before a weekend or holiday — post a trap close-out message to
#technicians. All times are Eastern (America/New_York).

Steve B no longer sends the Appointment Detail or Completion Detail CSV reports.
Do not look for them, wait for them, or ask him for them.

Never commit, push or edit repo files during a scheduled run. Never write
customer data or credentials into the repo. Work in a scratch folder.

---

## PART 0 — GROUND RULES

- Use bash + curl for every Briostack API call (never WebFetch — it can't send
  the API key header). Always send the key from the environment:
  `-H "X-API-KEY: $BRIOSTACK_API_KEY"`. Never write the key itself into
  commands, messages, or files.
- **Filtering** (tested and working): pass a `filter=` query parameter,
  URL-encoded with `curl -G --data-urlencode`.
  - Text and date values go in double quotes: `appointmentDate="2026-10-05"`
  - Operators: `= <> < <= > >=` (NOT `!=` or `==`, which cause errors)
  - Combine conditions with: `and`
  - Date fields (appointmentDate) take `"YYYY-MM-DD"`. Date-time fields
    (createdDate, modifiedDate) need a full timestamp with offset, e.g.
    `"2026-10-05T00:00:00-04:00"`.
  - A response that is a JSON object with `"message"` or `"code"` instead of a
    list means the call failed.
- **Paging:** list endpoints return at most 100 records. Send `limit=100` and
  `sort-by=appointmentId` (or the matching id field), start at `start=0`, and if
  exactly 100 come back, call again with `start=100`, `start=200`, and so on
  until fewer than 100 come back.
- NEVER use the top-level `GET /services` or `GET /services/{serviceId}`
  endpoints. Their nextAppointmentDate values disagree with the customer's own
  service list. Always use `GET /customers/{customerId}/services` instead.
- **Appointment status groups** (use these everywhere below):
  - OPEN = `SVC_TICK_ACTIVE`
  - DONE = `SVC_TICK_COMPLETED`, `SVC_TICK_RESOLVED`, `SVC_TICK_SUBMITTED` (all
    mean the visit was serviced)
  - NOT HAPPENING = `SVC_TICK_CANCELLED`, `SVC_TICK_SKIPPED`,
    `SVC_TICK_DEACTIVATED` (never count these for anything)
- Unassigned appointments may have `primaryTechnicianId` missing from the record
  entirely, not just empty. Treat missing, null and empty the same.
- Briostack's API does NOT return technician appointment notes. Never claim to
  have checked notes — always ask the office (or techs) to check them in
  Briostack.
- **The trapping category has two names.** "Wildlife / Rodent Trapping Service"
  (current) and "Live Trapping Wildlife Service" (older) are the SAME category,
  serviceCategoryId `11004`. Treat both as trapping. Traps are only ever put out
  under this category. Do NOT treat "HomeShield - Critter Control" (RODENT) as
  trapping.
- **Customer names:** build "First Last" from customerFirstName +
  customerLastName, skipping any part that is empty, null, or the text "null",
  and collapsing double spaces. Businesses usually have only a last name (e.g.,
  "Smoky Elk Rentals").
- **Addresses:** when comparing, ignore capitalization, extra spaces, and
  trailing punctuation (e.g., "223 rocky top ln" = "223 Rocky Top Ln"). Street,
  city, state and zip must all match. Addresses are in serviceAddress: address,
  city, stateOrProvince, postalCode.
- **Time zones:** Briostack returns timestamps (createdDate, modifiedDate, task
  dates) in Mountain time (-06:00 or -07:00). Convert to Eastern before
  comparing or showing them. appointmentDate is a plain date, and arrivalFrom /
  arrivalThru are already local wall-clock times — use them as-is.
- **No duplicates:** this routine may run several times in one morning
  (retries). Before sending ANY message or creating ANY task, check whether it
  was already done today (see each step) — never send duplicates.
- #catchy-company is the intended destination for the tech summary even though
  it's a public, company-wide channel — do not redirect it elsewhere.

---

## PART 1 — REFERENCE

### People (Slack ID / Briostack employee ID)

- Daniel W. (owner — does NOT service appointments): Slack `U09LQDUPQTC` /
  Briostack `12883`
- Steve B (office): Slack `U09NNDKSB4M` / Briostack `16635`
- Shelley (office — handles current-customer flow): Slack `U09NPRFAENS` /
  Briostack `16195`
- "Leads Nurture" (Briostack `18677`) is a placeholder for leads, not a person.
  Ignore its appointments.

### Field technicians (match on primaryTechnicianId)

| Briostack ID | Tech | Slack tag | Office channel |
|---|---|---|---|
| 15783 | Aaron W. | `<@U09NRTFNAG2>` | #aaron-office `C09P95DKL5A` |
| 17047 | Steve H. | `<@U0A6N1FUYG3>` | #hayden-steve-office `C0A6UU134M8` |
| 17829 | Dustin M. | `<@U0B4DP8PJ59>` | #dustin-office `C0B4QMAQAQN` |
| 17907 | Max R. | `<@U0B73RK14N4>` | #max-office `C0B9EJ75TKK` |
| 15724 | Sidney M. | `<@U0BCZ2CK6PN>` | #sidney-office `C09P95KKVJ8` |
| 19570 | Joey J. | `<@U0C6QBF7491>` | #joey-office `C0C6WR9TER0` |

Tech section order: Aaron W., Steve H., Dustin M., Max R., Sidney M., Joey J.

### Channels

- Daniel self-DM: `D09LU04BYJY` (sending a DM to `U09LQDUPQTC` lands here)
- #catchy-company: `C09LQDV5PA6`
- #office-only: `C09LNB93MQW`
- #technicians: `C09LU09RHA8`
- Tech office channels (private: one tech + the office team): see the
  technician table above.

### Briostack API

Base URL: `https://catchypestsolutions.briostack.io/rest/v1/`

Set up each bash call with:

```
B=https://catchypestsolutions.briostack.io/rest/v1
H="X-API-KEY: $BRIOSTACK_API_KEY"
```

**A. Today's schedule (Step 1):**

```
curl -s -G -H "$H" "$B/appointments" --data-urlencode 'filter=appointmentDate="YYYY-MM-DD"' --data-urlencode 'limit=100' --data-urlencode 'start=0' --data-urlencode 'sort-by=appointmentId'
```

Each record has: appointmentId, appointmentDate, statusId, appointmentTypeName,
serviceId, customerId, customerFirstName, customerLastName, serviceCategoryId,
serviceCategoryName, primaryTechnicianId, primaryTechnicianFirstName,
primaryTechnicianLastName, serviceAddress, arrivalFrom, arrivalThru.

**B. Trapping visits since the last business day (Step 2):**

```
curl -s -G -H "$H" "$B/appointments" --data-urlencode 'filter=serviceCategoryId="11004" and appointmentDate>="LAST-BUSINESS-DAY" and appointmentDate<"TODAY"' --data-urlencode 'limit=100' --data-urlencode 'start=0' --data-urlencode 'sort-by=appointmentId'
```

**C. One service's full visit history (Steps 4, 5, 6):**

```
curl -s -G -H "$H" "$B/customers/{customerId}/appointments" --data-urlencode 'filter=serviceId="{serviceId}"' --data-urlencode 'limit=100' --data-urlencode 'sort-by=appointmentId'
```

**D. A customer's services (Steps 4B, 5):**

```
curl -s -H "$H" "$B/customers/{customerId}/services"
```

Use: serviceId, statusId, serviceCategoryId, serviceCategoryName,
nextAppointmentDate, primarySalesRepId, primarySalesRepName.

**E. Has this task already been created today? (Steps 4B, 5B):**

```
curl -s -G -H "$H" "$B/tasks" --data-urlencode 'filter=createdDate>="YYYY-MM-DDT00:00:00OFFSET" and title="EXACT TASK TITLE"'
```

OFFSET is today's Eastern offset from: `TZ=America/New_York date +%:z` (gives
-04:00 or -05:00). An empty list `[]` means it hasn't been created yet.

**F. Create a task (Steps 4B, 5B):** POST `"$B/tasks"` with `-H "$H"
-H "Content-Type: application/json"` and a JSON body. Do NOT send
partyRoleTypeId — Briostack rejects it as read-only and sets it to CUSTOMER
automatically.

**Quota:** ~300–500 calls/day. A normal run uses ~50–80. Only call what you
need, and reuse responses within the run (e.g., don't fetch the same customer's
services twice).

### Service category codes (short names for messages)

- `GPCONETIME` = HomeShield - Signature Pest Control ("HomeShield Signature")
- `RODENT` = HomeShield - Critter Control ("HomeShield Critter")
- `TERMSRV` = Carolina TermiteShield ("Termite")
- `BEDBUGSRV` = Bed Bug Service ("Bed Bug")
- `11004` = Wildlife / Rodent Trapping Service, a.k.a. Live Trapping Wildlife
  Service ("Wildlife/Rodent")
- `12501` = Inspection / Consultation ("Inspection")
- `12504` = One Time Service ("One Time")
- `12505` = Mosquito Plus ("Mosquito Plus")
- `12503` = Leads Marketing, `12506` = Quote - Signature Pest, `12507` = Quote -
  Critter Control (normally under Leads Nurture; ignored)
- For any other code, use serviceCategoryName.

### Company days off (holidays)

- New Year's Day (Jan 1)
- Memorial Day (last Monday of May)
- Independence Day (July 4)
- Labor Day (first Monday of September)
- Thanksgiving Day (4th Thursday of November)
- Black Friday (the day after Thanksgiving)
- Christmas Eve (Dec 24)
- Christmas Day (Dec 25)

Weekend rule for fixed-date holidays (Jan 1, July 4, Dec 24, Dec 25): if the
holiday falls on a Saturday, the day off is the Friday before; if it falls on a
Sunday, the day off is the Monday after. If that moved day lands on another
holiday, Christmas Eve moves to the workday before, and any other holiday moves
to the workday after. (Examples: Christmas on a Saturday → Christmas off Fri Dec
24, Christmas Eve off Thu Dec 23. Christmas Eve on a Sunday → Christmas Eve off
Fri Dec 22, Christmas off Mon Dec 25.) All other holidays are regular workdays.

### Workday definitions

- **Workday** = Monday–Friday that is not a company day off.
- **Last business day** = the most recent workday before today (e.g., on a
  Monday it's Friday; on the Monday after Labor Day it's the Friday before).
- **Next workday** = the first workday after today.
- **Last workday before a break** = today is a workday AND the next calendar day
  is not a workday (a Saturday or a company day off). Examples: every normal
  Friday; the Wednesday before Thanksgiving; the workday before Christmas Eve.

---

## PART 2 — GET TODAY'S DATA

### Step 0 — Is today a workday?

If today is a Saturday, Sunday, or company day off, stop immediately and send
nothing.

### Step 1 — Pull today's schedule

Call Reference A for today's date, paging until you have every appointment.
Retry a failed call up to 3 times (wait about 2, 5, then 10 seconds). Treat it
as a failure if it returns an error, or if it returns zero appointments (a
normal workday has 50+). If it still fails:

- Before 8:45 AM → use ScheduleWakeup to retry in 10 minutes, then stop. (If
  ScheduleWakeup isn't available, do the 8:45 step below now.)
- 8:45 AM or later → DM Daniel (`U09LQDUPQTC`), then stop: "The daily
  technician briefing was not sent today. The Briostack API didn't return
  today's schedule ([error]). Please check Briostack and re-run the routine
  manually."

### Step 2 — Pull trapping visits since the last business day

Call Reference B, with LAST-BUSINESS-DAY = the last business day and TODAY =
today's date. This covers any Saturday work automatically. Keep only DONE
visits.

If this call fails after 3 retries, skip the left-trap check (Step 6), carry on
with everything else, add the skipped note to the office message (Step 9), and
DM Daniel: "The Briostack API didn't return recent trapping visits ([error]), so
today's left-trap check was skipped."

---

## PART 3 — SORT TODAY'S APPOINTMENTS

### Step 3 — Sort the Step 1 appointments into these lists

**3a. Tech appointments** — primaryTechnicianId is a field tech in the
Reference table; statusId is OPEN; appointmentTypeName is NOT "Place Holder".

- "Initial" = appointmentTypeName is "Initial" or "Initial / One Time Visit".
- Arrival window = arrivalFrom / arrivalThru from the same record (24-hour
  HH:MM:SS → 12-hour, e.g. 14:00:00 → 2:00 PM). If both are empty, that
  appointment has no arrival window. No extra API calls are needed for windows.

**3b. Daniel W. appointments** — primaryTechnicianId is 12883 and statusId is
not NOT HAPPENING. Record customer, appointmentId, category, status. These are
NOT included in the tech summary. Daniel does not service appointments, so the
office must fix these (billing not set up, or never assigned to a real tech).

**3c. Unassigned trapping appointments** — serviceCategoryId is 11004, statusId
is not NOT HAPPENING, and primaryTechnicianId is empty. Record customer,
appointmentId, serviceId, customerId, and address.

**3d. All of today's trapping appointments** — every trapping (11004)
appointment whose statusId is not NOT HAPPENING, whatever its technician (field
tech, Daniel, or unassigned). Used in Steps 4, 4B, 6, 8 and 9.

**3e. Unknown technicians** — any appointment whose statusId is not NOT
HAPPENING and whose primaryTechnicianId is set but isn't a field tech, Daniel
(12883), or Leads Nurture (18677). Leave these out of the tech summary and DM
Daniel one line: "Unknown technician in today's schedule: [First Last]
(Briostack ID [id]), [N] appointments — please add them to the routine's
technician table." Before sending, check `D09LU04BYJY` for the same note today,
and don't send it twice.

---

## PART 4 — BRIOSTACK LOOKUPS

### Step 4 — Trap day counts (for every appointment in list 3d)

Call Reference C with the appointment's customerId and serviceId. This returns
only that trapping job's visits, so old trapping services and other addresses
are already excluded. Confirm that today's appointmentId is in that list. If it
isn't, or the call fails, skip the count and add the appointment to Office
Section C ("couldn't verify trap history").

Count:

- Completed = DONE visits dated before today
- Remaining = OPEN visits dated after today
- Next visit = the earliest of those remaining visits (if any)
- NOT HAPPENING visits never count
- Day X = Completed + 1
- Of Y = Completed + 1 + Remaining

(Example: 1 completed, today, 4 more → Day 2 of 6.)

- If Y went up since earlier in the job (e.g., "Day 6 of 14" instead of "Day 6
  of 7"), that means another round of trapping was approved — nothing special
  to do.
- If Remaining = 0 → today is the LAST scheduled visit (see the LAST DAY wording
  in Step 7, and the reevaluation task in Step 4B).
- If Completed = 0 → today is the setup day (Day 1).

**Unclosed past visits:** any OPEN visit on this service dated BEFORE today was
never completed or cancelled (a tech couldn't complete it, or it wasn't
assigned). Do not count it. Add it to Office Section C with the customer, the
date(s), and the assigned tech.

Save each job's results (tech, customer, address, Day X of Y, next visit date,
last-day flag, setup-day flag) for Steps 4B, 7, 8 and 9.

### Step 4B — Create Briostack tasks for trap reevaluation calls

For every job in list 3d with Remaining = 0 (any assignee, including unassigned
or Daniel-assigned), create one Briostack task. **This is a task only — do not
mention it in any Slack message.** The office works it from their Briostack task
list.

1. **Find the assignee.** Call Reference D for the customer, pick the service
   whose serviceId equals the job's serviceId, and read primarySalesRepId. If it
   is blank, missing, or 12883 (Daniel W, who doesn't work the office call
   list), use Steve B (16635).
2. **Check for a duplicate.** Call Reference E with the exact title below. If a
   matching task already exists today, don't create another. If the check itself
   fails, don't create the task, and DM Daniel (see below).
3. **Create the task.** Use Reference F. Send one POST per job, with a
   1.5-second pause between calls:
   - title: `"Trap Reevaluation Call — [First Last]"` (under 100 characters)
   - taskTypeId: `"CALL"`
   - groupId: `"SCHEDULING"`
   - statusId: `"ORDER_REQMNT_CREATED"`
   - partyId: customerId (as a string)
   - employeeId: the assignee's ID (as a string)
   - appointmentId: today's trap appointmentId (as a string)
   - startDate: today 09:00 Eastern and dueDate: today 17:00 Eastern, e.g.
     `"2026-10-05T09:00:00-04:00"` (offset from `TZ=America/New_York date +%:z`)
   - description:
     > Last scheduled trapping visit was today (Day X of Y) at [address]. Please
     > call the customer to reevaluate: 1. Are you still seeing or hearing any
     > activity? 2. Are you satisfied with the results? 3. Confirm the outcome:
     > close out, add another round, or move on to exclusion. Check the tech's
     > last-day notes in Briostack before calling.

If a task can't be created, or the duplicate check fails, don't stop the
routine. DM Daniel (`U09LQDUPQTC`): "Couldn't create the Trap Reevaluation task
for [customer]: [error]. Please add it manually."

Never create tasks for jobs that aren't on their last scheduled visit, and never
edit or delete existing tasks.

### Step 5 — Same-address services due (cross-check)

For every customer with at least one list-3a appointment that is NOT trapping
(11004):

Call Reference D. Keep only services where statusId is exactly `CSC_ACTIVE`
(exclude `CSC_PENDING` and every other status), AND:

- the service is not trapping (serviceCategoryId `11004`). Trapping runs as a
  planned series of visits and is never a same-day add-on, and
- the service's category is not the category of any of this customer's
  appointments today (any tech, statusId not NOT HAPPENING), and
- the service doesn't already have an appointment today (its serviceId isn't on
  any of today's appointments that aren't NOT HAPPENING) — it's already on the
  route.

Use nextAppointmentDate as the due date; if it's missing, skip the service. A
service qualifies if it's due today or earlier, or within the next 30 days.
Exception: if the qualifying service is Mosquito Plus (12505), it only qualifies
if it's past due or due within the next 3 days.

**Due phrase** (used in Steps 5B, 7B and 9): "past due" if the due date is
before today, "due today" if it's today, "due tomorrow" if it's tomorrow,
otherwise "due in N days". Never write "1 days".

For each qualifying service, call Reference C for that serviceId (one record is
enough) and compare its serviceAddress to the address of today's appointment.
Keep the service only if the addresses match. Record the customer name, address,
today's tech (ID and name) and category, the service category name, and the due
date.

### Step 5B — Create Briostack tasks for same-day add-on services (Section F)

For every customer with at least one service in the Step 5 results, create one
task per customer. If a customer has two qualifying services, list both in the
same task.

- **Assignee:** always Shelley (employeeId 16195). She handles current-customer
  flow. Do NOT use primarySalesRepId, and never assign these tasks to Steve B.
- **Check for a duplicate.** Call Reference E with the exact title below. If it
  already exists today, don't create another — report it as "(task created for
  Shelley)". If the check itself fails, don't create the task, and report "(task
  NOT created, please add manually)".
- **Create the task.** Use Reference F. Send one POST per customer, with a
  1.5-second pause between calls:
  - title: `"Add Same-Day Service — [First Last]"` (under 100 characters)
  - taskTypeId: `"APPOINTMENT_REVIEW"`
  - groupId: `"SCHEDULING"`
  - statusId: `"ORDER_REQMNT_CREATED"`
  - partyId: customerId (as a string)
  - employeeId: `"16195"`
  - appointmentId: today's appointmentId for that customer (as a string)
  - startDate: today 09:00 Eastern and dueDate: today 17:00 Eastern, as in
    Step 4B
  - description:
    > [Tech] is already at [address] today for [today's category]. This customer
    > also has [service category] due [date] ([due phrase]). Please
    > add it to today's route. The tech has been notified in their office
    > channel to expect it and complete it while on site.

    If there are two services, list both lines.

Report the result in Section F. Add "(task created for Shelley)" to each
customer's line. If the call failed, add "(task NOT created, please add
manually)" instead.

If any task call fails, don't stop the routine. Post as usual, and DM Daniel
(`U09LQDUPQTC`): "Couldn't create the Briostack task for [customer]: [error]."
Never edit or delete existing tasks.

### Step 5C — Prepare the tech heads-up for same-day add-on services (sent in Step 7B)

For every customer in the Step 5 results, prepare one message for the office
channel of the tech who has today's appointment at that address (see the
technician table). One message per customer. If a customer has two qualifying
services, list both in the same message. The office is adding the service to
today's route either way, so the message is sent whether or not the Step 5B task
was created.

---

## PART 5 — LEFT-TRAP CHECK

### Step 6 — Trapping visits since the last business day

Use the DONE visits from Step 2 (skip this step if Step 2 failed). For each
unique serviceId, use its most recent DONE visit:

- If today's schedule (Step 1) has an appointment on the same serviceId whose
  statusId is not NOT HAPPENING (any tech, or unassigned) → no alert. That job
  continues today; its day count is already covered by Step 4.
- Otherwise → call Reference C for that customerId and serviceId. Count the OPEN
  visits dated after today, and count all DONE visits (for "visit N of N"):
  - **0 remaining** → FINAL VISIT COMPLETED: add to Office Section A.
  - **1 or more remaining** → look at the earliest remaining visit's
    primaryTechnicianId:
    - If it's a field tech from the Reference table → **no alert.** The office
      has already planned the next visit, even if it skips a day.
    - If it's empty/missing or 12883 (Daniel W.) → NEXT VISIT UNASSIGNED: add to
      Office Section B with the next visit date. Traps may still be on site and
      nobody is set to check them.
- Also check for unclosed past visits on this service (as in Step 4) and add any
  to Section C.

For the tech name, use the visit's primaryTechnicianId with the Reference table;
if it isn't in the table, use primaryTechnicianFirstName + LastName.

---

## PART 6 — SEND THE MESSAGES

Send in this order: Step 7 (tech summary), then Step 7B (add-on heads-ups in tech
office channels), then Step 8 (#technicians, if it applies today), then Step 9
(office message). Don't wait between them.

### Step 7 — Tech summary → #catchy-company (`C09LQDV5PA6`)

**Duplicate check:** if #catchy-company already has today's "Daily Summary —
[Today's Full Date]" message, skip this step.

Techs read this on the Slack mobile app, so keep it short and mobile-friendly.
Build one section per tech in the Reference order from list 3a, with trap counts
from Step 4. A tech with no appointments gets a single line:
"👷 MAX R. <@U0B73RK14N4> — No appointments today".

Format:

```
🌅 Good Morning, Team! Daily Summary — [Today's Full Date]
━━━━━━━━━━━━━━━━━━━━━━━━
👷 AARON W. <@U09NRTFNAG2> — [N] Appointments
By Category:
• [Category]: [count]          ← highest to lowest
Initial Appointments: None     ← or one line each: 🆕 [Customer Name] — [Category] ⏰ [Window if any]
Arrival Windows: None          ← or one line each: ⏰ [Customer Name] ([Category]) — [Start] – [End]
Trap Checks:                   ← only if the tech has trapping appointments today
🪤 [Customer Name] — Day [X] of [Y]
🪤 [Customer Name] — Day [X] of [Y]
⚠️ LAST DAY: remove ALL traps + note removal status & whether more trapping is recommended
━━━━━━━━━━━━━━━━━━━━━━━━
[Repeat for Steve H. <@U0A6N1FUYG3>, Dustin M. <@U0B4DP8PJ59>, Max R. <@U0B73RK14N4>, Sidney M. <@U0BCZ2CK6PN>, Joey J. <@U0C6QBF7491>]
━━━━━━━━━━━━━━━━━━━━━━━━
🔄 Reminder: Please refresh Briostack before you leave the office each morning as we make final tweaks for your day.
```

Notes:

- Show customer names as "First Last". Use the short category names from the
  Reference (e.g., "HomeShield Signature", "Wildlife/Rodent").
- If one customer has two appointments today, add the street name to tell them
  apart.

### Step 7B — Add-on service heads-up → each tech's office channel

Send the messages prepared in Step 5C to the tech's office channel from the
technician table (e.g., Steve H. → #hayden-steve-office `C0A6UU134M8`). Never
post these in #catchy-company, #technicians, or a direct message.

**Duplicate check:** read that channel's messages from today; if one already
contains "also has" and the customer's name, skip it. Pause 1.5 seconds between
messages.

Format:

```
<@[tech Slack ID]> Heads-up: [Customer Name] at [Address] also has [Service category short name] ([due phrase]). You're already going there today for [today's category], so the office is adding that service to your schedule for today. Please refresh Briostack, look for the new appointment, and complete that service while you're on site. Let us know if you have any questions.
```

(If two services: "...also has [Service 1] ([due phrase]) and [Service 2] ([due
phrase]). You're...". Example: "also has Termite (due in 16 days)." — "due"
appears only once.)

If a send fails, don't stop the routine. Add "(tech NOT notified, please message
them)" to that customer's Section F line instead of "(tech notified in
#[channel])", and DM Daniel (`U09LQDUPQTC`): "Couldn't post the add-on heads-up
for [customer] in #[channel]: [error]."

### Step 8 — Trap close-out message → #technicians (`C09LU09RHA8`)

Only send this if today is the LAST WORKDAY BEFORE A BREAK (see Workday
definitions), e.g. a normal Friday or the Wednesday before Thanksgiving.

**Duplicate check:** if #technicians already has today's "Trap Close-Out"
message, skip this step.

Use the Step 4 results for every job in list 3d. Skip the message if there are
no trapping jobs today. For each job:

- REMOVE: the last-day flag is set (no visit booked after today).
- CLOSE: a next visit is booked; show its date.
- If the job is on its setup day (Day 1), add the setup-day note shown below.
- Tag the assigned tech. If the job is unassigned or under Daniel, write
  "(unassigned — office assigning)" instead of a tag.
- Group the jobs by tech, in the Reference order.

Format:

```
🪤 Trap Close-Out — [Today's Day & Date]
[Break reason, e.g. "Heading into the weekend" / "Heading into Thanksgiving break — next workday is Monday, Dec 1"]

REMOVE all traps if no visit is booked after today. Check the company daily summary: if your job shows "⚠️ LAST DAY," all traps come out.
CLOSE traps if the next visit is already booked (date shown). Check the previous tech notes in Briostack for trap count and locations so every trap gets closed.

<@U09NRTFNAG2>
• [Customer] — [Address] — 🔴 REMOVE all traps (Day [X] of [Y], last day)
• [Customer] — [Address] — 🟡 CLOSE traps — next visit [date]
  [Setup-day jobs add:] ↳ Just set up today. We sometimes work Saturdays, so double-check with the office whether someone is working tomorrow before closing.

<@U0A6N1FUYG3>
• ...
```

### Step 9 — Office message → #office-only (`C09LNB93MQW`)

Send it after Steps 4–7B are done.

**Duplicate check:** if #office-only already has today's "Office Daily Check —
[Today's Date]" message, skip this step.

Send ONE message. Include only the sections that have content. If every section
is empty (and the left-trap check wasn't skipped), send nothing.

The letters A–F are internal labels used in these instructions only. **Never
show the letters in the Slack message** — each heading is just the emoji and the
title, exactly as in the format below.

Section order (top to bottom): F, E, A, B, C, D.

Trap reevaluation calls (Step 4B) are Briostack tasks only and do NOT appear in
this message.

- Section A — keep the close-out checklist to ONE shared instruction line for
  the whole section (not repeated per customer); list each qualifying job as a
  single bullet underneath.
- Bold customer names in every section bullet for scannability.

Format:

```
📋 Office Daily Check — [Today's Date] <@U09NPRFAENS> <@U09NNDKSB4M>

➕ Other Services Due at Same Address (Shelley)              ← Section F
• [Customer] — [Address] — [Service category] due [date] ([due phrase]). Please add it to today's route; the tech has been told to expect it. (task created for Shelley) (tech notified in #[channel])

👤 Appointments Under Daniel W.                               ← Section E
• [Customer] — [Category] (Appt [Id]). Daniel doesn't service appointments; please fix billing or assign a technician.

🪤 Final Trap Visit Completed — Close-Out Checklist          ← Section A
For each job below, please check in Briostack: all traps removed (cage, mole, kill), the animal removal status and whether continued trapping is recommended are noted, any follow-up tasks the tech created, and — if another round is needed — book it (the count will show e.g. "Day 8 of 14").
• [Customer] — [Address] — visit [N] of [N] completed [date] ([Tech])

⏸️ Trapping Job — Next Visit Unassigned                      ← Section B
• [Customer] — [Address] — last visit [date] ([Tech]), next visit [date] is not assigned to a technician. Please assign it, and confirm whether someone needs to go by before then.

❗ Trap Visits Never Closed Out / Couldn't Verify            ← Section C
• [Customer] — [date] visit is still open in Briostack ([Tech or "unassigned"]). A tech may not have been able to complete it, or it wasn't assigned. Please check and close or cancel it.

📌 Unassigned Trapping Appointments Today                    ← Section D
• [Customer] — [Address] — Day [X] of [Y]. These are daily trap checks; please assign them to a tech working in the area today (not Daniel).

[If the left-trap check was skipped:]
⚠️ The Briostack API didn't return recent trapping visits, so today's left-trap check was skipped.
```

(The "← Section X" labels are for these instructions only — don't include them
in the message.)

### Step 10 — If anything failed

If a Briostack call fails or returns an error, don't stop the whole routine.
Post what you can (e.g., the summary without trap counts). Then DM Daniel
(`U09LQDUPQTC`) a one-line note saying what was skipped and why.
