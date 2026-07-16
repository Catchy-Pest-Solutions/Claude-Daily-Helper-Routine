// Given customer IDs (already identified by the earlier "today's appointments"
// step of the daily routine) and a Briostack client, resolves each customer's
// actual appointment record for today. Needed because the cross-sell check
// requires today's serviceCategoryId and serviceAddress, not just the ID.
async function fetchTodaysAppointments(customerIds, { getCustomerAppointments, today }) {
  const todaysAppointments = [];
  const missing = [];

  for (const customerId of customerIds) {
    const appointments = await getCustomerAppointments(customerId);
    const todayAppt = appointments.find((a) => a.appointmentDate === today);
    if (!todayAppt) {
      missing.push(customerId);
      continue;
    }
    todaysAppointments.push(todayAppt);
  }

  return { todaysAppointments, missing };
}

module.exports = { fetchTodaysAppointments };
