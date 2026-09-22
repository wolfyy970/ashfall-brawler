import { resolveLayerHit } from './damage-response.js';

const hasOverflow = (damage) => Object.values(damage).some((amount) => amount > 0);

/**
 * Resolve an ordered shield -> hull sweep without depending on a renderer or Three.js.
 * Surface callbacks return the first finite-segment contact in their own geometry.
 */
export function resolveDefenseSweep({
  start,
  end,
  damage,
  shield,
  hull,
  intersectShield,
  intersectHull,
  passedShield = false,
}) {
  let segmentStart = start;
  let fraction = 0;
  let payload = damage;
  let crossedShield = passedShield;
  const contacts = [];

  if (!crossedShield && shield.remaining > 0) {
    const hit = intersectShield(segmentStart, end);
    if (!hit) return { contacts, shield, hull, passedShield, damage: payload, terminal: false };
    fraction = hit.t;
    const receiving = resolveLayerHit({
      damage: payload,
      resistances: shield.resistances,
      capacity: shield.capacity,
      remaining: shield.remaining,
    });
    shield = { ...shield, remaining: receiving.remaining };
    contacts.push({ layer: 'shield', hit, receiving, fraction });
    crossedShield = true;
    if (!hasOverflow(receiving.overflow)) {
      return {
        contacts,
        shield,
        hull,
        passedShield: true,
        damage: receiving.overflow,
        terminal: true,
      };
    }
    payload = receiving.overflow;
    segmentStart = hit.point;
  }

  const hit = intersectHull?.(segmentStart, end) ?? null;
  if (!hit)
    return {
      contacts,
      shield,
      hull,
      passedShield: crossedShield,
      damage: payload,
      terminal: false,
    };
  fraction += (1 - fraction) * hit.t;
  const receiving = resolveLayerHit({
    damage: payload,
    resistances: hull.resistances,
    capacity: hull.capacity,
    remaining: hull.remaining,
  });
  hull = { ...hull, remaining: receiving.remaining };
  contacts.push({ layer: 'hull', hit, receiving, fraction });
  return {
    contacts,
    shield,
    hull,
    passedShield: crossedShield,
    damage: receiving.overflow,
    terminal: true,
  };
}
