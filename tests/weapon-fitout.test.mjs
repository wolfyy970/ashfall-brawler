import test from 'node:test';
import assert from 'node:assert/strict';
import { WeaponFitoutModel } from '../runtime/model/weapon-fitout-model.js';

const mount = (x, muzzleXs = [0]) => ({
  position: { x, y: 0, z: 0 },
  yawOrigin: { x: 0, y: 0, z: 0 },
  pitchOrigin: { x: 0, y: 0, z: 0 },
  elevation: false,
  muzzles: muzzleXs.map((mx, index) => ({
    id: `m${index}`,
    position: { x: mx, y: 0, z: -1 },
    direction: { x: 0, y: 0, z: -1 },
  })),
});

test('three hardpoints retain independent loadouts and battery shots share a timestamp', () => {
  const model = new WeaponFitoutModel();
  model.equip('left', { kind: 'cannon', definition: mount(-3, [-0.2, 0.2]) });
  model.equip('center', { kind: 'pulse', definition: mount(0, [-0.2, 0.2]) });
  model.equip('right', { kind: 'rail', definition: mount(3) });

  const left = model.mounts.get('left');
  model.equip('center', { kind: 'web', definition: mount(0) });
  assert.equal(model.mounts.get('left'), left, 'equipping another hardpoint preserves identity');

  model.step(0.4);
  const events = model.fireBattery();
  assert.deepEqual(events.map((event) => event.mount), ['left', 'left', 'center', 'right']);
  assert.ok(events.every((event) => event.t === 0.4));
  assert.deepEqual(
    events.slice(0, 2).map((event) => event.origin),
    model.pose('left').muzzles.map((muzzle) => muzzle.position),
    'events use the simultaneous solved muzzle origins',
  );
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
  assert.deepEqual(model.drain(), events);
  assert.equal(model.shots.length, 2, 'only cannon rounds enter the projectile pool');
});

test('mixed projectile and beam fire use the shared event and endpoint contract', () => {
  const model = new WeaponFitoutModel();
  model.equip(0, { kind: 'cannon', definition: mount(-1) });
  model.equip(1, { kind: 'pulse', definition: mount(1) });
  const [round, beam] = model.fireBattery();

  assert.equal(round.profile.mode, 'projectile');
  assert.equal(beam.profile.mode, 'beam');
  assert.equal(model.shots[0].shotID, round.shotID);
  assert.ok(Math.abs(Math.hypot(
    beam.aimPoint.x - beam.origin.x,
    beam.aimPoint.y - beam.origin.y,
    beam.aimPoint.z - beam.origin.z,
  ) - 40) < 1e-9);
  assert.equal(model.active, true);
  model.step(beam.profile.lifetime + 0.01);
  assert.equal(model.active, true, 'projectile remains active after the beam tail');
});

test('missiles transition from ejection through ignition to guided flight', () => {
  const model = new WeaponFitoutModel();
  model.equip('rack', { kind: 'missile', definition: mount(0, [-1, 0, 1]) });
  const events = model.fire('rack');
  assert.equal(events.length, 3);
  assert.ok(model.shots.every((shot) => shot.phase === 'ejection'));
  model.drain();

  model.step(0.2);
  assert.ok(model.shots.every((shot) => shot.phase === 'ignition'));
  model.step(0.2);
  assert.ok(model.shots.every((shot) => shot.phase === 'flight'));
});

test('ripple orders stay pending and emit at their authored times', () => {
  const model = new WeaponFitoutModel();
  model.equip('gun', {
    kind: 'cannon', definition: mount(0, [-1, 0, 1]),
    parameters: { firing: { mode: 'ripple', count: 3, rippleInterval: 0.2 } },
  });
  assert.equal(model.fire('gun').length, 1);
  assert.equal(model.pendingFire.length, 2);
  model.drain();
  model.step(0.02);
  assert.deepEqual(model.drain(), []);
  model.step(0.19);
  assert.equal(model.drain()[0].t, 0.2);
  model.step(0.2);
  assert.equal(model.drain()[0].t, 0.4);
});

test('clear and re-equip remove stale work while retaining loadouts and unique IDs', () => {
  const model = new WeaponFitoutModel();
  const definition = mount(0, [-1, 0, 1]);
  model.equip('slot', {
    kind: 'cannon', definition,
    parameters: { firing: { mode: 'ripple', count: 3, rippleInterval: 0.1 } },
  });
  const first = model.fire('slot')[0];
  model.clear();
  assert.equal(model.mounts.get('slot').kind, 'cannon');
  assert.equal(model.active, false);
  assert.deepEqual(model.drain(), []);
  const second = model.fire('slot')[0];
  assert.ok(second.id > first.id);

  model.equip('slot', { kind: 'pulse', definition });
  assert.equal(model.shots.length, 0);
  assert.equal(model.pendingFire.length, 0);
  assert.deepEqual(model.drain(), []);
});

test('projectile capacity rejects an entire salvo and expired rounds emit ends', () => {
  const model = new WeaponFitoutModel();
  model.maxProjectiles = 2;
  model.equip('gun', { kind: 'cannon', definition: mount(0, [-1, 0, 1]) });
  assert.deepEqual(model.fire('gun'), []);
  assert.equal(model.shots.length, 0);
  assert.equal(model.mounts.get('gun').cursor, 0);

  model.equip('gun', {
    kind: 'cannon', definition: mount(0), parameters: { lifetime: 0.05 },
  });
  assert.equal(model.fire('gun').length, 1);
  model.drain();
  model.step(0.06);
  const [ended] = model.drain();
  assert.equal(ended.type, 'projectile-end');
  assert.equal(ended.reason, 'expired');
  assert.equal(ended.hit, false);
  model.step(0.19);
  assert.equal(model.active, false);
});

test('active covers the full recoil tail after a short pulse beam', () => {
  const model = new WeaponFitoutModel();
  model.equip('pulse', { kind: 'pulse', definition: mount(0) });
  model.fire('pulse');
  model.drain();
  model.step(0.2);
  assert.equal(model.active, true, 'the scheduler must continue through the 0.24s rig recoil');
  model.step(0.041);
  assert.equal(model.active, false);
});

test('beam ripples and undrained events remain bounded without partial salvos', () => {
  const model = new WeaponFitoutModel();
  model.maxPending = 4;
  model.maxEvents = 5;
  model.equip('beam', {
    kind: 'pulse', definition: mount(0, [-1, 0, 1]),
    parameters: { firing: { mode: 'ripple', count: 'all', rippleInterval: 10 } },
  });
  assert.equal(model.fire('beam').length, 1);
  assert.equal(model.fire('beam').length, 1);
  assert.equal(model.pendingFire.length, 4);
  assert.deepEqual(model.fire('beam'), [], 'the complete third salvo is rejected');
  assert.equal(model.pendingFire.length, 4);

  model.clear();
  model.equip('beam', { kind: 'pulse', definition: mount(0, [-1, 0, 1]) });
  for (let i = 0; i < 4; i++) model.fire('beam');
  assert.equal(model.events.length, 5);
  assert.deepEqual(model.events.map((event) => event.id), [10, 11, 12, 13, 14]);
});
