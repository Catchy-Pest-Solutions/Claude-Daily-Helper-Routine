const { isWithinWindow } = require('./dateUtils');

const ACTIVE_SERVICE_STATUS = 'CSC_ACTIVE';
const PENDING_APPOINTMENT_STATUS = 'SVC_TICK_ACTIVE';
const DEFAULT_WINDOW_DAYS = 30;

function normalize(value) {
  return (value || '').trim().toLowerCase();
}

function sameAddress(a, b) {
  if (!a || !b) return false;
  return (
    normalize(a.address) === normalize(b.address) &&
    normalize(a.city) === normalize(b.city) &&
    normalize(a.stateOrProvince) === normalize(b.stateOrProvince) &&
    normalize(a.postalCode) === normalize(b.postalCode)
  );
}

function formatAddress(addr) {
  if (!addr) return '';
  return `${addr.address}, ${addr.city}, ${addr.stateOrProvince} ${addr.postalCode}`;
}

// primaryTechnicianId is absent entirely on the appointment record when a
// technician has not been assigned yet (confirmed on live data -- never an
// empty string, but we treat any falsy value as unassigned defensively).
function isUnassigned(appointment) {
  return !appointment.primaryTechnicianId;
}

function pickPendingAppointment(appointments, serviceId) {
  return appointments
    .filter((a) => a.serviceId === serviceId && a.statusId === PENDING_APPOINTMENT_STATUS)
    .sort((a, b) => (a.appointmentDate || '').localeCompare(b.appointmentDate || ''))[0];
}

function resolveDueDate(service, pendingAppointment) {
  if (service.nextAppointmentDate) {
    return { date: service.nextAppointmentDate, source: 'nextAppointmentDate' };
  }
  if (pendingAppointment.recommendedDate) {
    return { date: pendingAppointment.recommendedDate, source: 'recommendedDate (fallback)' };
  }
  return { date: null, source: 'none' };
}

async function checkCrossSellOpportunities(
  todaysAppointments,
  { getCustomerServices, getCustomerAppointments, today, windowDays = DEFAULT_WINDOW_DAYS },
) {
  const opportunities = [];
  const diagnostics = [];

  for (const todayAppt of todaysAppointments) {
    const services = await getCustomerServices(todayAppt.customerId);
    const candidates = services.filter(
      (s) => s.statusId === ACTIVE_SERVICE_STATUS && s.serviceCategoryId !== todayAppt.serviceCategoryId,
    );
    if (candidates.length === 0) continue;

    const appointments = await getCustomerAppointments(todayAppt.customerId);

    for (const service of candidates) {
      const pending = pickPendingAppointment(appointments, service.serviceId);
      if (!pending) {
        diagnostics.push({
          customerId: todayAppt.customerId,
          serviceId: service.serviceId,
          skipped: 'no pending appointment found for this active service',
        });
        continue;
      }

      if (!isUnassigned(pending)) {
        diagnostics.push({
          customerId: todayAppt.customerId,
          serviceId: service.serviceId,
          skipped: `technician already assigned (${pending.primaryTechnicianId})`,
        });
        continue;
      }

      const { date: dueDate, source: dueSource } = resolveDueDate(service, pending);

      if (
        service.nextAppointmentDate &&
        pending.recommendedDate &&
        service.nextAppointmentDate !== pending.recommendedDate
      ) {
        diagnostics.push({
          customerId: todayAppt.customerId,
          serviceId: service.serviceId,
          conflict: `nextAppointmentDate=${service.nextAppointmentDate} vs recommendedDate=${pending.recommendedDate}; used nextAppointmentDate`,
        });
      }

      if (!dueDate || !isWithinWindow(dueDate, today, windowDays)) {
        diagnostics.push({
          customerId: todayAppt.customerId,
          serviceId: service.serviceId,
          skipped: `due date ${dueDate ?? '(none)'} outside ${windowDays}-day window (source: ${dueSource})`,
        });
        continue;
      }

      if (!sameAddress(pending.serviceAddress, todayAppt.serviceAddress)) {
        diagnostics.push({
          customerId: todayAppt.customerId,
          serviceId: service.serviceId,
          skipped: 'different address than today\'s appointment',
        });
        continue;
      }

      opportunities.push({
        customerId: todayAppt.customerId,
        customerName: `${todayAppt.customerFirstName ?? ''} ${todayAppt.customerLastName ?? ''}`.trim(),
        address: formatAddress(pending.serviceAddress),
        serviceCategory: service.serviceCategoryName || service.serviceCategoryId,
        serviceId: service.serviceId,
        dueDate,
        dueSource,
      });
    }
  }

  return { opportunities, diagnostics };
}

module.exports = {
  checkCrossSellOpportunities,
  sameAddress,
  formatAddress,
  isUnassigned,
  resolveDueDate,
  pickPendingAppointment,
  ACTIVE_SERVICE_STATUS,
  PENDING_APPOINTMENT_STATUS,
};
