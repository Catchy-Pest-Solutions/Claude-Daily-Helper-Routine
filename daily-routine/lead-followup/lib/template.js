// A tiny Mustache-style filler for the fixed templates in ../templates.
//   {{name}}            escaped value (dotted paths work: {{customer.name}})
//   {{{name}}}          raw value (only for HTML the scripts build themselves)
//   {{#name}}..{{/name}} repeat for each item of an array, or show if truthy
//   {{^name}}..{{/name}} show if falsy or an empty array
//   {{.}}               the current item inside a list of strings
const fs = require('node:fs');
const path = require('node:path');

const TEMPLATES = path.join(__dirname, '..', 'templates');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\{/g, '&#123;');
}

function lookup(stack, name) {
  if (name === '.') return stack[stack.length - 1];
  const parts = name.split('.');
  for (let i = stack.length - 1; i >= 0; i--) {
    const ctx = stack[i];
    if (ctx && typeof ctx === 'object' && parts[0] in ctx) {
      return parts.reduce((v, p) => (v == null ? v : v[p]), ctx);
    }
  }
  return undefined;
}

const SECTION = /\{\{([#^])\s*([\w.]+)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/;

function renderString(tpl, stack) {
  let out = tpl;
  // Sections, outermost first; a nested section is rendered with its item on the stack.
  for (let m = SECTION.exec(out); m; m = SECTION.exec(out)) {
    const [whole, kind, name, inner] = m;
    const value = lookup(stack, name);
    const empty = value == null || value === false || value === '' || (Array.isArray(value) && value.length === 0);
    let rendered = '';
    if (kind === '^') rendered = empty ? renderString(inner, stack) : '';
    else if (Array.isArray(value)) rendered = value.map((item) => renderString(inner, [...stack, item])).join('');
    else if (!empty) rendered = renderString(inner, typeof value === 'object' ? [...stack, value] : stack);
    out = out.slice(0, m.index) + rendered + out.slice(m.index + whole.length);
  }
  return out
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, n) => String(lookup(stack, n) ?? ''))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, n) => escapeHtml(lookup(stack, n)));
}

function render(templateName, data) {
  const tpl = fs.readFileSync(path.join(TEMPLATES, templateName), 'utf8');
  return renderString(tpl, [data]);
}

module.exports = { render, renderString, escapeHtml, TEMPLATES };
