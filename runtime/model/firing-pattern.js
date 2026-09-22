const MISSILE_COUNTS = new Set([1, 2, 3, 6]);

const defaults = Object.freeze({
  cannon: Object.freeze({ mode: 'all', count: 'all', rippleInterval: 0 }),
  pulse: Object.freeze({ mode: 'all', count: 'all', rippleInterval: 0 }),
  rail: Object.freeze({ mode: 'all', count: 'all', rippleInterval: 0 }),
  web: Object.freeze({ mode: 'simultaneous', count: 1, rippleInterval: 0 }),
  missile: Object.freeze({ mode: 'simultaneous', count: 3, rippleInterval: 0 }),
});

/** Validate and freeze the engine-owned firing policy for one weapon. */
export function firingPattern(kind, overrides = {}) {
  const base = defaults[kind];
  if (!base) throw new RangeError('Unknown weapon ' + kind);
  const value = { ...base, ...overrides };
  if (!['all', 'simultaneous', 'ripple'].includes(value.mode))
    throw new RangeError('Invalid firing mode');
  if (value.count !== 'all' && (!Number.isInteger(value.count) || value.count < 1))
    throw new RangeError('Invalid salvo count');
  if (kind === 'missile' && value.count !== 'all' && !MISSILE_COUNTS.has(value.count))
    throw new RangeError('Missile salvo count must be 1, 2, 3, or 6');
  if (!Number.isFinite(value.rippleInterval) || value.rippleInterval < 0)
    throw new RangeError('Invalid ripple interval');
  if (value.mode === 'ripple' && value.rippleInterval <= 0)
    throw new RangeError('Ripple firing requires a positive ripple interval');
  return Object.freeze(value);
}

/** Select physical muzzle indices without consulting a projectile/global ID. */
export function planSalvo({ pattern, muzzleCount, cursor = 0 }) {
  if (!Number.isInteger(muzzleCount) || muzzleCount < 1)
    throw new RangeError('A salvo requires at least one physical muzzle');
  const requested = pattern.count === 'all' ? muzzleCount : pattern.count;
  const count = Math.min(requested, muzzleCount);
  const shots = Array.from({ length: count }, (_, index) => ({
    muzzleIndex: (cursor + index) % muzzleCount,
    delay: pattern.mode === 'ripple' ? index * pattern.rippleInterval : 0,
  }));
  return Object.freeze({
    shots: Object.freeze(shots.map(Object.freeze)),
    nextCursor: (cursor + count) % muzzleCount,
  });
}
