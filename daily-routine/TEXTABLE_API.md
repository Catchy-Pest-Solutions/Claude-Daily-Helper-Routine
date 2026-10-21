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
| `media` | Optional. Array of public file links; sends a picture message (MMS). See "Attachments" below |
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

## Attachments (pictures and PDFs)

- Put direct links to the files in `media`. Textable downloads each file
  and sends it with the text. There's no upload endpoint: the file has to
  be online first, at a link anyone can open without logging in, and the
  link has to return the file itself, not a web page showing it.
- Verified on Daniel's phone: a JPG photo (82 KB, served as `image/jpeg`)
  and a one-page PDF (17 KB, served as `application/pdf` from jsDelivr)
  both arrived as sent.
- Not tested: several files in one message (the API takes an array), full
  size phone photos, and links that label a PDF as a generic file (GitHub
  raw links do). Google Drive share links open a Drive page, not the file,
  so they won't work in `media`; they're fine as a link in the message
  text.
- Phones and carriers differ. Pictures arrive almost everywhere; PDFs
  worked on Daniel's phone but may not open on every customer's. Carriers
  often cap a picture message at about 1 MB, so shrink photos first (about
  1,200 px on the long side, ~200 KB each) and send at most 3 to 4 files
  per message.

## Sending quotes and technician photos

Send two texts a few seconds apart:

1. **What the tech found:** a short personal note plus the 2 or 3 clearest
   photos.
   > Hi [first name], this is [name] at Catchy Pest. Here's what [tech]
   > found at your home today: [one line per problem].
2. **The quote:** the price in the text itself, a picture of the one-page
   quote, the quote PDF, and one clear ask.
   > Taking care of all of it would be $[price], details attached. Reply
   > YES and we'll get you on the schedule.

Why this format:

- Photos of their own house are the most persuasive part. Sent as
  pictures, they show in the thread without tapping. Put only inside a
  PDF, they're hidden until the customer opens it.
- The price in the text and the quote picture mean the customer sees the
  answer right away, even if the PDF doesn't open on their phone.
- The PDF holds the full details and all photos with captions. It's what
  the customer keeps and forwards to a spouse or landlord, so it should
  repeat the photos.
- "Reply YES" is the easiest way to accept on a phone. The reply comes back
  to the number they know and lands in the ATS Texting inbox, so book it
  promptly, and follow up in a day or two if there's no answer.
- Two messages keep each one under the carrier size cap.

Tech photos posted in Slack can be sent this way. The pieces:

1. The tech posts the photos in Slack with the customer's name or
   Briostack ID.
2. Download them from Slack. Slack files are private, so this needs a
   Slack token that can read files (`files:read`).
3. Shrink each photo and upload it to public storage under a long random
   file name, so the links can't be guessed. A Google Cloud Storage bucket
   works well: its links return the file itself with the right file type.
4. Look up the customer's cell number in Briostack, and turn the first
   page of the quote PDF into a JPG for the quote picture.
5. Post the drafted texts in Slack for the office to approve, then send
   both through `POST /api/send`.

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
