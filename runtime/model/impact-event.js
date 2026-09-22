import { deriveImpactResponse } from './impact-response.js';
const EPSILON = 1e-9;

function vector(value) {
  return Object.freeze({ x: value.x, y: value.y, z: value.z });
}

function normalized(value) {
  const length = Math.hypot(value.x, value.y, value.z);
  if (length <= EPSILON) return vector({ x: 0, y: 0, z: 0 });
  return vector({ x: value.x / length, y: value.y / length, z: value.z / length });
}

/**
 * Renderer-independent description of one weapon crossing a shield surface.
 * Keeping this DTO in the model lets any future renderer replay the same event.
 */
export function createImpactEvent({
  ship,
  owner,
  projectileId,
  kind,
  hit,
  incomingDir,
  shield = true,
  damage = 1,
  receiving,
  layerCapacity,
  weaponSize = 'small',
  contactDuration = 0,
  incomingVelocity = { x: 0, y: 0, z: 0 },
  instantaneous = false,
}) {
  if (!hit?.point || !hit?.normal || (shield && !hit?.localUnitDirection)) {
    throw new TypeError('An impact requires an exact surface intersection.');
  }
  const point = vector(hit.point);
  if (![incomingVelocity.x, incomingVelocity.y, incomingVelocity.z].every(Number.isFinite))
    throw new TypeError('Impact velocity must be finite');
  const velocity = vector(incomingVelocity);
  const incomingSpeed = Math.hypot(velocity.x, velocity.y, velocity.z);
  const resolved = receiving
    ? Object.freeze({
        ...receiving,
        damageMix: Object.freeze({ ...receiving.damageMix }),
        overflow: Object.freeze({ ...receiving.overflow }),
      })
    : undefined;
  const response = resolved
    ? deriveImpactResponse({
        kind,
        weaponSize,
        layer: shield ? 'shield' : 'hull',
        incomingDamage: resolved.incomingDamage,
        appliedDamage: resolved.appliedDamage,
        absorbedDamage: resolved.mitigatedDamage,
        layerCapacity,
        integrity: resolved.integrity,
        breached: resolved.breached,
        damageMix: resolved.damageMix,
        contactDuration,
        incomingSpeed,
        instantaneous,
      })
    : undefined;
  return Object.freeze({
    type: 'impact',
    ship,
    owner,
    projectileId,
    kind,
    point,
    normal: vector(hit.normal),
    localUnitDirection: hit.localUnitDirection ? vector(hit.localUnitDirection) : undefined,
    incomingDir: normalized(incomingDir),
    incomingVelocity: velocity,
    incomingSpeed,
    instantaneous,
    x: point.x,
    y: point.y,
    z: point.z,
    shield,
    damage: resolved?.appliedDamage ?? damage,
    receiving: resolved,
    response,
  });
}
