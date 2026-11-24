# Catchy Pest Solutions daily routines

Scripts the scheduled Claude routines run for Catchy Pest Solutions (pest
control, owner Daniel Wilde). Code lives in `daily-routine/`.

Reference docs, read the relevant one before touching an integration:

- `daily-routine/README.md`: Briostack API findings, the cross-sell check,
  and the daily call review (ATS phone API).
- `daily-routine/CALL_REVIEW_ROUTINE_PROMPT.md`: who's who in the office and
  the call review routine's instructions.
- `daily-routine/TEXTABLE_API.md`: sending texts from the business number
  (+1 828-263-4804, the office's caller ID) through the ATS Texting /
  Textable API.
- `daily-routine/ATS_TRANSCRIPTS_GUIDE.md`: finding calls and AI transcripts
  in the ATS phone API.
- `daily-routine/lead-followup/README.md`: the new-customer follow-up
  routine (prepare/render/send scripts, the Apps Script relay, test mode).
- `daily-routine/wdir/WDIR_RULES.md`: the Official NC Wood-Destroying
  Insect Information Report (WDIR 100) the inspection findings routine
  fills from a tech's WDIR post, signs and emails to the office.
- `daily-routine/payroll/README.md`: the Thursday 6 PM commission payroll
  (technician 6% production split by clock hours, office 4% on initials,
  Slack DMs after Daniel approves). Instructions: `payroll/ROUTINE_PROMPT.md`.
- `daily-routine/daily-summary/ROUTINE_PROMPT.md`: the daily technician
  briefing, office check-list, trap counts and same-address add-on tasks
  (Briostack API + Slack). Change the routine by editing this file.

Credentials come from the environment (see `.env.example`). Never write
them into files, messages or commits.
