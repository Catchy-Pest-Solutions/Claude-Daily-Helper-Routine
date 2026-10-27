// Briostack REST calls the follow-up makes. Confirmed against the live API
// (Oct 21, 2026):
// - Auth: X-Api-Key. Bursts return {"message":"Too Many Requests"}, so calls
//   go one at a time with a pause and a retry.
// - GET customers/{id} has primaryPhone/secondaryPhone {number (E.164),
//   textNotifications, contactMethodId}, primaryEmail {address,
//   contactMethodId}, primaryAddress, dateAcquired (the creation time, with a
//   -06:00 offset). No field says whether a phone is a cell.
// - GET customers/{id}/services: serviceCategoryName (may have trailing
//   spaces), statusId (CSC_PENDING, CSC_SCRATCH = scratched, ...),
//   initialAmount, regularAmount. "Quote -" services carry the quoted price
//   in regularAmount with initialAmount 0.
// - GET customers/{id}/appointments: appointmentDate (YYYY-MM-DD),
//   appointmentTypeName ("Place Holder" for quotes, not a real visit),
//   statusId (SVC_TICK_ACTIVE open), arrivalFrom/arrivalThru ("11:00:00").
// - Communications: GET customers/{id}/communications lists entries
//   (subject, communicationTypeId PHONE_COMMUNICATION/EMAIL_COMMUNICATION/
//   SMS, createdBy, date); GET .../communications/{cid} adds content. ATS
//   copies each call there as a PHONE_COMMUNICATION by "system" (see
//   parseAtsCommunication). POST .../communications with subject, content,
//   communicationTypeId, date, contactMethods [{contactMethodId}] adds an
//   entry that only shows on the Communications tab and sends nothing.
//   POST .../communications/{cid}/documents (multipart) attaches a file.
// - Webhooks: GET/POST webhooks, PATCH webhooks/{id}; no DELETE. Needs a key
//   whose user is an administrator.
const { requireEnv } = require('./env');

const BASE = 'https://catchypestsolutions.briostack.io/rest/v1/';

function createBriostack({ apiKey = requireEnv(['BRIOSTACK_API_KEY']).BRIOSTACK_API_KEY, baseUrl = process.env.BRIOSTACK_BASE_URL || BASE, pauseMs = 1200, fetchImpl = fetch } = {}) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  let requests = 0;

  async function call(method, path, { json, form } = {}) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetchImpl(`${base}${path}`, {
        method,
        headers: { 'X-Api-Key': apiKey, ...(json ? { 'Content-Type': 'application/json' } : {}) },
        body: json ? JSON.stringify(json) : form,
      });
      requests++;
      const text = await res.text();
      if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
      if (text.includes('Too Many Requests')) {
        await new Promise((r) => setTimeout(r, pauseMs * (attempt + 2)));
        continue;
      }
      if (!res.ok) {
        let msg = text.slice(0, 160);
        try {
          msg = JSON.parse(text).message || msg;
        } catch {
          // not JSON
        }
        const err = new Error(`Briostack ${method} ${path.split('?')[0]} -> ${res.status} ${msg}`);
        err.status = res.status;
        throw err;
      }
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        return text;
      }
    }
    throw new Error(`Briostack ${method} ${path.split('?')[0]} kept returning Too Many Requests`);
  }

  const list = async (path) => {
    const r = await call('GET', path);
    return Array.isArray(r) ? r : [];
  };

  return {
    getCustomer: (id) => call('GET', `customers/${id}`),
    getServices: (id) => list(`customers/${id}/services`),
    getAppointments: (id) => list(`customers/${id}/appointments`),
    // Pages of 100 (the API's maximum limit).
    listCommunications: async (id) => {
      const all = [];
      for (let start = 0; start < 2000; start += 100) {
        const page = await list(`customers/${id}/communications?limit=100&start=${start}`);
        all.push(...page);
        if (page.length < 100) break;
      }
      return all;
    },
    getCommunication: (id, cid) => call('GET', `customers/${id}/communications/${cid}`),
    createCommunication: (id, body) => call('POST', `customers/${id}/communications`, { json: body }),
    uploadDocument: (id, cid, { filename, mimeType, data }) => {
      const form = new FormData();
      form.append('file', new Blob([data], { type: mimeType }), filename);
      return call('POST', `customers/${id}/communications/${cid}/documents`, { form });
    },
    listEmployees: () => list('employees?limit=100'),
    // Open tasks for the whole account (a dozen or so); filtering by
    // customer (partyId) isn't supported, so callers match party.partyId.
    listOpenTasks: () => list(`tasks?limit=100&filter=${encodeURIComponent('statusId="ORDER_REQMNT_CREATED"')}`),
    getTask: (taskId) => call('GET', `tasks/${taskId}`),
    listWebhooks: () => list('webhooks'),
    createWebhook: (body) => call('POST', 'webhooks', { json: body }),
    patchWebhook: (wid, body) => call('PATCH', `webhooks/${wid}`, { json: body }),
    requestCount: () => requests,
  };
}

// ATS's copy of a call on the Communications tab. Content looks like:
//   Incoming Call
//   Call Started: 10/21/2026 1:19PM EDT
//   Call Answered: ...
//   Caller Name: ...
//   Phone Number Dialed: (828) 263-4804
//   Answered by Extension: 103
//
//   Call Summary:
//   <summary>
//
//   Transcription: Speaker 0: ...
function parseAtsCommunication(content) {
  const text = String(content || '').replace(/\r\n/g, '\n');
  const transcriptAt = text.search(/^\s*Transcription:/m);
  if (transcriptAt < 0) return null;
  const summary = /Call Summary:\s*([\s\S]*?)\s*$/.exec(text.slice(0, transcriptAt))?.[1]?.trim() || '';
  const transcription = text.slice(transcriptAt).replace(/^\s*Transcription:\s*/, '').trim();
  const ext = /Answered by Extension:\s*(\d{3})/.exec(text)?.[1] || null;
  const direction = /^\s*Outgoing/i.test(text) ? 'outbound' : /^\s*Incoming/i.test(text) ? 'inbound' : null;
  return { summary, transcription, ext: ext ? Number(ext) : null, direction };
}

module.exports = { createBriostack, parseAtsCommunication };
