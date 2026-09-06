export function inspectRead(op, groupId, since) {
  if (!groupId) return { result: 'inactive' };
  if (!['55', 'NOTIFIED_READ_MESSAGE'].includes(String(op?.type))) return { result: 'other-event' };
  if (op.param1 !== groupId) return { result: 'other-group' };
  if (typeof op.param2 !== 'string' || !op.param2 || !op.param3) return { result: 'missing-fields' };
  const timestamp = Number(op.createdTime);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return { result: 'missing-time' };
  if (timestamp < since) return { result: 'old-event' };
  return { result: 'reader', userId: op.param2 };
}
