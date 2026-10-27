// Voicemail emails from ATS (vmail@voiceforpest.com), which carry a written
// transcription, sent to office@catchypestsolutions.com.
//
// Subject: "V-Mail from WIRELESS CALLER (828) 555-0142 to Shelley Heaton 102"
// The HTML body comes in two layouts; both name the caller's number and end
// the transcription before "Listen" / "Sent by Affiliated Technology Solutions":
//   "... You have a new voice mail from (828) 555-0142 (WIRELESS CALLER) .
//    Your transcribed message: <text> Listen ..."
//   "... You have a new voice mail from (828) 555-0142 (WIRELESS CALLER)
//    <text> Listen ..."
const { normalizePhone } = require('../../src/callReview/callAnalysis');

const SENDER = 'vmail@voiceforpest.com';

function htmlToText(html) {
  return String(html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|td|h\d)>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

// { at, phone10, callerIdName, mailbox, mailboxExt, transcription } or null.
function parseVoicemailEmail({ subject, html, internalDate }) {
  const subj = String(subject || '');
  const text = htmlToText(html);
  const fromSubject = /V-Mail from (.*?)\s*\((\d{3})\)\s*(\d{3})-(\d{4})\s+to\s+(.+)$/i.exec(subj);
  const fromBody = /new voice ?mail from \((\d{3})\)\s*(\d{3})-(\d{4})\s*(?:\(([^)]*)\))?/i.exec(text);
  const phone10 = normalizePhone(fromSubject ? fromSubject.slice(2, 5).join('') : fromBody ? fromBody.slice(1, 4).join('') : '');
  if (!phone10) return null;
  let transcription = '';
  const marker = /Your transcribed message:\s*/i.exec(text);
  const start = marker ? marker.index + marker[0].length : fromBody ? fromBody.index + fromBody[0].length : -1;
  if (start >= 0) {
    // Ends "... Listen by opening the enclosed attachment. Sent by Affiliated
    // Technology Solutions". Only that closing "Listen" is cut, so a caller
    // who says "listen" keeps their words.
    const rest = text.slice(start).replace(/^\s*\.\s*/, '');
    const end = rest.search(/Sent by Affiliated/i);
    transcription = (end >= 0 ? rest.slice(0, end) : rest).replace(/\s*\bListen\b[^.]{0,60}\.?\s*$/i, '').trim();
  }
  const mailbox = fromSubject ? fromSubject[5].trim() : null;
  const ext = mailbox ? (/\b(\d{3})$/.exec(mailbox) || [])[1] || null : null;
  return {
    at: Number(internalDate) || null,
    phone10,
    callerIdName: (fromSubject ? fromSubject[1] : fromBody?.[4] || '').trim() || null,
    mailbox,
    mailboxExt: ext ? Number(ext) : null,
    transcription,
  };
}

// Gmail search for voicemail emails received since sinceMs.
const voicemailQuery = (sinceMs) => `from:${SENDER} after:${Math.floor(sinceMs / 1000)}`;

module.exports = { parseVoicemailEmail, voicemailQuery, htmlToText, SENDER };
