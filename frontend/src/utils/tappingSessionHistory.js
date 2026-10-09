const tapEvents = new Set([
  'SUPERVISOR_LOCK_IN',
  'SUPERVISOR_EXTRA_LOCK_IN',
  'MECHANIC_LOG_IN',
  'SUPERVISOR_LOG_OUT',
  'SUPERVISOR_EXTRA_LOG_OUT',
  'MECHANIC_LOG_OUT'
]);
const sessionEnds = new Set(['SUPERVISOR_LOG_OUT']);

const timestamp = entry => {
  const value = entry.created_at || entry.createdAt;
  const parsed = value ? Date.parse(String(value).replace(' ', 'T')) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

export function buildTappingSessionHistory(history, { getName, isAdminUid }) {
  const entries = (Array.isArray(history) ? history : [])
    .map((entry, index) => ({
      entry,
      index,
      boxId: String(entry.id_box || entry.idBox || 'Universal Box').trim(),
      uid: String(entry.rfid_uid || entry.rfidUid || '').trim(),
      event: String(entry.event_text || entry.eventText || '').trim().toUpperCase(),
      eventType: String(entry.event_type || entry.eventType || '').trim().toUpperCase()
    }))
    .filter(item => tapEvents.has(item.event) && item.uid && !isAdminUid(item.uid))
    .sort((left, right) => timestamp(left.entry) - timestamp(right.entry) ||
      Number(left.entry.id || left.index) - Number(right.entry.id || right.index));

  const groups = [];
  const groupsBySession = new Map();
  const activeByBox = new Map();

  const createGroup = item => {
    const group = {
      boxId: item.boxId,
      sessionId: item.entry.session_id ?? item.entry.sessionId ?? null,
      entries: [],
      participants: new Map(),
      startedAt: null,
      endedAt: null,
      latestEntry: null
    };
    groups.push(group);
    return group;
  };

  for (const item of entries) {
    const boxKey = item.boxId.toLowerCase();
    const sessionId = item.entry.session_id ?? item.entry.sessionId ?? null;
    const sessionKey = sessionId == null ? '' : `${boxKey}::${sessionId}`;
    const activeGroup = activeByBox.get(boxKey);
    let group = activeGroup && !activeGroup.endedAt
      ? activeGroup
      : (sessionKey ? groupsBySession.get(sessionKey) : null);
    if (!group || group.endedAt) group = createGroup(item);

    if (sessionKey) groupsBySession.set(sessionKey, group);
    activeByBox.set(boxKey, group);
    group.entries.push(item);

    const eventTime = item.entry.created_at || item.entry.createdAt || null;
    if (item.eventType === 'IN' && (!group.startedAt || timestamp(item.entry) < Date.parse(String(group.startedAt).replace(' ', 'T')))) {
      group.startedAt = eventTime;
    }
    const previousPerson = group.participants.get(item.uid.toLowerCase());
    if (!previousPerson || timestamp(item.entry) >= timestamp(previousPerson.entry)) {
      group.participants.set(item.uid.toLowerCase(), {
        uid: item.uid,
        nama: item.entry.nama || item.entry.name || getName(item.uid),
        status: item.eventType === 'OUT' ? 'KELUAR' : 'MASUK',
        entry: item.entry
      });
    }
    group.latestEntry = item;

    if (sessionEnds.has(item.event)) {
      group.endedAt = eventTime;
      if (activeByBox.get(boxKey) === group) activeByBox.delete(boxKey);
    }
  }

  return groups.map(group => {
    const eventIds = group.entries.map(item => Number(item.entry.id)).filter(Number.isInteger);
    const latest = group.latestEntry;
    const sessionTime = group.startedAt || (group.entries[0]?.entry.created_at ?? null);
    return {
      id: `session-${group.boxId}-${group.sessionId ?? group.entries[0]?.entry.id ?? 'unknown'}`,
      deleteId: eventIds[eventIds.length - 1],
      deleteIds: eventIds,
      id_box: group.boxId,
      sessionDate: String(sessionTime || '').slice(0, 10) || 'tanpa-tanggal',
      sessionStart: group.startedAt,
      sessionEnd: group.endedAt,
      participants: Array.from(group.participants.values()).map(({ uid, nama, status }) => ({ uid, nama, status })),
      totalPersonel: group.participants.size,
      eventText: latest?.entry.event_text || latest?.entry.eventText || `TAPPING_${latest?.eventType || 'CHECK'}`
    };
  }).sort((left, right) => {
    const leftTime = Date.parse(String(left.sessionStart || left.sessionDate).replace(' ', 'T')) || 0;
    const rightTime = Date.parse(String(right.sessionStart || right.sessionDate).replace(' ', 'T')) || 0;
    return rightTime - leftTime;
  });
}
