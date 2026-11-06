# Inspection findings routine

Techs post findings from customers' homes to the private Slack channel
#inspection-findings (`C0CF6R073M4`). Every morning (Mon-Sat, 8 AM
Eastern) the routine turns each valid post into a quote: a text with a
quote card picture (scheduled for 10 AM) and an email with the stamped
photos and a PDF proposal, signed by the tech. It logs both on the
customer's Briostack Communications tab, creates a `BID_FOLLOWUP` task
due 1 PM, keeps the Leads sheet (bonuses), and on Thursdays sends Daniel
the pay-week bonus summary. The spec is `DESIGN.md`; the routine's
instructions are `ROUTINE_PROMPT.md`.

```
collect.js  -> posts.json (posts, photos, Briostack facts, prices)
  routine reads photos + text, writes decisions.json (words only)
render.js   -> stamped photos, quote card JPG, proposal PDF (Drive links)
send.js     -> text (10 AM) + email + Briostack log + task + sheet row
payroll.js  -> Thursday bonus summary (payroll.md, Slacked to Daniel)
```

| File | What it is |
|---|---|
| `DESIGN.md` | The agreed spec and Daniel's answers |
| `ROUTINE_PROMPT.md` | The routine's instructions and the decisions.json format |
| `KNOWLEDGE_BASE.md` | The only claims allowed in "Why it matters" (approved by Daniel Nov 6) |
| `config.json` | Test mode and recipients, techs (Slack ID -> Briostack ID), plans, prices, findings, bonuses, task settings, sheet IDs. No secrets |
| `lib/pricing.js` | Coverage, price tiers, exclusion rule, bonuses (pure, tested) |
| `lib/quote.js` | Decision checks and the numbers the messages use |
| `lib/slack.js` | Read-only Slack client (bot token) and post parsing |
| `lib/sheet.js` | The Leads sheet through the Drive API (CSV export/upload) |
| `setup-sheet.js` | Creates the Leads sheet and saves its ID in config.json |
| `templates/` | `photo.html` (stamp), `card.html` (1080x1350), `proposal.html` (letter PDF), `email.html` |
| `test/` | Unit tests (`npm test` in `daily-routine/`) |

It reuses `../lead-followup/lib` (Briostack, Google, Chromium, template
filler). Three methods were added to that Briostack client
(`findCustomersByPhone`, `createTask`, `listAppointmentsOn`); the
follow-up routine doesn't call them.

## Prices (computed, never typed)

`lib/pricing.js`, first match wins:

1. **Another active plan** on any of the customer's records (same primary
   phone): 50% off the initial fee (halves round up), discounted monthly.
2. **Only Inspection (12501) / One Time Service (12504)** in the last 60
   days: regular initial minus everything paid for those visits (scratched
   ones don't count), regular monthly. Example: $149 + $98 = $247
   credit, Critter Control without exclusion $447 - $247 = $200.
3. **Anyone else** (a completed plan, nothing active): 10% returning-
   customer discount on the initial fee only, price rounded up. For
   example: TermiteShield $797 -> $718 ($79 credit).

No annual commitment: +$50 on the initial. The discount is shown as a
credit good for 90 days; it is not entered in Briostack.

The routine only writes words. `render.js` and `send.js` refuse a decision
whose text quotes any price other than the computed initial fee (or the
credit), names the wrong weekday for the visit, mentions the 12-month plan
in the text, mentions AI, or quotes a covered plan, an open offer or a
Catchy Club customer.

## Setup notes (Nov 6, 2026)

- **Slack**: `SLACK_BOT_TOKEN` (bot "inspection_findings_r", scopes
  `channels:history,groups:history,files:read,users:read`). The bot must be
  in the channel (it is since Nov 6). Slack strips EXIF, so the photo stamp
  uses the post time. Messages to techs and Daniel go through the Slack
  connector (Daniel's account), not the bot.
- **Google**: office@'s token (`drive.file`, `gmail.send`,
  `gmail.readonly`). The **Sheets API is not enabled** on its Google Cloud
  project, so `lib/sheet.js` reads the sheet as CSV and writes it back
  through Drive (hand edits are kept: it re-reads before every write; a
  settled row's Bonus is never overwritten). Formatting resets on each
  write. Enabling the Sheets API would allow proper cell updates later.
- **Sheets**: test sheet `1xs8orQ7ot6Cqen05DESubJyphOQ_E5fiYebRcTIDlr4`
  (shared with dwilde@, moved by Daniel into "***Catchy Daily***"; moving
  it doesn't affect access). Create the live one with
  `node inspection-findings/setup-sheet.js --live`.
- **Briostack**: tasks can't carry an appointment ID (POST /tasks rejects
  unknown fields), so it goes in the description. `appointmentDate` filters
  work on `/appointments` (used for days worked).
- **Infographics**: Daniel's 7 infographics (office@ Drive folder
  "Infographics", PNG 1122x1402) are in `assets/infographics/` as 900x1125
  JPGs (~200 KB each), mapped in `config.json` `infographics`. They go in
  the email and PDF labeled "Example illustration, not a photo of your
  home." To replace one, overwrite the JPG with the same name.

## Test mode

Test recipients come from the environment, not the repo:
`INSPECTION_TEST_PHONE` (E.164, Daniel's cell) and `INSPECTION_TEST_EMAIL`.
`send.js` refuses to run in test mode without them.

`"testMode": true`: the text goes to the test phone with "TEST for
<name> (<numbers>):" on top, the email to the test email with "[TEST for
<name>]" in the subject, tasks go to Daniel W (12883) not Steve B, log
entries start `[INSPECTION FINDINGS — TEST, not sent to customer]`, rows go
to the test sheet, and a post with no matching visit falls back to the
customer's latest visit (`testAllowAnyVisit`) so older test posts work.

Try it without sending anything:

```
node inspection-findings/collect.js --out $S
node inspection-findings/render.js --posts $S/posts.json --decisions $S/decisions.json --no-upload
node inspection-findings/send.js --posts $S/posts.json --decisions $S/decisions.json --preview
```

## First live-API test (Nov 6, 2026)

Both of Daniel's test posts went through end to end in test mode: texts
(with the quote card) to the test phone, emails (photos inline, PDF
attached) to the test email, TEST entries on each customer's
Communications tab, a `BID_FOLLOWUP` task for Daniel W on each (Briostack
tasks 102075 and 102076), and two rows in the test sheet. A second run
returned `already_sent` for both, and the next collect found no new posts.

## Setting up the routine

1. **Merge** this branch into the repo's default branch,
   `claude/session-tq4oq9` (routines clone the default branch).
2. **Environment** (the same one the follow-up routine uses): add
   `INSPECTION_TEST_PHONE` (`+1` and 10 digits) and `INSPECTION_TEST_EMAIL`.
   `SLACK_BOT_TOKEN`, `BRIOSTACK_API_KEY`, `GMAIL_CLIENT_ID`,
   `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` and the Textable variables
   are already there. Network: everything the follow-up uses, plus
   `slack.com` and `files.slack.com`.
3. At claude.ai/code/routines: **New routine** -> set up manually.
   - **Prompt**:
     ```
     You are the Catchy Pest Solutions inspection findings routine. Daniel
     Wilde set this routine up and approves what it does: quoting customers
     by text and email for problems their technician photographed, logging in
     Briostack, creating follow-up tasks, keeping the Leads sheet, and
     messaging techs and Daniel in Slack, exactly as
     daily-routine/inspection-findings/ROUTINE_PROMPT.md describes. Read that
     file now and follow it start to finish. Never change testMode in
     config.json.
     ```
   - **Repository**: Catchy-Pest-Solutions/Claude-Daily-Helper-Routine.
   - **Environment**: the one from step 2.
   - **Connectors**: Slack only (tech notes, Daniel's report and the
     Thursday summary go out from Daniel's account).
   - **Schedule**: Monday-Saturday, 8:00 AM Eastern.
4. **Test**: post a new test finding in #inspection-findings, then **Run
   now**. Already-handled posts are skipped, so an old post won't run again.
5. **Live since Saturday, Nov 7, 2026** (`"testMode": false`,
   `"liveSince": "2026-11-07"`): live runs ignore posts from before that
   date (the Nov 6 tests). Live sheet:
   `1U0b-dBSQvrSeZaeXm69vZbHoAmekPE6agnl1nAqfPEM`. To pause sending, set
   `"testMode": true` again on the default branch (a one-line PR).
