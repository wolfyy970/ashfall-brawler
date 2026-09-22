import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import { WeaponRangeModel } from '../runtime/model/weapon-range-model.js';
import { weaponProfile } from '../runtime/model/weapon-profiles.js';
import { deriveImpactResponse } from '../runtime/model/impact-response.js';
import { ShieldView } from '../runtime/views/shield-view.js';
import { HullImpactView } from '../runtime/views/hull-impact-view.js';
import { intersectSegmentBox } from '../runtime/math/box-intersection.js';

function hit(kind, defense = 'shield', damage) {
  const model = new WeaponRangeModel();
  model.setDefense(defense);
  model.setHullSurface({
    aimPoint: { x: 2.65, y: 0.16, z: 0 },
    intersectSegment: (a, b) =>
      intersectSegmentBox(a, b, {
        center: { x: 2.8, y: 0.16, z: 0 },
        halfSize: { x: 0.15, y: 0.68, z: 0.8 },
      }),
  });
  model.impact(
    { id: 1, kind, profile: weaponProfile(kind, damage ? { damage } : {}) },
    { x: -11, y: 0.16, z: 0 },
    { x: 4, y: 0.16, z: 0 },
  );
  return model.drain()[0];
}

test('same pulse hit changes outcome and disturbance against a hardened shield', () => {
  const normal = hit('pulse'),
    hardened = hit('pulse', 'hardened');
  assert.equal(normal.receiving.incomingDamage, hardened.receiving.incomingDamage);
  assert.ok(normal.damage > hardened.damage);
  assert.ok(normal.response.instability > hardened.response.instability);
  assert.ok(normal.response.duration > hardened.response.duration);
  assert.ok(Object.isFrozen(normal.receiving.damageMix));
});

test('weapon type and ammunition damage type remain independent', () => {
  const common = {
    kind: 'cannon',
    layerCapacity: 100,
    integrity: 0.5,
    incomingDamage: 10,
    incomingSpeed: 12,
    appliedDamage: 5,
  };
  const kinetic = deriveImpactResponse({
    ...common,
    damageMix: { em: 0, thermal: 0, kinetic: 1, explosive: 0 },
  });
  const explosive = deriveImpactResponse({
    ...common,
    damageMix: { em: 0, thermal: 0, kinetic: 0, explosive: 1 },
  });
  assert.ok(kinetic.coreWidth < explosive.coreWidth);
  assert.equal(kinetic.propagationSpeed, explosive.propagationSpeed);
  assert.equal(kinetic.power, explosive.power);
  const damage = { em: 10, thermal: 0, kinetic: 0, explosive: 0 };
  assert.deepEqual(
    weaponProfile('cannon', { weaponSize: 'small', damage }).damage,
    weaponProfile('cannon', { weaponSize: 'large', damage }).damage,
  );
});

test('depleted shield collapses, hull impacts the solid face rather than the shield envelope', () => {
  const weak = hit('rail', 'weak'),
    hull = hit('rail', 'hull');
  assert.ok(weak.response.collapse > 0);
  assert.ok(Object.values(weak.receiving.overflow).some((x) => x > 0));
  assert.equal(hull.shield, false);
  assert.equal(hull.response.collapse, 0);
  assert.equal(hull.response.propagationSpeed, 0);
  assert.ok(Math.abs(hull.point.x - 2.65) < 1e-9);
  assert.deepEqual(hull.normal, { x: -1, y: 0, z: 0 });
  assert.ok(hull.point.x > weak.point.x);
});

test('box crossing handles misses and exits from inside a target', () => {
  const box = { center: { x: 0, y: 0, z: 0 }, halfSize: { x: 1, y: 1, z: 1 } };
  assert.equal(intersectSegmentBox({ x: -4, y: 2, z: 0 }, { x: 4, y: 2, z: 0 }, box), null);
  assert.equal(intersectSegmentBox({ x: -4, y: 0, z: 0 }, { x: -2, y: 0, z: 0 }, box), null);
  const exit = intersectSegmentBox({ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, box);
  assert.equal(exit.point.x, 1);
  assert.equal(exit.normal.x, 1);
});

test('many shield impacts reuse eight independent slots and one unchanged geometry', () => {
  const view = new ShieldView(),
    geometry = view.mesh.geometry,
    event = hit('pulse');
  for (let i = 0; i < 100; i++)
    view.impact(
      { x: 1, y: 0, z: 0 },
      {
        weapon: i % 2 ? 'pulse' : 'cannon',
        time: i / 10,
        response: event.response,
        damageMix: event.receiving.damageMix,
      },
    );
  assert.equal(view.material.uniforms.impactStart.value.length, 8);
  assert.equal(new Set(view.material.uniforms.impactStart.value).size, 8);
  assert.equal(view.mesh.geometry, geometry);
  view.clear();
  assert.ok(view.material.uniforms.impactPower.value.every((x) => x === 0));
  view.dispose();
});

test('hull contacts stay within one 32-slot instance pool and expire without more geometry', () => {
  const scene = new T.Scene(),
    view = new HullImpactView(scene),
    event = hit('cannon', 'hull');
  for (let i = 0; i < 100; i++) view.impact({ ...event, t: i / 10 });
  assert.equal(scene.children.length, 1);
  assert.equal(view.mesh.count, 32);
  assert.equal(view.geometry.getAttribute('position').count, 4);
  view.update(10);
  assert.equal(view.mesh.visible, true);
  view.update(13);
  assert.equal(view.mesh.visible, false);
  view.dispose();
  assert.equal(scene.children.length, 0);
});
