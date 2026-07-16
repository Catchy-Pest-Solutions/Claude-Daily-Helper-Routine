// Manual live smoke test against the real Briostack API. Not part of the
// automated test suite (needs network + credentials). Run with:
//   node test/live-smoke-test.js <customerId> [<customerId> ...]
const path = require('node:path');
process.loadEnvFile(path.join(__dirname, '..', '..', '.env'));

const { createBriostackClient } = require('../src/briostackClient');
const { fetchTodaysAppointments } = require('../src/fetchTodaysAppointments');
const { checkCrossSellOpportunities } = require('../src/crossSellCheck');
const { formatSlackMessage } = require('../src/formatSlackMessage');
const { todayInEastern } = require('../src/dateUtils');

async function main() {
  const customerIds = process.argv.slice(2);
  if (customerIds.length === 0) {
    console.error('Usage: node test/live-smoke-test.js <customerId> [<customerId> ...]');
    process.exit(1);
  }

  const client = createBriostackClient({
    baseUrl: process.env.BRIOSTACK_BASE_URL,
    apiKey: process.env.BRIOSTACK_API_KEY,
  });

  const today = todayInEastern();
  console.log(`Today (Eastern): ${today}`);

  const { todaysAppointments, missing } = await fetchTodaysAppointments(customerIds, {
    getCustomerAppointments: client.getCustomerAppointments,
    today,
  });
  if (missing.length) console.log(`No appointment today for: ${missing.join(', ')}`);

  const { opportunities, diagnostics } = await checkCrossSellOpportunities(todaysAppointments, {
    getCustomerServices: client.getCustomerServices,
    getCustomerAppointments: client.getCustomerAppointments,
    today,
  });

  console.log('\n--- diagnostics ---');
  console.log(JSON.stringify(diagnostics, null, 2));

  console.log('\n--- opportunities ---');
  console.log(JSON.stringify(opportunities, null, 2));

  console.log('\n--- Slack message ---');
  console.log(formatSlackMessage(opportunities) ?? '(none -- no message would be sent)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
