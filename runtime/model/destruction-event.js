const MIN_SIZE = 0.05;
const MAX_SIZE = 1000;

function finite(name, value) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be finite`);
  return value;
}

function size(name, value) {
  value = finite(name, value);
  if (value < MIN_SIZE || value > MAX_SIZE)
    throw new RangeError(`${name} is outside supported bounds`);
  return value;
}

function vector(name, value) {
  if (!value || typeof value !== 'object') throw new TypeError(`${name} must be a vector`);
  return Object.freeze({
    x: finite(`${name}.x`, value.x),
    y: finite(`${name}.y`, value.y ?? 0),
    z: finite(`${name}.z`, value.z),
  });
}

function unit(name, value) {
  const result = vector(name, value);
  const length = Math.hypot(result.x, result.y, result.z);
  if (length <= 1e-9) throw new RangeError(`${name} must not be zero`);
  return Object.freeze({ x: result.x / length, y: result.y / length, z: result.z / length });
}

function damageMix(value = {}) {
  const result = {};
  for (const [key, amount] of Object.entries(value))
    result[key] = finite(`damageMix.${key}`, amount);
  return Object.freeze(result);
}

/** Immutable terminal event consumed by destruction presentation and audio. */
export function createDestructionEvent({
  ship,
  owner,
  t,
  point,
  velocity,
  forward,
  radius,
  length,
  seed,
  damageMix: mix,
}) {
  if (!Number.isInteger(ship) || !Number.isInteger(owner))
    throw new TypeError('Destroy event ids must be integers');
  const center = vector('point', point);
  return Object.freeze({
    type: 'destroy',
    ship,
    owner,
    t: finite('t', t),
    point: center,
    velocity: vector('velocity', velocity),
    forward: unit('forward', forward),
    radius: size('radius', radius),
    length: size('length', length),
    seed: finite('seed', seed),
    damageMix: damageMix(mix),
    // Existing presentation and audio clients still consume this compact location.
    x: center.x,
    z: center.z,
  });
}

export const DEFAULT_DESTRUCTION_SHAPE = Object.freeze({ radius: 1.75, length: 4.5 });
