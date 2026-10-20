# Texting from the business number (ATS Texting / Textable API)

Reference for sending texts from Catchy Pest's main number through an API.
Everything marked "verified" was confirmed against the live API on
2026-10-20.

## What it is

- **ATS Texting** (the inbox at `atstexting.atscall.me/conversations`) is
  **Textable** rebranded by ATS (Voice for Pest). ATS sent the API docs and
  credentials in October 2026. The API and the ATS Texting inbox are the
  same account: texts sent through the API show up in that inbox
  (verified).
- Texts go out from **+1 828-263-4804**, the same number customers see when
  the office calls them. A text from it lands in the same thread as our
  calls on the customer's phone.
- This is a separate API from the ATS phone API (`api.atscall.me/api-v2`,
  used by the call review in `src/callReview/atsClient.js`). That one reads
  call logs and inbound/outbound texts; this one sends.
- Briostack also has texting, but no API for sending. This is the only way
  for a script to send a text.

## Auth

- Base URL: `https://atscall-txb.textable.app`
- Header: `Authorization: Bearer <TEXTABLE_ACCOUNT_UID>:<TEXTABLE_API_TOKEN>`
- Read both from the environment (`TEXTABLE_ACCOUNT_UID`,
  `TEXTABLE_API_TOKEN`). Never put them in files, messages or commits.
- It's a regular user token, not an admin one. Admin endpoints
  (`GET /api/v2/users/{id}`, `/api/users`, `/api/organizations`, ...) return
  403 (verified).
- Docs: `https://atscall-txb.textable.app/docs/html`. Full OpenAPI spec:
  `https://atscall-txb.textable.app/docs/json`.
- The docs say nothing about rate limits. Space out bulk sends.

## Sending: `POST /api/send`

JSON body:

| Field | Notes |
|---|---|
| `to` | Recipient in E.164 (`+18285551234`), or an array for a group text |
| `from` | `+18282634804` |
| `message` | Text of the message |
| `media` | Optional. Array of public image URLs; makes it an MMS |
| `sendAt` | Optional. Future UTC timestamp in ms; schedules the text |
| `type: "note"` | Optional. Saves an internal note on the conversation. Nothing is sent |
| `sendStatus: "sent"` | Optional. Logs a message that was sent some other way. Nothing is sent |
| `reminder` | Optional. Shows it in the app's reminder section; needs `sendAt` and `scheduleTimezone` (`America/New_York`) |
| `notify` | Optional. Notify the Textable user that the message/note was stored |
| `autoArchive` | Optional. Archive the conversation afterwards |

Responses:

- `200 {"status": true, "id": "<messageId>"}`: sent or scheduled (verified)
- `400`: bad request
- `404`: problem with the user or contact
- `451`: the customer opted out (texted STOP). Don't retry.
- `500`: send failed

## Other endpoints this token can use

- `GET /api/contacts` returns `{ contacts: [...] }`, all of them in one
  response with no paging (verified: 213). Fields: `id`, `phoneNumber`,
  `fullName`, `email`, `last_message`, `last_message_date` (UTC ms).
  Contacts aren't synced from Briostack: most have the phone number as
  their name and none have an email (verified).
- `GET /api/contacts/{id}`, `POST /api/contacts` (`phoneNumber` required,
  `fullName` and `email` optional).
- `GET /api/drips` and `GET /api/canned-responses` return
  `{ drips: [] }` and `{ canned: [] }`. None are set up yet (verified).
  `POST /contacts/{id}/drip` with `{ dripCampaignId }` starts a drip
  campaign for a contact.
- `GET`/`PATCH /api/v2/users/{uid}/messageSettings`: away-message interval
  and signature. Currently no away message and no signature (verified).
- `POST /api/users/{uid}/webhook` with `{ url }`: Textable then POSTs every
  inbound and outbound text to that URL with `MessageID`, `ConversationID`,
  `ToNumber`, `FromNumber`, `MessageBody`, `MessageDirection` (`in`/`out`),
  `TextableUserID`, `TextableOrganizationID`, `ContactName`,
  `ContactEmail`, `Media`. The endpoint must reply 200.
- `POST /api/beta/block`: block or unblock a number (beta, may change).

Not available with this token:

- Mass texts (`/blasts`), which need the app login.
- Any endpoint that returns the account's own phone number or a
  conversation's full message history. For history, use the ATS phone API's
  `sms-inbound`/`sms-outbound` (`atsClient.js`) or the webhook.

## Rules for sending

- Every send is a real text from a number customers recognize. Get Daniel's
  OK before a script starts sending anything new, and send the first test
  to his own cell.
- Promotional texts (specials, seasonal offers) need the customer's prior
  consent. Service texts to people who called us or have an appointment are
  the safer starting point.
- Treat a `451` as permanent: that customer opted out.
