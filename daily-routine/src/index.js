const { createBriostackClient } = require('./briostackClient');
const { checkCrossSellOpportunities } = require('./crossSellCheck');
const { formatSlackMessage } = require('./formatSlackMessage');
const { todayInEastern } = require('./dateUtils');

// todaysAppointments: the Appointment records for today, as already fetched
// by the earlier step of the daily routine (each needs at minimum:
// customerId, serviceCategoryId, serviceAddress, customerFirstName,
// customerLastName).
async function runCrossSellCheck(todaysAppointments, { baseUrl, apiKey, today } = {}) {
  const client = createBriostackClient({
    baseUrl: baseUrl || process.env.BRIOSTACK_BASE_URL,
    apiKey: apiKey || process.env.BRIOSTACK_API_KEY,
  });

  const { opportunities, diagnostics } = await checkCrossSellOpportunities(todaysAppointments, {
    getCustomerServices: client.getCustomerServices,
    getCustomerAppointments: client.getCustomerAppointments,
    today: today || todayInEastern(),
  });

  return { opportunities, diagnostics, slackMessage: formatSlackMessage(opportunities) };
}

module.exports = { runCrossSellCheck };
