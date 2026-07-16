const test = require('node:test');
const assert = require('node:assert/strict');
const { checkCrossSellOpportunities } = require('../src/crossSellCheck');

const TODAY = '2026-07-16';

const ADDR_MAIN = {
  address: '1854 Hendersonville Rd',
  city: 'Asheville',
  stateOrProvince: 'NC',
  postalCode: '28803',
};

const ADDR_OTHER = {
  address: '99 Different Ln',
  city: 'Asheville',
  stateOrProvince: 'NC',
  postalCode: '28801',
};

function todayAppt(overrides = {}) {
  return {
    customerId: '10004',
    serviceCategoryId: 'GPCMONTHLY',
    serviceAddress: ADDR_MAIN,
    customerFirstName: 'Dan',
    customerLastName: 'TheBugMan',
    ...overrides,
  };
}

function makeDeps({ services, appointments }) {
  return {
    getCustomerServices: async () => services,
    getCustomerAppointments: async () => appointments,
    today: TODAY,
  };
}

test('case 1: second active service due in 15 days, unassigned -> appears', async () => {
  const services = [
    { serviceId: 'S2', serviceCategoryId: 'RODENT', serviceCategoryName: 'Rodent Control', statusId: 'CSC_ACTIVE', nextAppointmentDate: '2026-07-31' },
  ];
  const appointments = [
    { serviceId: 'S2', statusId: 'SVC_TICK_ACTIVE', appointmentDate: '2026-07-31', recommendedDate: '2026-07-31', serviceAddress: ADDR_MAIN },
  ];
  const { opportunities } = await checkCrossSellOpportunities([todayAppt()], makeDeps({ services, appointments }));
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].serviceCategory, 'Rodent Control');
});

test('case 2: past-due second service, unassigned -> appears', async () => {
  const services = [
    { serviceId: 'S2', serviceCategoryId: 'RODENT', serviceCategoryName: 'Rodent Control', statusId: 'CSC_ACTIVE', nextAppointmentDate: '2026-06-01' },
  ];
  const appointments = [
    { serviceId: 'S2', statusId: 'SVC_TICK_ACTIVE', appointmentDate: '2026-06-01', recommendedDate: '2026-06-01', serviceAddress: ADDR_MAIN },
  ];
  const { opportunities } = await checkCrossSellOpportunities([todayAppt()], makeDeps({ services, appointments }));
  assert.equal(opportunities.length, 1);
});

test('case 3: qualifying service already assigned to a tech -> excluded', async () => {
  const services = [
    { serviceId: 'S2', serviceCategoryId: 'RODENT', serviceCategoryName: 'Rodent Control', statusId: 'CSC_ACTIVE', nextAppointmentDate: '2026-07-31' },
  ];
  const appointments = [
    { serviceId: 'S2', statusId: 'SVC_TICK_ACTIVE', appointmentDate: '2026-07-31', recommendedDate: '2026-07-31', primaryTechnicianId: '17047', serviceAddress: ADDR_MAIN },
  ];
  const { opportunities, diagnostics } = await checkCrossSellOpportunities([todayAppt()], makeDeps({ services, appointments }));
  assert.equal(opportunities.length, 0);
  assert.ok(diagnostics.some((d) => d.skipped?.includes('technician already assigned')));
});

test('case 4: second service due in 45 days -> excluded (outside window)', async () => {
  const services = [
    { serviceId: 'S2', serviceCategoryId: 'RODENT', serviceCategoryName: 'Rodent Control', statusId: 'CSC_ACTIVE', nextAppointmentDate: '2026-08-30' },
  ];
  const appointments = [
    { serviceId: 'S2', statusId: 'SVC_TICK_ACTIVE', appointmentDate: '2026-08-30', recommendedDate: '2026-08-30', serviceAddress: ADDR_MAIN },
  ];
  const { opportunities } = await checkCrossSellOpportunities([todayAppt()], makeDeps({ services, appointments }));
  assert.equal(opportunities.length, 0);
});

test('case 5: customer with only one service -> excluded', async () => {
  const services = [
    { serviceId: 'S1', serviceCategoryId: 'GPCMONTHLY', serviceCategoryName: 'General Pest Control', statusId: 'CSC_ACTIVE', nextAppointmentDate: '2026-08-01' },
  ];
  const { opportunities } = await checkCrossSellOpportunities([todayAppt()], makeDeps({ services, appointments: [] }));
  assert.equal(opportunities.length, 0);
});

test('case 6: no qualifying customers at all -> empty result, no message', async () => {
  const services = [
    { serviceId: 'S1', serviceCategoryId: 'GPCMONTHLY', serviceCategoryName: 'General Pest Control', statusId: 'CSC_ACTIVE', nextAppointmentDate: '2026-08-01' },
  ];
  const { opportunities } = await checkCrossSellOpportunities([todayAppt()], makeDeps({ services, appointments: [] }));
  const { formatSlackMessage } = require('../src/formatSlackMessage');
  assert.equal(opportunities.length, 0);
  assert.equal(formatSlackMessage(opportunities), null);
});

test('case 7: second service at a different address -> excluded', async () => {
  const services = [
    { serviceId: 'S2', serviceCategoryId: 'RODENT', serviceCategoryName: 'Rodent Control', statusId: 'CSC_ACTIVE', nextAppointmentDate: '2026-07-31' },
  ];
  const appointments = [
    { serviceId: 'S2', statusId: 'SVC_TICK_ACTIVE', appointmentDate: '2026-07-31', recommendedDate: '2026-07-31', serviceAddress: ADDR_OTHER },
  ];
  const { opportunities, diagnostics } = await checkCrossSellOpportunities([todayAppt()], makeDeps({ services, appointments }));
  assert.equal(opportunities.length, 0);
  assert.ok(diagnostics.some((d) => d.skipped?.includes('different address')));
});

// Additional coverage based on live-API findings during verification.

test('non-active service status (e.g. CSC_HOLD) is excluded even if categories differ', async () => {
  const services = [
    { serviceId: 'S2', serviceCategoryId: 'RODENT', serviceCategoryName: 'Rodent Control', statusId: 'CSC_HOLD', nextAppointmentDate: '2026-07-20' },
  ];
  const { opportunities } = await checkCrossSellOpportunities([todayAppt()], makeDeps({ services, appointments: [] }));
  assert.equal(opportunities.length, 0);
});

test('same service category as today is excluded even if otherwise qualifying', async () => {
  const services = [
    { serviceId: 'S2', serviceCategoryId: 'GPCMONTHLY', serviceCategoryName: 'General Pest Control', statusId: 'CSC_ACTIVE', nextAppointmentDate: '2026-07-20' },
  ];
  const appointments = [
    { serviceId: 'S2', statusId: 'SVC_TICK_ACTIVE', appointmentDate: '2026-07-20', serviceAddress: ADDR_MAIN },
  ];
  const { opportunities } = await checkCrossSellOpportunities([todayAppt()], makeDeps({ services, appointments }));
  assert.equal(opportunities.length, 0);
});

test('falls back to recommendedDate when nextAppointmentDate is empty', async () => {
  const services = [
    { serviceId: 'S2', serviceCategoryId: 'RODENT', serviceCategoryName: 'Rodent Control', statusId: 'CSC_ACTIVE', nextAppointmentDate: null },
  ];
  const appointments = [
    { serviceId: 'S2', statusId: 'SVC_TICK_ACTIVE', appointmentDate: '2026-07-25', recommendedDate: '2026-07-25', serviceAddress: ADDR_MAIN },
  ];
  const { opportunities } = await checkCrossSellOpportunities([todayAppt()], makeDeps({ services, appointments }));
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].dueSource, 'recommendedDate (fallback)');
});

test('nextAppointmentDate vs recommendedDate conflict: nextAppointmentDate wins and is flagged', async () => {
  // Mirrors real data observed: recommendedDate can be an earlier, superseded
  // "ideal" date while nextAppointmentDate reflects the actually-scheduled visit.
  const services = [
    { serviceId: 'S2', serviceCategoryId: 'RODENT', serviceCategoryName: 'Rodent Control', statusId: 'CSC_ACTIVE', nextAppointmentDate: '2026-07-20' },
  ];
  const appointments = [
    { serviceId: 'S2', statusId: 'SVC_TICK_ACTIVE', appointmentDate: '2026-07-20', recommendedDate: '2026-06-01', serviceAddress: ADDR_MAIN },
  ];
  const { opportunities, diagnostics } = await checkCrossSellOpportunities([todayAppt()], makeDeps({ services, appointments }));
  assert.equal(opportunities.length, 1);
  assert.equal(opportunities[0].dueDate, '2026-07-20');
  assert.equal(opportunities[0].dueSource, 'nextAppointmentDate');
  assert.ok(diagnostics.some((d) => d.conflict?.includes('nextAppointmentDate=2026-07-20 vs recommendedDate=2026-06-01')));
});

test('active service with no pending appointment at all is skipped, not errored', async () => {
  const services = [
    { serviceId: 'S2', serviceCategoryId: 'RODENT', serviceCategoryName: 'Rodent Control', statusId: 'CSC_ACTIVE', nextAppointmentDate: '2026-07-20' },
  ];
  const { opportunities, diagnostics } = await checkCrossSellOpportunities([todayAppt()], makeDeps({ services, appointments: [] }));
  assert.equal(opportunities.length, 0);
  assert.ok(diagnostics.some((d) => d.skipped?.includes('no pending appointment found')));
});

test('exact boundary: due date exactly today+30 is included; today+31 is excluded', async () => {
  const servicesIn = [
    { serviceId: 'S2', serviceCategoryId: 'RODENT', serviceCategoryName: 'Rodent Control', statusId: 'CSC_ACTIVE', nextAppointmentDate: '2026-08-15' },
  ];
  const apptsIn = [
    { serviceId: 'S2', statusId: 'SVC_TICK_ACTIVE', appointmentDate: '2026-08-15', serviceAddress: ADDR_MAIN },
  ];
  const { opportunities: within } = await checkCrossSellOpportunities([todayAppt()], makeDeps({ services: servicesIn, appointments: apptsIn }));
  assert.equal(within.length, 1);

  const servicesOut = [
    { serviceId: 'S2', serviceCategoryId: 'RODENT', serviceCategoryName: 'Rodent Control', statusId: 'CSC_ACTIVE', nextAppointmentDate: '2026-08-16' },
  ];
  const apptsOut = [
    { serviceId: 'S2', statusId: 'SVC_TICK_ACTIVE', appointmentDate: '2026-08-16', serviceAddress: ADDR_MAIN },
  ];
  const { opportunities: outside } = await checkCrossSellOpportunities([todayAppt()], makeDeps({ services: servicesOut, appointments: apptsOut }));
  assert.equal(outside.length, 0);
});
