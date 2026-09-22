import test from 'node:test';
import assert from 'node:assert/strict';
import { WeaponRangeModel } from '../runtime/model/weapon-range-model.js';
import { weaponProfile } from '../runtime/model/weapon-profiles.js';
import { deriveImpactResponse } from '../runtime/model/impact-response.js';
import { intersectSegmentBox } from '../runtime/math/box-intersection.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
test('reaction speed remains exactly incident speed across weapon, damage and resistance states', () => {
  for (const incomingSpeed of [1, 12, 42, 90])
    for (const kind of ['cannon', 'missile', 'pulse', 'rail'])
      for (const integrity of [0.01, 0.5, 1]) {
        const r = deriveImpactResponse({
          kind,
          incomingSpeed,
          integrity,
          layerCapacity: 100,
          incomingDamage: 20,
          appliedDamage: integrity * 20,
        });
        assert.equal(r.propagationSpeed, incomingSpeed);
      }
});

test('contact timestamp uses the exact fractional crossing within the simulation step', () => {
  const r = new WeaponRangeModel();
  r.impact(
    { id: 1, kind: 'cannon', profile: weaponProfile('cannon'), vx: 40, vy: 0, vz: 0 },
    { x: -4, y: 0.16, z: 0 },
    { x: 0, y: 0.16, z: 0 },
    1,
    0.1,
  );
  const e = r.drain()[0];
  close(e.point.x, -2.4);
  close(e.t, 1.04);
  close(e.incomingSpeed, 40);
  close(e.response.propagationSpeed, 40);
});

test('accelerating missile hands its measured terminal velocity to the shield, not launch speed', () => {
  const r = new WeaponRangeModel();
  r.configure('missile', {
    position: { x: 0, y: 0, z: 0 },
    muzzles: [{ id: 'tube', position: { x: 0, y: 0.2, z: -0.4 } }],
  });
  r.setParameters({ firing: { count: 1 } });
  r.fire();
  let contact;
  for (let i = 0; i < 1200 && !contact; i++) {
    const p = r.shots[0];
    r.step(1 / 120);
    contact = r.drain().find((e) => e.type === 'impact');
    if (contact) {
      close(contact.incomingSpeed, Math.hypot(p.vx, p.vy, p.vz));
      close(contact.response.propagationSpeed, contact.incomingSpeed);
      assert.ok(contact.incomingSpeed > p.profile.speed);
    }
  }
  assert.ok(contact);
});

test('failed shield passes a travelling projectile to the hull without teleporting or resetting velocity', () => {
  const r = new WeaponRangeModel();
  r.configure('cannon', {
    position: { x: 0, y: 0, z: 0 },
    muzzles: [{ id: 'gun', position: { x: 0, y: 0.16, z: -0.4 } }],
  });
  r.setHullSurface({
    aimPoint: { x: 2.65, y: 0.16, z: 0 },
    intersectSegment: (a, b) =>
      intersectSegmentBox(a, b, {
        center: { x: 2.8, y: 0.16, z: 0 },
        halfSize: { x: 0.15, y: 0.68, z: 0.8 },
      }),
  });
  r.setDefense('weak');
  r.fire();
  const contacts = [];
  for (let i = 0; i < 200 && r.shots.length; i++) {
    r.step(1 / 120);
    contacts.push(...r.drain().filter((e) => e.type === 'impact'));
  }
  assert.equal(contacts.length, 2);
  const [shield, hull] = contacts;
  assert.equal(shield.shield, true);
  assert.equal(hull.shield, false);
  assert.ok(hull.t > shield.t);
  const distance = Math.hypot(
    hull.point.x - shield.point.x,
    hull.point.y - shield.point.y,
    hull.point.z - shield.point.z,
  );
  close(distance / (hull.t - shield.t), shield.incomingSpeed);
  close(shield.incomingSpeed, hull.incomingSpeed);
  close(
    hull.receiving.incomingDamage,
    Object.values(shield.receiving.overflow).reduce((a, b) => a + b, 0),
  );
  assert.equal(r.shieldRemaining, 0);
  assert.ok(r.hullRemaining < 100);
});

test('instantaneous beams establish contact immediately with no slow travelling substitute', () => {
  const r = new WeaponRangeModel();
  r.configure('pulse', {
    position: { x: 0, y: 0, z: 0 },
    muzzles: [{ id: 'lens', position: { x: 0, y: 0.2, z: -0.4 } }],
  });
  const fire = r.fire()[0],
    impact = r.drain().find((e) => e.type === 'impact');
  assert.equal(impact.t, fire.t);
  assert.equal(impact.response.instantaneous, true);
  assert.equal(impact.response.propagationSpeed, 0);
});
