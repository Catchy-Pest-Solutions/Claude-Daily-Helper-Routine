# Weekly commission payroll

Every Thursday at 6 PM Eastern a Claude Code routine works out the week's
commissions for Daniel to enter in QuickBooks Online, then (after he
approves) DMs each person their number in Slack.

- **Technicians, 6%:** every completed visit's
  `technicianCommissionableAmount`, pooled across the six field techs and
  split by time clock hours: `6% × (team production ÷ team hours) × hours`.
- **Office, 4%:** `salesCommissionableAmount` on completed Initial,
  Initial / One Time Visit, Inspection / Consultation, Treatment (termite
  jobs: pretreatments, treatments, station takeovers) and WDIR Inspection
  visits (Daniel, Nov 26), to the
  service's primary sales rep (Steve B, Shelley; Daniel shown, not DMed).
- **Pay period:** Friday–Thursday. Run early for a holiday and it ends
  that day (`--thru`).

| File | What it is |
|---|---|
| `ROUTINE_PROMPT.md` | The routine's instructions |
| `config.json` | Rates, initial types, techs (Briostack ID, Slack ID, time clock names), office reps |
| `collect.js` | Step 1: Briostack → `$S/production.json` |
| `split.js` | Step 3: `production.json` + `hours.json` (read from the time clock screenshots) → `payroll.md`, `dms.json` |
| `lib/commission.js` | The math, period and DM text (tested in `test/payroll.test.js`) |

## Briostack findings (Nov 24, 2026)

- `technicianCommissionableAmount` and `salesCommissionableAmount` are only
  on `GET appointments/{id}`. Every list endpoint (`/appointments`, and the
  customer, service and category nested ones) returns `AppointmentPartial`
  without them; `fields`/`expand` params are ignored and the amounts can't
  be filtered on. So: one list pull for the period, then one detail call
  per done visit (~300 a week; unlimited API tier since Nov 2026).
- `price` on the appointment is not production: recurring visits are $0
  there (billed on the plan).
- The sales rep isn't on the appointment; it's `primarySalesRepId` on the
  service (`customers/{id}/services`).
- Trapping (Wildlife / Rodent) initials currently carry $0 for both
  amounts.
- Appointments also have `timeIn`/`timeOut` (time on site), which is not
  clock hours; hours come from the time clock screenshots.

## Checked against last week (Nov 13–19)

Per-tech daily production matched Daniel's sheet to the dollar, except two
Thursday visits finished after he pulled the numbers. His sheet's daily
total column skipped the first tech column (Max R.), so it showed $23,254
for a week whose rows add to $28,404. Hours split for that week: $28,799
over 241.15 h → $1,727.95 to techs; office: Steve B $356.45, Shelley
$135.06.

## Running by hand

```
node payroll/collect.js --out /tmp/pay [--thru 2026-11-25]
node payroll/split.js --out /tmp/pay      # after writing /tmp/pay/hours.json
npm test
```
