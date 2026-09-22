export const DAMAGE_CHANNELS = Object.freeze(['em', 'thermal', 'kinetic', 'explosive']);

function frozenChannels(channels) {
  return Object.freeze({ ...channels });
}

/** Configurable Ashfall demo ammunition presets; each damaging hit totals one point. */
export const DEMO_DAMAGE_BY_WEAPON = Object.freeze({
  cannon: frozenChannels({ em: 0.05, thermal: 0.1, kinetic: 0.75, explosive: 0.1 }),
  pulse: frozenChannels({ em: 0.62, thermal: 0.38, kinetic: 0, explosive: 0 }),
  rail: frozenChannels({ em: 0, thermal: 0.25, kinetic: 0.75, explosive: 0 }),
  missile: frozenChannels({ em: 0.05, thermal: 0.1, kinetic: 0.15, explosive: 0.7 }),
  web: frozenChannels({ em: 0, thermal: 0, kinetic: 0, explosive: 0 }),
});

/** Configurable Ashfall demo layer presets, not universal EVE resistance values. */
export const DEMO_DEFENSES = Object.freeze({
  shield: frozenChannels({ em: 0.1, thermal: 0.25, kinetic: 0.4, explosive: 0.55 }),
  hull: frozenChannels({ em: 0.55, thermal: 0.35, kinetic: 0.25, explosive: 0.1 }),
});

function validateChannels(name, value, max = Infinity) {
  if (!value || typeof value !== 'object') throw new TypeError(`Invalid ${name}`);
  const result = {};
  for (const channel of DAMAGE_CHANNELS) {
    const amount = value[channel];
    if (!Number.isFinite(amount) || amount < 0 || amount > max)
      throw new RangeError(`Invalid ${name}.${channel}`);
    result[channel] = amount;
  }
  return result;
}

const sum = (value) => DAMAGE_CHANNELS.reduce((total, channel) => total + value[channel], 0);

/** Resolve one defense layer. Overflow remains raw so the next layer applies only its own resists. */
export function resolveLayerHit({ damage, resistances, capacity, remaining }) {
  const incoming = validateChannels('damage', damage),
    resists = validateChannels('resistances', resistances, 1);
  if (!Number.isFinite(capacity) || capacity <= 0) throw new RangeError('Invalid capacity');
  if (!Number.isFinite(remaining) || remaining < 0 || remaining > capacity)
    throw new RangeError('Invalid remaining');
  const incomingDamage = sum(incoming),
    afterResistance = {};
  if (!Number.isFinite(incomingDamage)) throw new RangeError('Invalid total damage');
  for (const channel of DAMAGE_CHANNELS)
    afterResistance[channel] = incoming[channel] * (1 - resists[channel]);
  const totalAfterResistance = sum(afterResistance);
  const consumedFraction =
    remaining === 0
      ? 0
      : totalAfterResistance === 0
        ? 1
        : Math.min(1, remaining / totalAfterResistance);
  const overflow = {},
    mix = {};
  for (const channel of DAMAGE_CHANNELS) {
    overflow[channel] = incoming[channel] * (1 - consumedFraction);
    mix[channel] = incomingDamage === 0 ? 0 : incoming[channel] / incomingDamage;
  }
  const appliedDamage = totalAfterResistance * consumedFraction,
    mitigatedDamage = DAMAGE_CHANNELS.reduce(
      (total, channel) => total + incoming[channel] * resists[channel] * consumedFraction,
      0,
    ),
    nextRemaining = Math.max(0, remaining - appliedDamage);
  return Object.freeze({
    incomingDamage,
    mitigatedDamage,
    appliedDamage,
    integrity: nextRemaining / capacity,
    breached: incomingDamage > 0 && nextRemaining === 0,
    damageMix: frozenChannels(mix),
    remaining: nextRemaining,
    overflow: frozenChannels(overflow),
  });
}
