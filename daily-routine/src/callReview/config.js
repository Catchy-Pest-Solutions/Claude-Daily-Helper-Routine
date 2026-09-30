// Office setup the call review depends on. Change it here when staffing,
// hours or the phone tree change.

module.exports = {
  atsCustomerId: 1299,

  // Office extensions. Daniel (101) doesn't take calls, but his outbound
  // calls still count as a callback.
  staff: {
    101: { name: 'Daniel', takesCalls: false },
    102: { name: 'Shelley', takesCalls: true, lunch: ['15:30', '16:30'] },
    103: { name: 'Steve', takesCalls: true, lunch: ['13:00', '14:00'] },
  },

  // Who gets the callback task. Steve leans new customers, Shelley current.
  assignee: { newCustomer: 103, currentCustomer: 102 },

  // ATS queues, as they appear in /search callee_name. The phone tree sends
  // "press 1" to New Customers and "press 2" to Existing Customers.
  queues: {
    190: { name: 'Existing Customers', callerType: 'current' },
    191: { name: 'New Customers', callerType: 'new' },
    192: { name: 'Saturday Queue', callerType: null },
    193: { name: 'Simple Talk Direct', callerType: null },
  },

  officeHours: { start: '08:00', end: '17:00' },

  // Weekly trend in Monday's report compares the last N full weeks.
  weeklyTrendWeeks: 2,
};
