import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveImpactResponse } from '../runtime/model/impact-response.js';

const response = (overrides = {}) =>
  deriveImpactResponse({
    kind: 'cannon',
    incomingSpeed: 12,
    layerCapacity: 100,
    integrity: 0.8,
    ...overrides,
  });

test('larger resolved hits change intensity without rescaling contact velocity', () => {
  const small = response({ incomingDamage: 2, appliedDamage: 1 });
  const large = response({ incomingDamage: 15, appliedDamage: 12 });
  assert.ok(large.power > small.power);
  assert.equal(large.propagationSpeed, small.propagationSpeed);
  assert.ok(large.coreWidth > small.coreWidth);
  assert.ok(large.particleCount > small.particleCount);
});

test('weapon family changes shape and timing without changing gameplay damage', () => {
  const rail = response({ kind: 'rail', incomingDamage: 8, appliedDamage: 6 });
  const missile = response({ kind: 'missile', incomingDamage: 8, appliedDamage: 6 });
  assert.equal(rail.propagationSpeed, missile.propagationSpeed);
  assert.ok(rail.coreWidth < missile.coreWidth);
  assert.ok(rail.duration < missile.duration);
  assert.equal(rail.power, missile.power);
});

test('healthy defense settles sooner while weak layers become unstable', () => {
  const healthy = response({ incomingDamage: 10, appliedDamage: 5, integrity: 1 });
  const weak = response({ incomingDamage: 10, appliedDamage: 5, integrity: 0.1 });
  assert.ok(healthy.duration < weak.duration);
  assert.ok(healthy.instability < weak.instability);
});

test('shield breach collapses while hull stays local and creates glancing sparks', () => {
  const shield = response({ incomingDamage: 12, appliedDamage: 10, breached: true });
  const hull = response({
    layer: 'hull',
    incomingDamage: 12,
    appliedDamage: 2,
    absorbedDamage: 10,
    breached: true,
  });
  assert.ok(shield.collapse > 0);
  assert.equal(hull.collapse, 0);
  assert.equal(hull.propagationSpeed, 0);
  assert.ok(
    hull.flashScale >
      response({ incomingDamage: 12, appliedDamage: 2, absorbedDamage: 10 }).flashScale,
  );
  assert.ok(hull.particleCount > 0);
});

test('explicit damage wins over weapon size and missing metadata uses size fallback', () => {
  const explicitSmall = response({ weaponSize: 'small', incomingDamage: 7, appliedDamage: 4 });
  const explicitLarge = response({ weaponSize: 'large', incomingDamage: 7, appliedDamage: 4 });
  assert.deepEqual(explicitSmall, explicitLarge);
  assert.ok(response({ weaponSize: 'large' }).power > response({ weaponSize: 'small' }).power);
});

test('result is frozen and all shader parameters remain bounded', () => {
  const value = response({
    kind: 'missile',
    incomingDamage: 1e9,
    appliedDamage: 1e9,
    integrity: 0,
    breached: true,
  });
  assert.ok(Object.isFrozen(value));
  assert.ok(value.power >= 0 && value.power <= 1);
  assert.ok(value.coreWidth >= 0.025 && value.coreWidth <= 0.2);
  assert.ok(value.duration >= 0.12 && value.duration <= 2.2);
  assert.ok(value.instability >= 0 && value.instability <= 1);
  assert.ok(value.collapse >= 0 && value.collapse <= 1);
  assert.ok(value.flashScale >= 0.4 && value.flashScale <= 2.5);
  assert.ok(Number.isInteger(value.particleCount) && value.particleCount <= 32);
});

test('invalid enums and non-finite or negative damage fail early', () => {
  assert.throws(() => response({ kind: 'magic' }), /weapon kind/);
  assert.throws(() => response({ weaponSize: 'capital' }), /weapon size/);
  assert.throws(() => response({ layer: 'structure' }), /impact layer/);
  assert.throws(() => response({ incomingDamage: NaN }), /incoming damage/);
  assert.throws(() => response({ appliedDamage: -1 }), /applied damage/);
  assert.throws(() => response({ layerCapacity: 0 }), /layer capacity/);
  assert.throws(() => response({ integrity: 1.1 }), /integrity/);
});
