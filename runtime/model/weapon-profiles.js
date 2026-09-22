// Scene units: one world unit = 16.130346733461423 metres. Time is seconds.
// An engine can override any profile per weapon instance; views consume these DTOs.
import { firingPattern } from './firing-pattern.js';
import { DAMAGE_CHANNELS, DEMO_DAMAGE_BY_WEAPON } from './damage-response.js';

export const METRES_PER_WORLD_UNIT = 16.130346733461423;
const defaults = {
  cannon: {
    mode: 'projectile',
    interval: 1.4,
    speed: 42,
    lifetime: 3,
    length: 0.65,
    diameter: 0.2 / METRES_PER_WORLD_UNIT,
    launch: { size: 0.22, duration: 0.075, recoil: 0.018, flashLength: 0.14, flashRadius: 0.006 },
    flight: { color: 0xffbe71 },
    impact: { size: 1.0, duration: 0.2, particles: 6 },
  },
  missile: {
    mode: 'projectile',
    interval: 11.2,
    speed: 3.8,
    lifetime: 12,
    length: 0.48,
    diameter: 0.075,
    ignitionDelay: 0.16,
    guidanceDelay: 0.3,
    acceleration: 8,
    maxSpeed: 22,
    turnRate: 1.4,
    launch: { size: 0.36, duration: 0.12, recoil: 0, clearance: 0.04 },
    flight: { color: 0xf4c38a, exhaustLength: 0.58, trailWidth: 0.045, trailLifetime: 1.5 },
    impact: { size: 1.85, duration: 0.42, particles: 19 },
  },
  pulse: {
    mode: 'beam',
    interval: 2.2,
    speed: 0,
    lifetime: 0.18,
    length: 0,
    diameter: 0.024,
    launch: { size: 0.66, duration: 0.1, recoil: 0.01 },
    flight: { color: 0xe5ab63 },
    impact: { size: 0.85, duration: 0.22, particles: 3 },
  },
  rail: {
    mode: 'beam',
    interval: 4.8,
    speed: 0,
    lifetime: 0.15,
    length: 0,
    diameter: 0.018,
    launch: { size: 0.32, duration: 0.1, recoil: 0.022 },
    flight: { color: 0xb7dcff },
    impact: { size: 1.05, duration: 0.15, particles: 8 },
  },
  web: {
    mode: 'beam',
    interval: 13,
    speed: 0,
    lifetime: 0.7,
    length: 0,
    diameter: 0.01,
    launch: { size: 0, duration: 0, recoil: 0 },
    flight: { color: 0x9675bf },
    impact: { size: 0, duration: 0, particles: 0 },
  },
};
export function weaponProfile(kind, overrides = {}) {
  const base = defaults[kind];
  if (!base) throw new RangeError('Unknown weapon ' + kind);
  const value = { ...base, ...overrides, kind };
  value.weaponSize = overrides.weaponSize ?? 'small';
  const sizeScale = { small: 1, medium: 2.25, large: 4.5 }[value.weaponSize];
  if (!sizeScale) throw new RangeError('Invalid weapon size');
  // Authored per-round demo intensity, independent of flight speed and muzzle count.
  const intensity = { cannon: 8, pulse: 12, rail: 18, missile: 24, web: 0 }[kind] * sizeScale;
  value.damage = Object.freeze(
    Object.fromEntries(
      DAMAGE_CHANNELS.map((channel) => {
        const amount =
          overrides.damage === undefined
            ? DEMO_DAMAGE_BY_WEAPON[kind][channel] * intensity
            : overrides.damage[channel];
        if (!Number.isFinite(amount) || amount < 0)
          throw new RangeError('Invalid damage.' + channel);
        return [channel, amount];
      }),
    ),
  );
  for (const key of ['launch', 'flight', 'impact'])
    value[key] = Object.freeze({ ...base[key], ...overrides[key] });
  value.firing = firingPattern(kind, overrides.firing);
  for (const key of ['length', 'diameter', 'speed', 'lifetime', 'interval'])
    if (!Number.isFinite(value[key]) || value[key] < 0) throw new RangeError('Invalid ' + key);
  if (value.mode === 'projectile' && (value.length <= 0 || value.diameter <= 0 || value.speed <= 0))
    throw new RangeError('Projectile dimensions and speed must be positive');
  return Object.freeze(value);
}
