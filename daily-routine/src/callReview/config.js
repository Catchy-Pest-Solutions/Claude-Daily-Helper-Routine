// Office setup the call review depends on. Change it here when staffing,
// hours or the phone tree change.

module.exports = {
  atsCustomerId: 1299,

  // Office extensions. Daniel (101) doesn't take calls, but his outbound
  // calls still count as a callback.
  staff: {
    101: { name: 'Daniel', takesCalls: false, briostackEmployeeId: '12883' },
    102: { name: 'Shelley', takesCalls: true, lunch: ['15:30', '16:30'], briostackEmployeeId: '16195' },
    103: { name: 'Steve', takesCalls: true, lunch: ['13:00', '14:00'], briostackEmployeeId: '16635' },
  },

  // Who gets the callback task. Steve leans new customers, Shelley current.
  assignee: { newCustomer: 103, currentCustomer: 102 },

  // Briostack task type for callback tasks ("Call"). The API only accepts
  // existing type IDs; tasks aren't created if this is empty.
  taskTypeId: 'CALL',

  // Slack user to tag in the owner's report so the self-DM notifies.
  ownerSlackId: 'U09LQDUPQTC',

  // Double-call method for new-customer callbacks: if the first call isn't
  // picked up, call again 30-60s later and leave a voicemail on the second.
  doubleCall: { unansweredUnderSec: 20, secondCallWithinSec: 180 },

  // Likely robocalls get no callback task: caller ID is only a town
  // ("ANDERSON SC"), every call from the number sat silent on the phone
  // menu for about a minute (an autodialer waiting for a "hello"), and the
  // number isn't in Briostack. They're listed in the owner's report
  // instead. Set to null to turn the rule off.
  robocall: { menuSecMin: 55, menuSecMax: 65 },

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
