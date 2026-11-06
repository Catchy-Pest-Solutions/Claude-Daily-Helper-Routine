#!/usr/bin/env node
// Renders the training pages to PDF with the cloud image's Chromium.
//
//   node inspection-findings/training/build.js [--out DIR]
//
// field-guide.html   -> Inspection Findings - Field Guide.pdf (1 page, print)
// tech-meeting.html  -> Inspection Findings - Tech Meeting.pdf (slides)
// office-meeting.html -> Inspection Findings - Office Meeting.pdf (slides)
const fs = require('node:fs');
const path = require('node:path');
const { launch, pdfPageCount } = require('../../lead-followup/lib/chrome');

const DOCS = [
  { html: 'field-guide.html', pdf: 'Inspection Findings - Field Guide.pdf', width: 816, height: 1056, maxPages: 1 },
  { html: 'tech-meeting.html', pdf: 'Inspection Findings - Tech Meeting.pdf', width: 1280, height: 720 },
  { html: 'office-meeting.html', pdf: 'Inspection Findings - Office Meeting.pdf', width: 1280, height: 720 },
];

(async () => {
  const i = process.argv.indexOf('--out');
  const out = path.resolve(i > 0 ? process.argv[i + 1] : path.join(__dirname, 'pdf'));
  fs.mkdirSync(out, { recursive: true });
  const chrome = await launch();
  try {
    for (const d of DOCS) {
      const src = path.join(__dirname, d.html);
      if (!fs.existsSync(src)) continue;
      const page = await chrome.open(src, { width: d.width, height: d.height });
      const pdf = await page.pdf();
      await page.close();
      const pages = pdfPageCount(pdf);
      if (d.maxPages && pages > d.maxPages) throw new Error(`${d.html} is ${pages} pages, over ${d.maxPages}`);
      fs.writeFileSync(path.join(out, d.pdf), pdf);
      console.log(`${d.pdf}: ${pages} page${pages > 1 ? 's' : ''}`);
    }
  } finally {
    await chrome.close().catch(() => {}); // Chromium may still be writing its temp profile
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
