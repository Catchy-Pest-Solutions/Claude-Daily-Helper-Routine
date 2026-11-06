#!/usr/bin/env node
// One-time setup: creates the Leads sheet in office@'s Drive (the routine's
// Google token can only edit files it created), shares it with Daniel, and
// saves its ID in config.json (sheet.testId or sheet.liveId).
//
//   node setup-sheet.js --test | --live
require('../lead-followup/lib/proxy');
const fs = require('node:fs');
const { parseArgs } = require('../lead-followup/lib/env');
const { loadConfig, CONFIG_FILE } = require('./lib/common');
const sheet = require('./lib/sheet');

(async () => {
  const args = parseArgs(process.argv.slice(2), { flags: ['test', 'live'] });
  if (!args.test === !args.live) throw new Error('pass --test or --live');
  const config = loadConfig();
  const field = args.test ? 'testId' : 'liveId';
  if (config.sheet[field]) throw new Error(`config.json already has sheet.${field} (${config.sheet[field]})`);
  const made = await sheet.createSheet({ name: `Inspection Findings Leads${args.test ? ' (TEST)' : ''}`, folderId: config.driveFolderId, shareWith: config.sheet.shareWith });
  const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  fs.writeFileSync(CONFIG_FILE, raw.replace(`"${field}": null`, `"${field}": "${made.id}"`));
  process.stdout.write(`${JSON.stringify({ id: made.id, url: made.url })}\n`);
})().catch((err) => {
  process.stdout.write(`${JSON.stringify({ error: err.message })}\n`);
  process.exit(1);
});
