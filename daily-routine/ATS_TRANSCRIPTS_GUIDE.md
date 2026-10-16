# Fetching ATS call transcripts — guide for Claude sessions

How to pull calls and their AI transcripts from ATS (Voice for Pest), Catchy
Pest Solutions' phone system, and turn them into follow-ups such as emails to
new customers. Everything here was confirmed against the live ATS API on
Oct 16, 2026.

## Copy-paste prompts

Start a Claude Code session on this repo and paste one of these. Each one
points the session at this file, so the session gets every detail below
without you pasting it all.

**Follow-up email drafts for today's new-customer calls**

```
Read daily-routine/ATS_TRANSCRIPTS_GUIDE.md and follow it. Use only the ATS
API to find calls and transcripts. Fetch today's incoming calls, find the
ones from new customers (section "Finding new-customer calls"), and for each
one that had a real conversation, create a Gmail DRAFT follow-up email
(section "Follow-up emails"). Don't send anything. When you're done, give me
a table: time, caller, why you think they're new, what they asked about,
whether they booked, and whether a draft was created (or why not, e.g. no
email address).
```

**Every call with one phone number**

```
Read daily-routine/ATS_TRANSCRIPTS_GUIDE.md and follow it. Using only the ATS
API, get every incoming and outgoing call with (XXX) XXX-XXXX on <date or
"today">, and summarize each transcript for me.
```

**One call, full transcript**

```
Read daily-routine/ATS_TRANSCRIPTS_GUIDE.md and follow it. Using only the ATS
API, find today's call from (XXX) XXX-XXXX and show me its full transcript.
```

If a session doesn't have this repo, paste this whole file in as the prompt
instead and add what you want done at the end.

---

## 1. Ground rules

- **Use the ATS API only** for calls and transcripts. Briostack is the
  office's CRM, a separate system. Only touch it if the user's prompt says
  to (see "Finding an email address").
- **Credentials** come from the environment variables `ATS_USERNAME` and
  `ATS_PASSWORD`. They're set in this cloud environment's settings (the
  repo's `.env` works too). ATS customer ID is `1299`; it lives in
  `src/callReview/config.js`. Never print, paste, commit or email the
  password. If the variables are missing, tell the user to add them to the
  environment's settings rather than pasting them into the chat.
- **Never print raw API responses.** The transcript feed is shared with every
  ATS customer, so one day's scan is about 1 MB of mostly other companies'
  rows. Do the API work in a script and print only the compact result. That
  keeps token use low (see section 8).
- **Never send email or texts without an explicit go-ahead in the prompt.**
  Create drafts by default.

## 2. Quick start: the fetch tool

The repo has a tested tool that does all of the API work:

```
cd daily-routine
node src/atsTranscripts.js                                  # today, all calls
node src/atsTranscripts.js --date 2026-10-16                # a past day (Eastern date)
node src/atsTranscripts.js --direction inbound              # incoming only
node src/atsTranscripts.js --phone "(828) 555-0100"         # in + out with one number
node src/atsTranscripts.js --out /path/to/scratchpad/calls.json
```

Options can be combined. It takes about 35 seconds for a weekday; a Monday
walks back over the weekend, so it takes longer. Write `--out` into the
session's scratchpad directory, not into the repo: the file holds customers'
names, addresses and conversations, and must never be committed.

**What it prints:** one short block per call (time, direction, number,
caller-ID name, who handled it, talk time, menu choice, call ID) and the
AI summary. A full day of about 30 calls is about 2,000 tokens. Full
transcripts are only in the JSON file.

```
12:39 PM | inbound  | (828) 555-0100 | answered by Shelley | 5 min | call 1s50AbCdE
  Summary: A caller asked about sealing entry points for rodents. The representative explained ...
```

**The JSON file** (`--out`, default `ats-transcripts-<date>.json` in the
system temp directory; the printout says where):

```
{ "date", "generatedAt", "transcriptFeedComplete",
  "calls": [ {
    "callId",        // ATS call ID, e.g. "1s50AbCdE"
    "direction",     // "inbound" | "outbound"
    "start", "end",  // Eastern ISO timestamps
    "phone",         // the customer's 10-digit number
    "callerIdName",  // caller ID text (inbound): a name, a town ("ASHEVILLE NC") or null
    "staff",         // "Shelley" | "Steve" | "Daniel" | null
    "menuChoice",    // inbound: "new" (pressed 1) | "current" (pressed 2) | null (not logged)
    "answered",      // inbound: true/false; outbound: null
    "outcome",       // missed inbound: "went to voicemail", "hung up on hold ..." etc.
    "talkSec",
    "transcript": null | { "id", "callTimeUtc", "summary", "transcription" }
  } ] }
```

Read one full transcript without dumping the whole file, e.g.:

```
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); c=[c for c in d['calls'] if c['callId']==sys.argv[2]][0]; print(c['transcript']['transcription'])" calls.json 1s50AbCdE
```

If `transcriptFeedComplete` is false, the scan stopped early and some
transcripts may be missing. Say so instead of treating those calls as
untranscribed.

## 3. The office and the phone system

- Main numbers: (828) 263-4804 (shows as DNIS "Main E911") and (828) 266-0020.
- Extensions: 101 Daniel Wilde (owner, doesn't take calls), 102 Shelley
  (mostly current customers), 103 Steve (mostly new customers).
- Phone menu: press 1 = New Customers (queue 191), press 2 = Existing
  Customers (queue 190). 192 = Saturday Queue, 193 = Simple Talk Direct.
- Office hours: 8 AM–5 PM Eastern, Monday–Friday.

## 4. What the transcripts are like

- **Which calls have one:** every call with a real conversation, incoming
  and outgoing. On Oct 16, all 17 such calls had a transcript. Missed calls
  have none. Outgoing calls that hit a voicemail greeting get a tiny
  transcript of the greeting ("You've reached ..."). Voicemails that callers
  leave are not in this feed; they go to the office email.
- **Timing:** a transcript shows up a few minutes after the call ends (seen
  within 5–20 minutes). For a call that ended less than about 30 minutes
  ago, "no transcript" usually means "not ready yet".
- **Format:** `summary` is 2–3 sentences. `transcription` is plain text in
  turns: `Speaker 0: ...` / `Speaker 1: ...`. Speakers are numbered in the
  order they first talk, **not** by role: Speaker 0 is often, but not
  always, the Catchy rep. Tell who's who from the content ("Catchy Pest
  Solutions, this is Shelley"). Sometimes both voices are merged into one
  turn.
- **Speech-to-text errors to expect:**
  - Prices: "$6.47" when $647 was said.
  - Names and spellings (Shelley comes out as "Shelly" or "Shirley").
  - Street names and ZIP codes.
  - The company name: "Catching Pest", "Petri Pest".
  - Email addresses spelled aloud.
  The AI summary is usually right about prices but has mixed up the rep's
  name with the caller's. Never put an address, price or email address taken
  from a transcript into a message without flagging that it needs checking.
- **Length:** about 3,700 characters (about 900 tokens) on average; a
  15-minute call is about 12,500 characters (about 3,000 tokens).

## 5. Finding new-customer calls

Run `node src/atsTranscripts.js --direction inbound --out <scratchpad>/calls.json`,
then judge each answered call, using the signals in this order:

1. `menuChoice: "new"` (pressed 1): new customer. `"current"` (pressed 2):
   existing customer, unless the conversation clearly says otherwise.
2. `menuChoice: null` is the most common case. Many answered calls don't log
   a menu choice. Decide from the summary, and read the full transcript when
   the summary isn't clear.
   - **New:** asks what services or prices are; wants a quote, an inspection
     or a first treatment; just moved; describes a problem with no mention
     of past visits; gives their address for the first time.
   - **Existing:** "I'm a current customer"; mentions "your technician came
     out" or a past treatment; rescheduling; billing; cancelling; extending
     a plan.
3. The same number calling more than once the same day is one person. Look
   at all their calls together.
4. Former customers coming back count as new for sales follow-up. Mention it
   when the transcript says so.

For each new-customer call, record:
- what they need (pest, property);
- what was quoted;
- whether they **booked** (an appointment date was set) or are **undecided**
  ("I'll talk to my wife and call back");
- any email address mentioned;
- who handled the call.

Undecided callers are the most valuable follow-ups.

## 6. Follow-up emails

### Finding an email address

ATS has no email addresses. Options, in order:
1. **Spoken in the call.** The rep sometimes collects one ("we'll send the
   confirmation to your email"). Treat it as unverified: speech-to-text
   often garbles spelled-out addresses. If it looks off, don't draft. List
   it for the office to confirm instead.
2. **Briostack**, only if the prompt allows it. If the office created a
   customer record during the call, it has the email.
   `src/callReview/briostack.js` already has a phone-number lookup
   (`findCustomerByPhone`, needs `BRIOSTACK_API_KEY`).
3. **None found.** Don't guess. List the caller as "needs a phone or text
   follow-up" with their number.

### Drafting

- Create the email with the Gmail connector as a **draft** (`create_draft`).
  Send only if the prompt explicitly says to send.
- Before drafting, search Gmail for recent messages or drafts to that
  address so nobody gets a second follow-up.
- **Content:**
  - Short and personal.
  - Thank them for calling and name what they asked about ("the rodents
    getting into your home").
  - Restate the options or price only when the summary and transcript agree
    on it.
  - Give one clear next step: reply or call (828) 263-4804 to book. For
    callers who booked, confirm what to expect at the visit.
  - Sign as the person who took the call, from Catchy Pest Solutions.
  - No internal notes, no pressure, no promises the rep didn't make.
- **Subject:** e.g. "Following up on your call with Catchy Pest Solutions".
- **Booked vs. undecided:** booked callers get a thank-you / what-to-expect
  note; undecided callers get a gentle follow-up with the options they were
  given.
- Report back in a table: caller, number, new-customer evidence, booked or
  undecided, email address and where it came from, draft created yes/no
  and why.

## 7. ATS API reference

Use this when the tool isn't enough. The docs are at
https://api.atscall.me/docs. The page is drawn by JavaScript; the real
content is in https://api.atscall.me/views/includes/js/docs/index.js.

**Base URL:** `https://api.atscall.me/api-v2/`. Our code:
`src/callReview/atsClient.js`. It has `searchCalls`, `searchTranscripts`
and the text-message searches, and handles auth and retries.

**Auth:** `POST auth` with a multipart form, `username` + `password`. It
returns `{ token }`; send `Authorization: Bearer <token>` on every request.
Tokens last 15 minutes. An expired token comes back as
`{ token: "[ invalid ]", status: "error" }`: re-authenticate and retry.

### Calls: `GET search`

- **Parameters:** `customer_id=1299`, `start_date`, `start_time`,
  `end_date`, `end_time`, `page`.
- **Times are UTC**, in both filters and results ("YYYY-MM-DD HH:MM:SS").
  Always pass both times: a bare `end_date` means midnight at the start of
  that day.
- **Pagination:** pages are a fixed 50 rows; `limit` is ignored. Page count
  is in `report.page_info.total_pages`.
- **One row is one call leg.** A call is all the rows sharing `call_id`.
  Fields: `call_id, caller_id, caller_name, callee_id, callee_name,
  exit_id, exit_name, start_time, end_time, queue_duration,
  total_duration, dnis, dnis_name, user_data, exit_cat`.
- **Inbound:** the first leg's `caller_id` is the customer's 10-digit
  number. Pressing 1 or 2 adds legs with `callee_name` `"191"` / `"190"` and
  `"Call-Queue"`, or a `caller_name` prefixed `New...` / `Existing...`. A
  leg whose `callee_id`/`callee_name` is `"102wp"` or `"X102"` means
  extension 102 picked up. `"VMail"` is the voicemail box. `"SpeakAccount"`
  is the hold line when both lines are busy. `exit_name "No digit"` means
  the caller never pressed 1 or 2.
- **Outbound:** the first leg's `caller_id` is a 3-digit extension
  (101/102/103), and `callee_id` is the customer's number. `caller_name` is
  "Catchy Pest" or the staff member's name.
- **For one phone number:** incoming calls have it as `caller_id`; outgoing
  calls have it as `callee_id`. `groupCalls` + `classifyCall` in
  `src/callReview/callAnalysis.js` do all of this, and the tool uses them.
- `call-center-cdrs-search` is ATS's separate call-center product. It's
  always empty for Catchy.

### Transcripts: `GET sync-transcriptions`

- **Parameters:** `last_id` (returns rows with id > last_id) and `limit`
  (max 100; larger values are capped).
- **One feed shared by every ATS customer.** About 25.3 million rows as of
  Oct 16, 2026, growing by about 2,000 an hour (more in business hours,
  fewer at night). Other customers' rows come back as just
  `{ id, access: false }`.
- **Our rows:**
  `{ id, access: true, call_time (UTC), cust_id: 1299, cdr_id, summary, transcription }`.
  **`cdr_id` is the `/search` `call_id`**: that's how a transcript is
  matched to its call. `call_time` is about when the call reached the
  queue or rep, a few seconds after the first leg.
- **No filters work.** These were all tested and ignored: `customer_id`,
  `cust_id`, `cdr_id`, dates. Leaving out `last_id` doesn't start at 0; it
  starts at an older Catchy row (one from Oct 13). That isn't documented,
  so don't rely on it.
- **How to get one day:**
  1. Find the newest id: gallop up with `last_id` until a page is empty,
     then bisect (about 25 requests).
  2. Walk backwards in 100-id pages (`last_id = top-100, top-200, ...`,
     6 in parallel).
  3. Keep rows with `access !== false`.
  4. Stop once one of ours has a `call_time` more than an hour before the
     start of the day (transcripts arrive slightly out of order).
  A weekday is about 350 requests, about 1 MB of responses, about 35
  seconds. `searchTranscripts(startMs)` in `atsClient.js` does exactly this.

### Other endpoints

- `applause-transcriptions-by-customers` is commented out of the docs and
  returns "Failed to retrieve applause transcriptions". Don't use it.
- **Recordings:** `POST download-recording` with `customer_id` + `call_id`
  returns the call's MP3. It's documented but hasn't been tested yet.
- **Texts:** `sms-inbound` / `sms-outbound`. Same date parameters as
  `search`; results are in `message.results`, paged by
  `message.totalPages`.

## 8. Keeping token use (cost) down

Claude is billed (or counts against plan usage) for what it reads and
writes in the conversation, not for API requests a script makes. So:

- Let scripts do the requests. The ~350 feed requests cost nothing in
  tokens because Claude never sees them. Only the printout counts: about
  2,000 tokens for a full day.
- Triage from summaries (about 75 tokens each). Open full transcripts
  (about 900 tokens on average, up to about 3,000) only for the calls being
  acted on.
- Don't re-run the fetch to look something up again. Read from the saved
  JSON.
- Measured on Oct 16, 2026: reading one call's full transcript and writing
  one email takes a few thousand tokens. Most of a session's cost is its
  fixed overhead (instructions, tool definitions and the conversation so
  far, re-read on every step), so one session doing a whole day's calls
  costs far less per call than one session per call.
