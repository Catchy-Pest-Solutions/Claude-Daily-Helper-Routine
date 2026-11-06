#!/usr/bin/env node
// Step 3 of the inspection findings routine: pictures and PDF.
//
//   node render.js --posts $S/posts.json --decisions $S/decisions.json [--no-upload]
//
// For each "quote" decision: stamps every chosen tech photo with the service
// address and the Slack post's date and time (Slack strips the camera's own
// timestamp), renders the quote card (1080x1350 JPG for the text) and the
// proposal PDF, uploads the card (public picture link Textable can fetch)
// and the PDF (Drive share link) to the Drive folder under random names.
// Writes $S/rendered.json and prints one JSON line {"rendered": N, ...}.
// --no-upload renders locally only (design checks).
require('../lead-followup/lib/proxy');
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('../lead-followup/lib/env');
const { renderString } = require('../lead-followup/lib/template');
const { launch, pdfPageCount } = require('../lead-followup/lib/chrome');
const google = require('../lead-followup/lib/google');
const cal = require('../src/callReview/calendar');
const { loadConfig } = require('./lib/common');
const Q = require('./lib/quote');

const TEMPLATES = path.join(__dirname, 'templates');
const LOGO = path.join(__dirname, '..', 'lead-followup', 'assets', 'logo-print.png');
const CARD = { width: 1080, height: 1350, maxBytes: 300 * 1024 };
const PHOTO_WIDTH = 1200;
const fill = (name, data) => renderString(fs.readFileSync(path.join(TEMPLATES, name), 'utf8'), [data]);

// Width and height from a JPEG or PNG header (no image libraries needed).
function imageSize(buf) {
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

async function jpegUnder(page, maxBytes, qualities = [88, 82, 76, 68, 60]) {
  let jpg;
  for (const q of qualities) {
    jpg = await page.screenshotJpeg(q);
    if (jpg.length <= maxBytes) break;
  }
  return jpg;
}

async function stampPhoto(chrome, photo, model, dir, n) {
  const buf = fs.readFileSync(photo.path);
  const size = imageSize(buf);
  if (!size) throw new Error(`${photo.name} isn't a JPG or PNG (iPhone HEIC photos need converting first)`);
  const width = PHOTO_WIDTH;
  const height = Math.round((size.height / size.width) * width);
  const html = path.join(dir, `photo-${n}.html`);
  fs.writeFileSync(html, fill('photo.html', { width, height, src: `file://${photo.path}`, address: model.address, when: model.stampWhen, pad: 18, padX: 26, font: 26, fontBig: 30 }));
  const page = await chrome.open(html, { width, height });
  const jpg = await jpegUnder(page, 350 * 1024);
  await page.close();
  const out = path.join(dir, `photo-${n}-stamped.jpg`);
  fs.writeFileSync(out, jpg);
  return { path: out, width, height, bytes: jpg.length };
}

async function renderQuote(chrome, decision, post, config, today, outDir) {
  const model = Q.quoteModel(decision, post, config, { today });
  const dir = path.join(outDir, 'quotes', model.key.replace(/[^\w]/g, '_'));
  fs.mkdirSync(dir, { recursive: true });

  const chosen = (decision.photos?.length ? decision.photos : post.photos.map((_, i) => ({ index: i + 1 })))
    .map((p) => ({ ...p, photo: post.photos[p.index - 1] }))
    .filter((p) => p.photo);
  if (!chosen.length) throw new Error(`${model.key}: no photos to use`);
  const stamped = [];
  for (const [i, p] of chosen.entries()) stamped.push({ ...(await stampPhoto(chrome, p.photo, model, dir, i + 1)), caption: p.caption || '', index: p.index });
  const cardPhoto = chosen.findIndex((p) => p.index === (decision.cardPhoto || chosen[0].index));
  const cardSrc = chosen[Math.max(0, cardPhoto)].photo.path;

  // Quote card.
  const cardHtml = path.join(dir, 'card.html');
  fs.writeFileSync(cardHtml, fill('card.html', { ...model, headline: decision.headline, photoUrl: `file://${cardSrc}`, logoUrl: `file://${LOGO}`, address: model.address, when: model.stampWhen, officePhone: config.officePhone }));
  const card = await chrome.open(cardHtml, CARD);
  const overflows = () => card.evaluate(`(() => { const m = document.querySelector('main'); return m.scrollHeight > m.clientHeight + 1; })()`);
  if (await overflows()) {
    await card.evaluate(`document.body.classList.add('compact')`);
    if (await overflows()) throw new Error(`${model.key}: card text doesn't fit; shorten the headline`);
  }
  const cardJpg = await jpegUnder(card, CARD.maxBytes, [90, 84, 78, 70, 60, 50]);
  if (cardJpg.length > CARD.maxBytes) throw new Error(`${model.key}: card is over 300 KB`);
  await card.close();
  const cardPath = path.join(dir, 'quote-card.jpg');
  fs.writeFileSync(cardPath, cardJpg);

  // Proposal PDF.
  const infographic = config.infographics?.[config.findings.find((f) => f.key === decision.findings[0])?.infographic];
  const photoCols = stamped.length >= 3 ? 3 : stamped.length;
  const pdfHtml = path.join(dir, 'proposal.html');
  fs.writeFileSync(pdfHtml, fill('proposal.html', {
    ...model,
    headline: decision.pdfHeadline || `What ${model.techName} found at ${model.street}`,
    logoUrl: `file://${LOGO}`,
    date: Q.longDate(today),
    photos: stamped.map((s) => ({ url: `file://${s.path}`, caption: s.caption })),
    photoCols,
    photoHeight: photoCols === 1 ? 360 : photoCols === 2 ? 300 : 210,
    photoHeightCompact: photoCols === 1 ? 280 : photoCols === 2 ? 220 : 160,
    found: decision.found,
    why: decision.why || [],
    hasWhy: (decision.why || []).length > 0,
    checkedSentence: Q.checkedSentence(decision.checkedOk, model.visitPhrase === 'your inspection' ? 'the inspection' : 'the visit'),
    hasChecked: (decision.checkedOk || []).length > 0,
    infographicUrl: infographic && fs.existsSync(path.join(__dirname, infographic)) ? `file://${path.join(__dirname, infographic)}` : null,
    officePhone: config.officePhone,
    company: config.company,
  }));
  const page = await chrome.open(pdfHtml, { width: 816, height: 1056 });
  let pdf = await page.pdf();
  if (pdfPageCount(pdf) > 1) {
    await page.evaluate(`document.body.classList.add('compact')`);
    const compact = await page.pdf();
    if (pdfPageCount(compact) < pdfPageCount(pdf)) pdf = compact;
  }
  await page.close();
  if (pdfPageCount(pdf) > 2) throw new Error(`${model.key}: proposal is ${pdfPageCount(pdf)} pages; shorten found/why`);
  const pdfPath = path.join(dir, 'proposal.pdf');
  fs.writeFileSync(pdfPath, pdf);
  return { key: model.key, ts: decision.ts, plan: model.plan, cardPath, pdfPath, pdfPages: pdfPageCount(pdf), cardBytes: cardJpg.length, photos: stamped };
}

async function upload(r, config) {
  const cardId = await google.uploadShared({ folderId: config.driveFolderId, name: google.randomName('inspection-card', 'jpg'), mimeType: 'image/jpeg', data: fs.readFileSync(r.cardPath) });
  const pdfId = await google.uploadShared({ folderId: config.driveFolderId, name: google.randomName('Catchy-Pest-Inspection', 'pdf'), mimeType: 'application/pdf', data: fs.readFileSync(r.pdfPath) });
  const cardUrl = google.imageUrl(cardId);
  await google.checkPublicImage(cardUrl);
  return { cardUrl, pdfUrl: google.shareUrl(pdfId) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { values: ['posts', 'decisions'], flags: ['no-upload'] });
  if (!args.posts || !args.decisions) throw new Error('usage: render.js --posts posts.json --decisions decisions.json [--no-upload]');
  const config = loadConfig();
  const collected = JSON.parse(fs.readFileSync(args.posts, 'utf8'));
  const { decisions } = JSON.parse(fs.readFileSync(args.decisions, 'utf8'));
  const outDir = path.dirname(path.resolve(args.decisions));
  const today = collected.today || cal.toEastern(Date.now()).date;

  const problems = [];
  const quotes = decisions.filter((d) => d.action === 'quote');
  for (const d of quotes) {
    const post = collected.posts.find((p) => p.ts === d.ts);
    const errs = Q.checkDecision(d, post, config);
    if (!errs.length) {
      const m = Q.quoteModel(d, post, config, { today });
      const priceErr = Q.checkTextPrice(d.text.body, m);
      if (priceErr) errs.push(priceErr);
      const dayErr = Q.checkDayNames([d.text.body, ...(d.email.intro || []), ...(d.email.body || []), ...(d.email.closing || [])], m);
      if (dayErr) errs.push(dayErr);
    }
    if (errs.length) problems.push(`${d.ts}${d.plan ? `:${d.plan}` : ''}: ${errs.join('; ')}`);
  }
  if (problems.length) throw new Error(`fix decisions.json first: ${problems.join(' | ')}`);

  const rendered = [];
  const chrome = await launch();
  try {
    for (const d of quotes) rendered.push(await renderQuote(chrome, d, collected.posts.find((p) => p.ts === d.ts), config, today, outDir));
  } finally {
    await chrome.close();
  }
  if (!args['no-upload']) for (const r of rendered) Object.assign(r, await upload(r, config));
  const file = path.join(outDir, 'rendered.json');
  fs.writeFileSync(file, JSON.stringify({ rendered }, null, 2));
  process.stdout.write(`${JSON.stringify({ rendered: rendered.length, path: file, items: rendered.map((r) => ({ key: r.key, cardUrl: r.cardUrl || null, pdfUrl: r.pdfUrl || null, pdfPages: r.pdfPages })) })}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stdout.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  });
}

module.exports = { imageSize };
