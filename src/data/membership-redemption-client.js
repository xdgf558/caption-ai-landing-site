// Persist before sending. If storage is unavailable, do not risk a non-replayable charge.
export const pendingMembershipKey = (storage, accountId, createKey = () => crypto.randomUUID()) => {
  if (!Number.isSafeInteger(accountId) || accountId <= 0) throw new Error('Account required');
  const name = `stationcat.membership.pending.v1:${accountId}`;
  const existing = storage.getItem(name);
  if (existing && !/^[a-zA-Z0-9_-]{16,128}$/.test(existing)) throw new Error('Invalid pending receipt');
  const key = existing || createKey();
  if (!existing) storage.setItem(name, key);
  if (storage.getItem(name) !== key) throw new Error('Pending receipt was not persisted');
  return { key, clear() { if (storage.getItem(name) === key) storage.removeItem(name); } };
};
