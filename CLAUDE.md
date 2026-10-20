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

Credentials come from the environment (see `.env.example`). Never write
them into files, messages or commits.
