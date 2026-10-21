#!/usr/bin/env node
// Quote card picture + quote PDF for an unbooked lead (ROUTINE_PROMPT Step 3b).
//
//   node render.js --quote $S/quote.json --out $S [--no-upload]
//
// Fills templates/card.html and templates/quote.html from quote.json, renders
// them with headless Chromium (no npm packages needed), uploads both to the
// "AI Follow-ups" Drive folder under long random names, shares them "Anyone
// with the link", and prints one JSON line:
//   {"cardPath","pdfPath","cardUrl","pdfUrl"}
// cardUrl is the lh3 picture link Textable can fetch; pdfUrl is the normal
// Drive share link. --no-upload skips Drive (local design checks only).
require('./lib/proxy');
const fs = require('node:fs');
const path = require('node:path');
const { loadConfig, parseArgs } = require('./lib/env');
const { render } = require('./lib/template');
const { launch, pdfPageCount } = require('./lib/chrome');
const google = require('./lib/google');

const CARD = { width: 1080, height: 1350, maxBytes: 300 * 1024 };
const LOGO = path.join(__dirname, 'assets', 'logo-print.png');

// "$647", "647", 647, "$1,047.00" -> "$647" / "$1,047"; null stays null.
function money(value, field) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${field} isn't a price: ${JSON.stringify(value)}`);
  if (!Number.isInteger(n)) throw new Error(`${field} must be whole dollars: ${JSON.stringify(value)}`);
  return `$${n.toLocaleString('en-US')}`;
}

function longDate(ms = Date.now()) {
  return new Date(ms).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' });
}

// ["tomorrow", "Thursday"] -> "tomorrow or Thursday"
const orList = (days) => (days.length > 1 ? `${days.slice(0, -1).join(', ')} or ${days[days.length - 1]}` : days[0] || '');

function viewModel(quote, config) {
  const options = Array.isArray(quote.options) ? quote.options : [];
  if (options.length < 1 || options.length > 2) throw new Error('quote.json needs one or two options');
  const discount = quote.discount && quote.discount.percent ? quote.discount : null;
  const opts = options.map((o, i) => {
    if (!o || !o.name) throw new Error(`option ${i + 1} has no name`);
    const price = money(o.price, `options[${i}].price`);
    if (!price) throw new Error(`option ${i + 1} has no price`);
    const wasPrice = money(o.wasPrice, `options[${i}].wasPrice`);
    return {
      label: options.length > 1 ? `Option ${String.fromCharCode(65 + i)}` : 'Your option',
      name: String(o.name).trim(),
      bestFor: o.bestFor || null,
      includes: Array.isArray(o.includes) ? o.includes.filter(Boolean) : [],
      schedule: o.schedule || null,
      guarantee: o.guarantee || null,
      price,
      wasPrice: discount ? wasPrice : null,
      priceNote: o.priceNote || null,
      cardLine: o.priceNote || o.bestFor || '',
    };
  });
  if (discount && opts.some((o) => !o.wasPrice)) throw new Error('a discount needs wasPrice on every option');
  const closeDays = Array.isArray(quote.closeDays) ? quote.closeDays.filter(Boolean) : [];
  if (!closeDays.length) throw new Error('quote.json has no closeDays');
  const firstName = String(quote.firstName || '').trim();
  return {
    logoUrl: `file://${LOGO}`,
    title: firstName ? `Your quote, ${firstName}` : 'Your quote',
    customerName: String(quote.customerName || '').trim() || firstName || 'Valued customer',
    serviceAddress: quote.serviceAddress || '',
    preparedBy: quote.preparedBy || '',
    concern: quote.concern || '',
    date: longDate(),
    options: opts,
    optionCount: opts.length,
    optionCountText: opts.length > 1 ? 'Two options' : 'One option',
    layout: opts.length > 1 ? 'double' : 'single',
    discountBadge: discount ? `${discount.percent}% off — ${discount.reason}` : null,
    closeDaysText: orList(closeDays),
    officePhone: config.officePhone,
    senderEmail: config.senderEmail,
    company: config.company,
  };
}

async function renderFiles(vm, outDir) {
  const cardHtml = path.join(outDir, 'card.html');
  const quoteHtml = path.join(outDir, 'quote.html');
  fs.writeFileSync(cardHtml, render('card.html', vm));
  fs.writeFileSync(quoteHtml, render('quote.html', vm));
  const cardPath = path.join(outDir, 'quote-card.jpg');
  const pdfPath = path.join(outDir, 'quote.pdf');

  const chrome = await launch();
  try {
    const card = await chrome.open(cardHtml, CARD);
    const overflows = () =>
      card.evaluate(
        `(() => { const m = document.querySelector('main'); return m.scrollHeight > m.clientHeight + 1 || document.body.scrollHeight > ${CARD.height}; })()`,
      );
    if (await overflows()) {
      await card.evaluate(`document.body.classList.add('compact')`);
      if (await overflows()) throw new Error('card text is too long to fit; shorten the option names or priceNote');
    }
    let jpg;
    for (const q of [90, 84, 78, 70, 60, 50]) {
      jpg = await card.screenshotJpeg(q);
      if (jpg.length <= CARD.maxBytes) break;
    }
    if (jpg.length > CARD.maxBytes) throw new Error(`card picture is ${Math.round(jpg.length / 1024)} KB, over 300 KB`);
    fs.writeFileSync(cardPath, jpg);
    await card.close();

    const page = await chrome.open(quoteHtml, { width: 816, height: 1056 });
    const pdf = await page.pdf();
    const pages = pdfPageCount(pdf);
    if (pages > 2) throw new Error(`quote PDF is ${pages} pages; shorten the includes lists`);
    fs.writeFileSync(pdfPath, pdf);
    await page.close();
    return { cardPath, pdfPath, cardBytes: jpg.length, pdfPages: pages };
  } finally {
    await chrome.close();
  }
}

async function upload(files, config) {
  if (!config.driveFolderId) throw new Error('config.json has no driveFolderId');
  const cardId = await google.uploadShared({
    folderId: config.driveFolderId,
    name: google.randomName('quote-card', 'jpg'),
    mimeType: 'image/jpeg',
    data: fs.readFileSync(files.cardPath),
  });
  const pdfId = await google.uploadShared({
    folderId: config.driveFolderId,
    name: google.randomName('Catchy-Pest-Quote', 'pdf'),
    mimeType: 'application/pdf',
    data: fs.readFileSync(files.pdfPath),
  });
  const cardUrl = google.imageUrl(cardId);
  await google.checkPublicImage(cardUrl);
  return { cardUrl, pdfUrl: google.shareUrl(pdfId) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { values: ['quote', 'out'], flags: ['no-upload'] });
  if (!args.quote || !args.out) throw new Error('usage: render.js --quote quote.json --out DIR [--no-upload]');
  const config = loadConfig();
  const quote = JSON.parse(fs.readFileSync(args.quote, 'utf8'));
  fs.mkdirSync(args.out, { recursive: true });
  const files = await renderFiles(viewModel(quote, config), path.resolve(args.out));
  const links = args['no-upload'] ? { cardUrl: null, pdfUrl: null } : await upload(files, config);
  process.stdout.write(`${JSON.stringify({ cardPath: files.cardPath, pdfPath: files.pdfPath, ...links })}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stdout.write(`${JSON.stringify({ error: err.message })}\n`);
    process.exit(1);
  });
}

module.exports = { viewModel, money, orList, longDate };
