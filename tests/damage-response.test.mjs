import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAMAGE_CHANNELS,
  DEMO_DAMAGE_BY_WEAPON,
  DEMO_DEFENSES,
  resolveLayerHit,
} from '../runtime/model/damage-response.js';

const close = (actual, expected, epsilon = 1e-10) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const total = (value) => DAMAGE_CHANNELS.reduce((sum, key) => sum + value[key], 0);

test('mixed damage is resisted independently and conserves the full incoming hit', () => {
  const hit = resolveLayerHit({
    damage: { em: 4, thermal: 3, kinetic: 2, explosive: 1 },
    resistances: { em: 0.5, thermal: 0.25, kinetic: 0, explosive: 1 },
    capacity: 20,
    remaining: 5,
  });
  close(hit.appliedDamage, 5);
  close(hit.mitigatedDamage + hit.appliedDamage + total(hit.overflow), hit.incomingDamage);
  close(total(hit.damageMix), 1);
  assert.equal(hit.remaining, 0);
  assert.equal(hit.breached, true);
  assert.ok(
    Object.isFrozen(hit) && Object.isFrozen(hit.damageMix) && Object.isFrozen(hit.overflow),
  );
});

test('raw overflow receives only the next layer resistance', () => {
  const damage = { em: 8, thermal: 0, kinetic: 0, explosive: 4 };
  const shield = resolveLayerHit({
    damage,
    resistances: { em: 0.5, thermal: 0, kinetic: 0, explosive: 0.5 },
    capacity: 3,
    remaining: 3,
  });
  const hull = resolveLayerHit({
    damage: shield.overflow,
    resistances: { em: 0.25, thermal: 0, kinetic: 0, explosive: 0.75 },
    capacity: 20,
    remaining: 20,
  });
  close(shield.appliedDamage, 3);
  close(total(shield.overflow), 6);
  close(hull.appliedDamage, 3.5);
  // Shield mitigation + shield HP + hull mitigation + hull HP accounts for the original hit.
  close(
    shield.mitigatedDamage + shield.appliedDamage + hull.mitigatedDamage + hull.appliedDamage,
    12,
  );
});

test('a depleted layer applies no resistance and passes the whole raw hit onward', () => {
  const damage = { em: 1, thermal: 2, kinetic: 3, explosive: 4 };
  const hit = resolveLayerHit({
    damage,
    resistances: DEMO_DEFENSES.shield,
    capacity: 100,
    remaining: 0,
  });
  assert.equal(hit.appliedDamage, 0);
  assert.equal(hit.mitigatedDamage, 0);
  assert.deepEqual(hit.overflow, damage);
  assert.equal(hit.breached, true);
});

test('an intact fully resistant layer consumes the hit without damage or overflow', () => {
  const damage = { em: 2, thermal: 3, kinetic: 4, explosive: 5 },
    immune = { em: 1, thermal: 1, kinetic: 1, explosive: 1 };
  const healthy = resolveLayerHit({ damage, resistances: immune, capacity: 20, remaining: 12 });
  assert.equal(healthy.appliedDamage, 0);
  assert.equal(healthy.mitigatedDamage, 14);
  assert.equal(total(healthy.overflow), 0);
  assert.equal(healthy.remaining, 12);
  assert.equal(healthy.breached, false);
  const depleted = resolveLayerHit({ damage, resistances: immune, capacity: 20, remaining: 0 });
  assert.equal(depleted.mitigatedDamage, 0);
  assert.deepEqual(depleted.overflow, damage);
});

test('non-breaching damage updates integrity without overflow', () => {
  const hit = resolveLayerHit({
    damage: DEMO_DAMAGE_BY_WEAPON.cannon,
    resistances: DEMO_DEFENSES.shield,
    capacity: 10,
    remaining: 8,
  });
  assert.equal(total(hit.overflow), 0);
  assert.equal(hit.breached, false);
  close(hit.integrity, hit.remaining / 10);
});

test('demo presets are immutable, total near one, and distinguish layers', () => {
  for (const [kind, damage] of Object.entries(DEMO_DAMAGE_BY_WEAPON)) {
    assert.ok(Object.isFrozen(damage));
    close(total(damage), kind === 'web' ? 0 : 1);
  }
  assert.ok(DEMO_DEFENSES.shield.em < DEMO_DEFENSES.shield.explosive);
  assert.ok(DEMO_DEFENSES.hull.em > DEMO_DEFENSES.hull.explosive);
});

test('invalid channels, fractions, capacity, and remaining fail early', () => {
  const valid = {
    damage: DEMO_DAMAGE_BY_WEAPON.rail,
    resistances: DEMO_DEFENSES.hull,
    capacity: 10,
    remaining: 5,
  };
  assert.throws(
    () => resolveLayerHit({ ...valid, damage: { ...valid.damage, em: NaN } }),
    /damage.em/,
  );
  assert.throws(
    () => resolveLayerHit({ ...valid, damage: { ...valid.damage, thermal: -1 } }),
    /damage.thermal/,
  );
  assert.throws(
    () => resolveLayerHit({ ...valid, resistances: { ...valid.resistances, kinetic: 1.1 } }),
    /resistances.kinetic/,
  );
  assert.throws(() => resolveLayerHit({ ...valid, capacity: 0 }), /capacity/);
  assert.throws(() => resolveLayerHit({ ...valid, remaining: 11 }), /remaining/);
  const huge = {
    em: Number.MAX_VALUE,
    thermal: Number.MAX_VALUE,
    kinetic: Number.MAX_VALUE,
    explosive: Number.MAX_VALUE,
  };
  assert.throws(() => resolveLayerHit({ ...valid, damage: huge }), /total damage/);
});
