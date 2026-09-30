# Same-address cross-sell scheduling check

Final step for the daily routine. Given the customers with appointments
scheduled today, checks whether any of them have another active service at
the same address that's due or coming due, with no technician assigned yet,
so the office can add it to today's route.

## How it plugs into the daily routine

1. Earlier steps already resolve which customers have an appointment today
   and have their `customerId`s.
2. Run: `node src/cli.js <customerId> [<customerId> ...]`
   (or pipe a JSON array of customer IDs on stdin).
3. The script prints a JSON result: `{ opportunities, diagnostics, slackMessage, slackChannelId }`.
4. If `slackMessage` is non-null, send it to `#office-only` (channel ID in
   `slackChannelId` / `SLACK_CHANNEL_ID` env var). If it's `null`, send nothing.
   Sending itself happens via the routine's Slack connector — this script
   only produces the message text, it does not call Slack.

## Setup

Copy `.env.example` to `.env` at the repo root and fill in:

- `BRIOSTACK_BASE_URL` — `https://catchypestsolutions.briostack.io/rest/v1/`
- `BRIOSTACK_API_KEY`
- `SLACK_CHANNEL_ID` — `#office-only`'s channel ID

## Findings from live-API verification

These were unknowns going in; all confirmed against the real Briostack API
(not assumed from docs), since several of them contradicted the initial spec:

- **Auth**: `X-Api-Key: <key>` header. `Authorization: Bearer` and other
  header/query-param variants return 403.
- **Filtering**: The top-level collection endpoints (`/services`,
  `/appointments`) silently ignore `customerId`, `page`, `offset`, and date
  query params — they always return the same default page. Only the nested
  `/customers/{id}/services` and `/customers/{id}/appointments` routes
  actually filter server-side. This client always uses the nested routes.
- **`CSC_ACTIVE`** is a real, correct status value for an active service.
- **`recommendedDate` does not exist on the Service schema at all.** It lives
  on the **Appointment** record, not the Service record, as the spec
  suspected might need checking. `nextAppointmentDate` lives on the Service
  record, as expected.
- **When they disagree**, `nextAppointmentDate` (service) consistently
  matches the actually-scheduled `appointmentDate` on the pending
  appointment; `recommendedDate` can be an earlier, superseded "ideal" date
  that no longer matches what's actually on the schedule. The implementation
  prefers `nextAppointmentDate` and only falls back to `recommendedDate` when
  `nextAppointmentDate` is empty, and logs a diagnostic whenever the two
  disagree so this stays visible if the pattern ever changes.
- **Technician assignment lives on the Appointment record**, not the
  Service record, as `primaryTechnicianId`.
- **"Unassigned" is represented by the complete absence of the
  `primaryTechnicianId` key** on the appointment JSON object — not `null`,
  not `""`, not the literal string `"Unassigned"`. Confirmed across 13 real
  pending appointments (10 unassigned / 3 assigned in the sample).
- **Pending/upcoming appointments have `statusId: "SVC_TICK_ACTIVE"`**
  (`status: "Open"`). Historical ones use `SVC_TICK_COMPLETED`,
  `SVC_TICK_CANCELLED`, `SVC_TICK_RESOLVED`, or `SVC_TICK_SKIPPED`.
- **Address** lives on the Appointment record as a structured
  `serviceAddress` object (`address`, `city`, `stateOrProvince`,
  `postalCode`, ...) — the Service record has no address field at all, so
  same-address comparisons are done between appointments' `serviceAddress`,
  not customer-level address.
- **Dates are plain `YYYY-MM-DD` strings with no time/timezone component**,
  so the only timezone-sensitive part of this feature is computing "today"
  in US/Eastern (`Intl.DateTimeFormat` with `timeZone: 'America/New_York'`);
  date comparisons themselves are plain calendar-day arithmetic.
- One service was seen with `statusId: "CSC_PENDING"` — a status not
  mentioned in the spec. Per the spec's exact wording, only `CSC_ACTIVE`
  qualifies, so `CSC_PENDING` services are excluded; flagging this in case
  the business actually wants those included too.

## Testing

- `npm test` runs the automated suite (`test/crossSellCheck.test.js`) against
  a mocked Briostack client, covering all 7 required scenarios plus edge
  cases surfaced during live verification (boundary of the 30-day window,
  missing pending appointment, `nextAppointmentDate`/`recommendedDate`
  conflict, non-active service statuses, same-category exclusion).
- `node test/live-smoke-test.js <customerId> ...` runs the real logic against
  the live API for given customers and prints diagnostics/opportunities/Slack
  message without sending anything. Verified against real customers `12025`
  and `12506` (today's real completed appointments) — correctly found and
  excluded an out-of-window service and correctly flagged the
  `nextAppointmentDate` vs `recommendedDate` conflict on real data.

# Daily call review

Weekday noon routine: pulls the ATS call log since noon on the previous
business day, finds missed inbound calls nobody has returned, creates a
Briostack callback task for each caller, and builds two Slack messages (the
#office-only callback list and the owner's daily call report).

- Run: `node src/callReview/run.js [--dry-run] [--now=ISO]`
- Routine instructions to paste: `CALL_REVIEW_ROUTINE_PROMPT.md`
- Office setup (extensions, lunches, queues, who gets which task):
  `src/callReview/config.js`
- Needs `ATS_USERNAME`, `ATS_PASSWORD` and `BRIOSTACK_API_KEY` in the
  environment.

How ATS data maps to "missed" is documented at the top of
`src/callReview/callAnalysis.js`. Briostack phone lookup and task creation
are still being verified against the live API (see
`src/callReview/briostack.js`).
