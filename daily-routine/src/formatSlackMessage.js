function formatSlackMessage(opportunities) {
  if (!opportunities.length) return null;

  const lines = opportunities.map(
    (o) => `• *${o.customerName}* — ${o.address} — _${o.serviceCategory}_ (due ${o.dueDate})`,
  );

  return [
    ':bug: *Same-address cross-sell opportunities for today’s routes*',
    'These customers have another active service due at the same address as today’s appointment. Please add to today’s technician’s route if possible:',
    '',
    ...lines,
  ].join('\n');
}

module.exports = { formatSlackMessage };
