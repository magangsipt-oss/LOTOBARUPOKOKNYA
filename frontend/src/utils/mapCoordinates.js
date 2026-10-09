export const DEFAULT_CENTER = [2.144691, 117.477526];

export function boxCoordinates(box) {
  const lat = Number(box?.lat);
  const lng = Number(box?.lng ?? box?.lon);
  // Devices use zero coordinates to signal that no GPS fix is available.
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0 || lng === 0 ||
      Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lat, lng];
}
