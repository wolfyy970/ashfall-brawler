import { DEMO_DAMAGE_BY_WEAPON, DAMAGE_CHANNELS } from './damage-response.js';

const KINDS = Object.freeze({
  cannon: Object.freeze({ sharpness: 0.72, footprint: 1, persistence: 1 }),
  missile: Object.freeze({ sharpness: 0.32, footprint: 1.55, persistence: 1.42 }),
  pulse: Object.freeze({ sharpness: 0.82, footprint: 0.9, persistence: 0.88 }),
  rail: Object.freeze({ sharpness: 1, footprint: 0.7, persistence: 0.72 }),
  web: Object.freeze({ sharpness: 0.24, footprint: 1.35, persistence: 1.65 }),
});
const SIZE_FALLBACK = Object.freeze({ small: 1, medium: 2.25, large: 4.5 });
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function finite(name, value, { min = 0, max = Infinity } = {}) {
  if (!Number.isFinite(value) || value < min || value > max)
    throw new RangeError(`Invalid ${name}`);
  return value;
}

/**
 * Convert resolved gameplay damage into bounded presentation parameters.
 * Damage is an authored game intensity. It is not energy, impulse, or another physical unit.
 */
export function deriveImpactResponse({
  kind,
  weaponSize = 'small',
  layer = 'shield',
  incomingDamage,
  appliedDamage,
  absorbedDamage,
  layerCapacity,
  integrity,
  breached = false,
  damageMix = DEMO_DAMAGE_BY_WEAPON[kind],
  contactDuration = 0,
  incomingSpeed = 0,
  instantaneous = false,
}) {
  const family = KINDS[kind];
  if (!family) throw new RangeError('Invalid weapon kind');
  if (!(weaponSize in SIZE_FALLBACK)) throw new RangeError('Invalid weapon size');
  if (!['shield', 'hull'].includes(layer)) throw new RangeError('Invalid impact layer');
  if (typeof breached !== 'boolean') throw new TypeError('Invalid breached flag');
  finite('contact duration', contactDuration);
  finite('incoming speed', incomingSpeed);
  if (typeof instantaneous !== 'boolean') throw new TypeError('Invalid instantaneous flag');
  const mix = {};
  let total = 0;
  for (const channel of DAMAGE_CHANNELS)
    total += finite('damage mix', damageMix?.[channel], { max: 1 });
  for (const channel of DAMAGE_CHANNELS) mix[channel] = total > 0 ? damageMix[channel] / total : 0;
  const capacity = finite('layer capacity', layerCapacity, { min: Number.EPSILON });
  const health = finite('integrity', integrity, { min: 0, max: 1 });
  const incoming =
    incomingDamage === undefined
      ? SIZE_FALLBACK[weaponSize]
      : finite('incoming damage', incomingDamage);
  const absorbed = absorbedDamage === undefined ? 0 : finite('absorbed damage', absorbedDamage);
  const applied =
    appliedDamage === undefined
      ? Math.max(0, incoming - absorbed)
      : finite('applied damage', appliedDamage);
  const threat = clamp(incoming / (capacity * 0.2), 0, 1);
  const severity = clamp(applied / (capacity * 0.2), 0, 1);
  const absorption = clamp(absorbed / Math.max(Number.EPSILON, absorbed + applied), 0, 1);
  const power = clamp(Math.sqrt(threat) * (0.72 + severity * 0.28), 0, 1);
  const weakness = 1 - health;
  const instability = clamp(
    severity * (0.62 + mix.em * 0.28) + weakness * 0.42 - absorption * 0.18,
    0,
    1,
  );
  const coreWidth = clamp(
    (0.035 + power * 0.09) * family.footprint * (1 + mix.explosive * 0.35 - mix.kinetic * 0.15),
    0.025,
    0.2,
  );
  const duration = clamp(
    contactDuration +
      0.75 *
        family.persistence *
        (0.62 + power * 0.78) *
        (0.78 + weakness * 0.55) *
        (1 + instability * 0.3 + mix.thermal * 0.3),
    0.12,
    2.2,
  );
  // World units/second. Damage and resistance must never rescale contact velocity.
  const propagationSpeed = layer === 'shield' && !instantaneous ? incomingSpeed : 0;
  const collapse =
    layer === 'shield' && breached ? clamp(0.58 + power * 0.3 + weakness * 0.2, 0, 1) : 0;
  const flashScale = clamp(
    (0.42 + family.footprint * 0.34 + power * 0.7) * (layer === 'hull' ? 1.12 : 1),
    0.4,
    2.5,
  );
  const glancingSparks = layer === 'hull' ? absorption * 7 : 0;
  const particleCount = Math.round(clamp(power * 17 + severity * 9 + glancingSparks, 0, 32));
  return Object.freeze({
    power,
    coreWidth,
    duration,
    propagationSpeed,
    instability,
    collapse,
    flashScale,
    particleCount,
    layer,
    instantaneous,
  });
}
