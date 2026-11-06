// Config and shared constants for the inspection findings routine.
const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FILE = path.join(__dirname, '..', 'config.json');
// Daniel's personal test phone and email stay out of the repo: they come
// from INSPECTION_TEST_PHONE / INSPECTION_TEST_EMAIL in the environment
// (config.json's testPhone/testEmail are null and only used if set).
function loadConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  config.testPhone = process.env.INSPECTION_TEST_PHONE || config.testPhone || null;
  config.testEmail = process.env.INSPECTION_TEST_EMAIL || config.testEmail || null;
  return config;
}

// Every Communications entry this routine writes starts with one of these;
// collect.js reads them back for the 90-day repeat check.
const LOG_PREFIX = '[INSPECTION FINDINGS]';
const TEST_LOG_PREFIX = '[INSPECTION FINDINGS — TEST, not sent to customer]';

module.exports = { loadConfig, CONFIG_FILE, LOG_PREFIX, TEST_LOG_PREFIX };
