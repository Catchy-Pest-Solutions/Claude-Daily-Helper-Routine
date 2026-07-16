#!/usr/bin/env node
// Daily routine step: same-address cross-sell scheduling check.
//
// Usage: node src/cli.js <customerId> [<customerId> ...]
//
// Reads customer IDs (already identified by the earlier "today's
// appointments" step of the routine) as CLI args, or as a JSON array on
// stdin if no args are given. Prints a JSON result to stdout:
//   { opportunities, diagnostics, slackMessage }
// The routine step should send `slackMessage` to #office-only only when it
// is non-null (i.e. only when at least one opportunity qualified).
const path = require('node:path');

try {
  process.loadEnvFile(path.join(__dirname, '..', '..', '.env'));
} catch {
  // .env not present (e.g. in CI); rely on already-exported env vars.
}

const { createBriostackClient } = require('./briostackClient');
const { fetchTodaysAppointments } = require('./fetchTodaysAppointments');
const { checkCrossSellOpportunities } = require('./crossSellCheck');
const { formatSlackMessage } = require('./formatSlackMessage');
const { todayInEastern } = require('./dateUtils');

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function main() {
  let customerIds = process.argv.slice(2);

  if (customerIds.length === 0 && !process.stdin.isTTY) {
    const raw = await readStdin();
    if (raw.trim()) customerIds = JSON.parse(raw);
  }

  if (customerIds.length === 0) {
    console.error('Usage: node src/cli.js <customerId> [<customerId> ...]  (or pipe a JSON array on stdin)');
    process.exit(1);
  }

  const client = createBriostackClient({
    baseUrl: process.env.BRIOSTACK_BASE_URL,
    apiKey: process.env.BRIOSTACK_API_KEY,
  });

  const today = todayInEastern();

  const { todaysAppointments, missing } = await fetchTodaysAppointments(customerIds, {
    getCustomerAppointments: client.getCustomerAppointments,
    today,
  });

  const { opportunities, diagnostics } = await checkCrossSellOpportunities(todaysAppointments, {
    getCustomerServices: client.getCustomerServices,
    getCustomerAppointments: client.getCustomerAppointments,
    today,
  });

  process.stdout.write(
    JSON.stringify(
      {
        today,
        customersMissingTodayAppointment: missing,
        opportunities,
        diagnostics,
        slackMessage: formatSlackMessage(opportunities),
        slackChannelId: process.env.SLACK_CHANNEL_ID || null,
      },
      null,
      2,
    ) + '\n',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
