// Renders the WDIR 100 report PDF with Chrome: the official form pages
// (vector copies of the NCPCA fillable PDF, wdir/assets) with every value
// placed on its field, Daniel's signature, the addendum page when a
// description doesn't fit its box, then the technician's photos.
// One print, no PDF libraries.
const fs = require('node:fs');
const path = require('node:path');
const { pdfPageCount } = require('../../lead-followup/lib/chrome');
const { escapeHtml: esc } = require('../../lead-followup/lib/template');

const ASSETS = path.join(__dirname, '..', 'assets');
const { fields: FIELDS } = JSON.parse(fs.readFileSync(path.join(ASSETS, 'wdir100-fields.json'), 'utf8'));
const PAGE_H = 792;
const ADDENDUM_LINES = 40;
const PHOTOS_PER_PAGE = 2;

// CSS box (points, top-left origin) for a field.
function box(name) {
  const f = FIELDS[name];
  if (!f) throw new Error(`no WDIR field ${name}`);
  const [x1, y1, x2, y2] = f.rect;
  return `left:${x1}pt;top:${PAGE_H - y2}pt;width:${x2 - x1}pt;height:${y2 - y1}pt;`;
}

const text = (name, value, cls = 'line') => (value ? `<div class="f ${cls}" data-field="${name}" style="${box(name)}">${esc(value)}</div>` : '');
const check = (name, on) => (on ? `<div class="f check" style="${box(name)}">X</div>` : '');
// Words spread over a field's printed lines (section 2, section 5, the
// addendum); the page's fit() fills them and reports what didn't fit.
const lines = (group, names, value) => `${names.map((n) => `<div class="f line" data-group="${group}" style="${box(n)}"></div>`).join('')}<div hidden data-text="${group}" data-value="${esc(value || '')}"></div>`;

function formPages(m, { signatureUri, watermark, overflow = {}, addendum = null }) {
  const loc = (i) => (overflow[i.locField] ? 'See addendum.' : i.location);
  const insectFields = m.insects.map((i) => [
    check(i.field, i.found),
    i.found ? check(i.boxes[i.box - 1], true) : '',
    i.key === 'others' ? text('OthersType', i.type) : '',
    text(i.locField, loc(i), 'multi'),
  ].join('')).join('');
  const wm = watermark ? `<div class="wm">${esc(watermark)}</div>` : '';
  const page1 = `<section class="page"><img class="bg" src="file://${ASSETS}/wdir100-page1.svg" alt="">
    ${text('SellersNames', m.sellers)}${text('BuyersNames', m.buyers)}${text('_propertyAddress', m.address)}
    ${check('StructuresInspectedMainResidenceOnly', !m.otherStructures)}${check('StructuresInspectedOther', Boolean(m.otherStructures))}${text('StructuresInspectedOtherType', m.otherStructures)}
    ${lines('inaccessible', ['PropertyAreasDeemedObstructedorInaccessible1', 'PropertyAreasDeemedObstructedorInaccessible2', 'PropertyAreasDeemedObstructedorInaccessible3'], overflow.inaccessible || m.inaccessible)}
    ${insectFields}
    ${check('NoVisibleEvidence', m.noVisibleEvidence)}${check('ConduciveConditions', m.conducive.length > 0)}
    ${lines('conducive', ['ConduciveConditions1', 'ConduciveConditions2'], overflow.conducive || m.conducive.join(' '))}
    ${text('companyName', m.firm.name)}${text('companyLicenseNumber', m.firm.license)}${text('AuthorizedCompanyRepSignatureDate', m.dateSlash)}
    ${text('_companyAddressCity', `${m.firm.street}, ${m.firm.city}`)}${text('companyState', m.firm.state)}${text('companyZip', m.firm.zip)}
    ${text('customerServiceNumber', m.firm.phone)}${text('AuthorizedCompanyRepTitle', m.firm.title)}
    ${signatureUri ? `<img class="sig" src="${signatureUri}" style="${box('_signature')}" alt="">` : ''}${wm}</section>`;
  const page2 = `<section class="page"><img class="bg" src="file://${ASSETS}/wdir100-page2.svg" alt="">
    ${text('Remarks', m.remarksText, 'multi')}${wm}</section>`;
  const page3 = addendum ? `<section class="page"><img class="bg" src="file://${ASSETS}/wdir100-addendum.svg" alt="">
    ${text('techName', m.inspector)}${text('InspectionReportAddendumDate', m.dateSlash)}
    ${text('serviceAddress', m.street)}${text('serviceCity', m.city)}${text('serviceState', m.state)}${text('serviceZip', m.zip)}
    ${lines('addendum', Array.from({ length: ADDENDUM_LINES }, (_, i) => `InspectionReportAddendumFinding${i + 1}`), addendum)}${wm}</section>` : '';
  return page1 + page2 + page3;
}

function photoPages(m, stamped, { firstPage, totalPages, watermark }) {
  const pages = [];
  for (let i = 0; i < stamped.length; i += PHOTOS_PER_PAGE) pages.push(stamped.slice(i, i + PHOTOS_PER_PAGE));
  return pages.map((group, pi) => `<section class="page photos">
    <header><b>Photographs: Official North Carolina Wood-Destroying Insect Information Report</b>
      <span>${esc(m.address)} &middot; Inspected ${esc(m.dateLong)} &middot; File No. ${esc(m.fileNumber)}</span></header>
    ${group.map((p) => `<figure><div class="img"><img src="file://${p.path}" alt=""></div><figcaption><b>Photo ${p.n}.</b> ${esc(p.caption)}</figcaption></figure>`).join('')}
    <footer><span>${esc(m.firm.name)} &middot; PCO Lic No. ${esc(m.firm.license)} &middot; ${esc(m.firm.phone)}</span><span>Page ${firstPage + pi} of ${totalPages}</span></footer>
    ${watermark ? `<div class="wm">${esc(watermark)}</div>` : ''}</section>`).join('');
}

const CSS = `
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, "Liberation Sans", sans-serif; color: #000; }
  .page { position: relative; width: 612pt; height: 792pt; overflow: hidden; page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .bg { position: absolute; left: 0; top: 0; width: 612pt; height: 792pt; }
  .f { position: absolute; font-size: 8pt; line-height: 1.12; color: #0B1F4D; overflow: hidden; }
  .f.line { white-space: nowrap; display: flex; align-items: flex-end; padding: 0 2pt 1pt; }
  .f.multi { padding: 2pt 3pt; white-space: pre-wrap; }
  .f.check { font-weight: bold; font-size: 9pt; display: flex; align-items: center; justify-content: center; color: #0B1F4D; }
  .sig { position: absolute; object-fit: contain; object-position: left bottom; mix-blend-mode: multiply; }
  .wm { position: absolute; left: 0; right: 0; top: 330pt; text-align: center; font-size: 46pt; font-weight: bold; color: rgba(200, 0, 0, .16); transform: rotate(-30deg); pointer-events: none; }
  .photos { padding: 36pt 40pt 30pt; display: flex; flex-direction: column; gap: 12pt; }
  .photos header { border-bottom: 3pt solid #15BA0D; padding-bottom: 6pt; font-size: 10pt; line-height: 1.4; }
  .photos header span { display: block; font-size: 9pt; color: #333; }
  .photos figure { flex: 1 1 0; display: flex; flex-direction: column; min-height: 0; }
  .photos .img { flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; background: #F3F5F3; }
  .photos .img img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .photos figcaption { font-size: 9.5pt; padding-top: 5pt; line-height: 1.35; }
  .photos footer { display: flex; justify-content: space-between; font-size: 8pt; color: #555; border-top: 1px solid #ccc; padding-top: 4pt; }
`;

// In the page: shrink each multi-line box until it fits (8pt down to
// 6.5pt), fill line groups word by word, and report what didn't fit.
const FIT = `(() => {
  const over = { boxes: [], groups: {} };
  for (const el of document.querySelectorAll('.f.multi')) {
    let size = 8;
    while (el.scrollHeight > el.clientHeight + 0.5 && size > 6.5) { size -= 0.25; el.style.fontSize = size + 'pt'; }
    if (el.scrollHeight > el.clientHeight + 0.5) over.boxes.push(el.dataset.field);
  }
  for (const el of document.querySelectorAll('.f.line[data-field]')) {
    let size = 8;
    while (el.scrollWidth > el.clientWidth + 0.5 && size > 6) { size -= 0.25; el.style.fontSize = size + 'pt'; }
  }
  for (const src of document.querySelectorAll('[data-text]')) {
    const group = src.dataset.text;
    const paras = src.dataset.value.split(/\\n\\s*\\n/).map((p) => p.split(/\\s+/).filter(Boolean));
    const els = [...document.querySelectorAll('[data-group="' + group + '"]')];
    let li = 0;
    for (const [pi, words] of paras.entries()) {
      if (pi > 0 && li < els.length && els[li - 1] && els[li - 1].textContent) li++;
      let wi = 0;
      while (wi < words.length && li < els.length) {
        const el = els[li];
        let n = 0;
        el.textContent = '';
        while (wi + n < words.length) {
          el.textContent = words.slice(wi, wi + n + 1).join(' ');
          if (el.scrollWidth > el.clientWidth + 0.5) { if (n === 0) n = 1; else el.textContent = words.slice(wi, wi + n).join(' '); break; }
          n++;
        }
        wi += n;
        li++;
      }
      if (wi < words.length) { over.groups[group] = true; break; }
    }
  }
  return over;
})()`;

// A photo scaled to 1400 px wide JPEG (under ~400 KB) so the report stays
// small enough to email. Chrome applies the camera's orientation.
async function shrinkPhoto(chrome, src, out) {
  const html = `${out}.html`;
  fs.writeFileSync(html, `<!doctype html><html><body style="margin:0;background:#fff"><img id="p" src="file://${src}" style="display:block;width:1400px;height:auto"></body></html>`);
  const page = await chrome.open(html, { width: 1400, height: 1000 });
  const h = await page.evaluate('document.getElementById("p").getBoundingClientRect().height');
  await page.setHeight(Math.max(200, Math.round(h)));
  let jpg;
  for (const q of [82, 74, 66, 58]) {
    jpg = await page.screenshotJpeg(q);
    if (jpg.length <= 400 * 1024) break;
  }
  await page.close();
  fs.writeFileSync(out, jpg);
  return out;
}

// Renders the report. signature: PNG bytes (null only for a watermarked
// sample). Returns { pdfPath, pages, addendum }.
async function renderWdir(chrome, m, { dir, signature, watermark = null }) {
  fs.mkdirSync(dir, { recursive: true });
  if (!signature && !watermark) throw new Error('the report needs Daniel\'s signature (config wdir.signatureDriveFileId)');
  const signatureUri = signature ? `data:image/png;base64,${Buffer.from(signature).toString('base64')}` : null;
  const stamped = [];
  for (const p of m.photos) stamped.push({ ...p, path: await shrinkPhoto(chrome, p.photo.path, path.join(dir, `photo-${p.n}.jpg`)) });

  const build = (opts) => {
    const formCount = 2 + (opts.addendum ? 1 : 0);
    const photoCount = Math.ceil(stamped.length / PHOTOS_PER_PAGE);
    const total = formCount + photoCount;
    const remarks = [...m.remarks];
    if (photoCount) remarks.push(`Photographs attached: ${photoCount === 1 ? `page ${formCount + 1}` : `pages ${formCount + 1}-${total}`}.`);
    if (opts.addendum) remarks.push(`Continued on the attached addendum (page 3).`);
    const model = { ...m, remarksText: remarks.join('\n') };
    return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${formPages(model, { signatureUri, watermark, ...opts })}${photoPages(m, stamped, { firstPage: formCount + 1, totalPages: total, watermark })}</body></html>`;
  };
  const html = path.join(dir, 'wdir.html');

  // Pass 1: what doesn't fit its box goes on the addendum (pass 2).
  fs.writeFileSync(html, build({}));
  let page = await chrome.open(html, { width: 816, height: 1056 });
  const over = await page.evaluate(FIT);
  await page.close();
  const addendumParts = [];
  const overflow = {};
  if (over.groups.inaccessible) {
    overflow.inaccessible = '';
    addendumParts.push(`2. Areas of the property deemed obstructed or inaccessible: ${m.inaccessible}`);
  }
  for (const i of m.insects) {
    if (over.boxes.includes(i.locField)) {
      overflow[i.locField] = true;
      addendumParts.push(`3${i.letter}. ${i.key === 'others' ? `Others (${i.type})` : i.label}, location of visible evidence: ${i.location}`);
    }
  }
  if (over.groups.conducive) {
    overflow.conducive = '';
    addendumParts.push(`5. Conditions conducive to subterranean termites: ${m.conducive.join(' ')}`);
  }
  if (over.boxes.includes('Remarks')) throw new Error('remarks are too long for the Remarks box; shorten them');
  let addendum = null;
  if (addendumParts.length) {
    addendum = addendumParts.join('\n\n');
    // Lines on page 1 that continue on the addendum keep what fits.
    if ('inaccessible' in overflow) overflow.inaccessible = 'See addendum.';
    if ('conducive' in overflow) overflow.conducive = 'See addendum.';
    fs.writeFileSync(html, build({ overflow, addendum }));
    page = await chrome.open(html, { width: 816, height: 1056 });
    const again = await page.evaluate(FIT);
    if (again.groups.addendum) {
      await page.close();
      throw new Error('the findings are too long even for the addendum page (40 lines); shorten them');
    }
  } else {
    page = await chrome.open(html, { width: 816, height: 1056 });
    await page.evaluate(FIT);
  }
  const pdf = await page.pdf();
  await page.close();
  const pdfPath = path.join(dir, 'wdir-report.pdf');
  fs.writeFileSync(pdfPath, pdf);
  return { pdfPath, pages: pdfPageCount(pdf), addendum: Boolean(addendum), bytes: pdf.length };
}

module.exports = { renderWdir, FIELDS };
