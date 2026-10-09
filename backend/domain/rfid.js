export function rfidLookupCandidates(value) {
  const clean = String(value || '').replace(/[\s.:-]/g, '').toUpperCase();
  if (!clean) return [];

  const candidates = new Set([clean]);
  if (clean.length === 12 && /^[0-9A-F]+$/.test(clean)) {
    let checksum = 0;
    for (let index = 0; index < 10; index += 2) {
      checksum ^= Number.parseInt(clean.slice(index, index + 2), 16);
    }
    if (checksum === Number.parseInt(clean.slice(10, 12), 16)) {
      candidates.add(clean.slice(0, 10));
    }
  } else if (clean.length === 10 && /^[0-9A-F]+$/.test(clean)) {
    let checksum = 0;
    for (let index = 0; index < 10; index += 2) {
      checksum ^= Number.parseInt(clean.slice(index, index + 2), 16);
    }
    candidates.add(`${clean}${checksum.toString(16).padStart(2, '0').toUpperCase()}`);
  }

  if (clean.length <= 8 && /^[0-9A-F]+$/.test(clean)) {
    const decimal = BigInt(`0x${clean}`).toString();
    candidates.add(decimal);
    candidates.add(decimal.padStart(10, '0'));
  }

  return [...candidates];
}

export function selectUniqueRfidMatch(users) {
  const matches = new Map((users || []).filter(Boolean).map(user => [user.sid, user]));
  return matches.size === 1 ? matches.values().next().value : null;
}