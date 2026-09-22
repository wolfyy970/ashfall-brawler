/** Shared field envelope for both the fleet and the inspection range. */
export function shieldFieldStrength({ integrity, hitAge = Infinity, active = true }) {
  const health = Math.max(0, Math.min(1, integrity));
  return active ? Math.max(0.48, Math.exp(-Math.max(0, hitAge) * 1.6)) * health : 0;
}
