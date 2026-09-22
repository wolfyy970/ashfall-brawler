import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import { VisualStudy } from '../tableau.js';
import { solveMountPose } from '../runtime/math/mount-pose.js';
import { weaponProfile } from '../runtime/model/weapon-profiles.js';
import { WeaponRangeModel } from '../runtime/model/weapon-range-model.js';
import { createProjectile, advanceProjectile } from '../runtime/model/projectile-motion.js';
import { ProjectileView } from '../runtime/views/projectile-view.js';

const close = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, a + ' != ' + b);
const muzzle = (id) => ({ id, position: { x: 0, y: 0.2, z: -0.4 } });
test('cannon salvos emit every physical barrel at one exact timestamp', () => {
  for (const count of [1, 2, 3, 4, 5]) {
    const model = new VisualStudy();
    const definition = {
      position: { x: 1, y: 0.6, z: 0 },
      displayScale: 1,
      muzzles: Array.from({ length: count }, (_, i) => muzzle('port-' + i)),
    };
    model.configureMounts(0, [definition, definition]);
    model.ships[0].weapons = ['cannon', 'cannon'];
    const salvo = model.fireMount(0, 0);
    assert.equal(salvo.length, count);
    assert.deepEqual(
      salvo.map((e) => e.muzzleIndex),
      Array.from({ length: count }, (_, i) => i),
    );
    assert.equal(new Set(salvo.map((e) => e.t)).size, 1);
    assert.equal(new Set(salvo.map((e) => e.salvoID)).size, 1);
    assert.equal(new Set(salvo.map((e) => e.shotID)).size, count);
    assert.deepEqual(
      salvo.map((e) => e.muzzleId),
      Array.from({ length: count }, (_, i) => 'port-' + i),
    );
    for (const event of salvo)
      assert.deepEqual(
        event.origin,
        model.fireOrigin(model.ships[0], model.ships[3], 0, event.muzzleIndex),
      );
  }
});

test('repeated cannon salvos lose no muzzle events and battery fire is coordinated', () => {
  const model = new VisualStudy();
  const definition = {
    position: { x: 1, y: 0.6, z: 0 },
    muzzles: [muzzle('left'), muzzle('right')],
  };
  model.configureMounts(0, [definition, definition]);
  model.ships[0].weapons = ['cannon', 'cannon'];
  const first = model.fireMount(0, 0),
    second = model.fireMount(0, 0);
  assert.equal(new Set([...first, ...second].map((e) => e.shotID)).size, 4);
  assert.notEqual(first[0].salvoID, second[0].salvoID);
  const battery = model.fireBattery(0);
  assert.equal(battery.length, 4);
  assert.equal(new Set(battery.map((e) => e.batteryID)).size, 1);
  assert.equal(new Set(battery.map((e) => e.t)).size, 1);
  assert.equal(model.drain().filter((e) => e.type === 'fire').length, 8);
});

test('missiles support groups of 1, 2, 3, 6 and deliberate ripple timing', () => {
  const model = new WeaponRangeModel();
  const mount = {
    position: { x: 0, y: 0, z: 0 },
    muzzles: Array.from({ length: 6 }, (_, i) => muzzle('tube-' + i)),
  };
  model.configure('missile', mount);
  assert.equal(model.fire().length, 3);
  assert.deepEqual(
    model.fire().map((e) => e.muzzleIndex),
    [3, 4, 5],
  );
  for (const count of [1, 2, 3, 6]) {
    model.setParameters({ firing: { mode: 'simultaneous', count } });
    const events = model.fire();
    assert.equal(events.length, count);
    assert.equal(new Set(events.map((e) => e.t)).size, 1);
  }
  model.setParameters({ firing: { mode: 'ripple', count: 3, rippleInterval: 0.2 } });
  const first = model.fire();
  assert.equal(first.length, 1);
  const salvoID = first[0].salvoID;
  model.step(0.2);
  model.step(0.2);
  const ripple = model.drain().filter((e) => e.type === 'fire' && e.salvoID === salvoID);
  assert.deepEqual(ripple.map((e) => e.t).sort(), [0, 0.2, 0.4]);
  assert.equal(new Set(ripple.map((e) => e.muzzleId)).size, 3);
});
test('muzzle DTOs match a real Three hierarchy with bank, socket rotation, yaw and elevation', () => {
  const shipQ = new T.Quaternion().setFromEuler(new T.Euler(0.18, 0.67, -0.31));
  const socketQ = new T.Quaternion().setFromEuler(new T.Euler(0.15, -0.2, 0.27));
  const ship = { x: 5, y: 2, z: -3, quaternion: shipQ },
    mount = {
      position: { x: -1.5, y: 0.7, z: 0.9 },
      quaternion: socketQ,
      displayScale: 1.37,
      yawOrigin: { x: 0, y: 0.12, z: 0.03 },
      pitchOrigin: { x: 0, y: 0.31, z: -0.03 },
      muzzles: [
        { id: 'one', position: { x: -0.12, y: 0.31, z: -0.9 } },
        { id: 'two', position: { x: 0.12, y: 0.31, z: -0.9 } },
      ],
    };
  const solved = solveMountPose(ship, { x: -4, y: 5, z: -14 }, mount);
  const hull = new T.Group();
  hull.position.set(ship.x, ship.y, ship.z);
  hull.quaternion.copy(shipQ);
  hull.scale.setScalar(mount.displayScale);
  const socket = new T.Group();
  socket.position.copy(mount.position);
  socket.quaternion.copy(socketQ);
  hull.add(socket);
  const yaw = new T.Group();
  yaw.position.copy(mount.yawOrigin);
  yaw.rotation.y = solved.yaw;
  socket.add(yaw);
  const pitch = new T.Group();
  pitch.position.copy(mount.pitchOrigin).sub(new T.Vector3().copy(mount.yawOrigin));
  pitch.rotation.x = solved.pitch;
  yaw.add(pitch);
  for (let i = 0; i < 2; i++) {
    const tip = new T.Object3D();
    tip.position.copy(mount.muzzles[i].position).sub(new T.Vector3().copy(mount.pitchOrigin));
    pitch.add(tip);
    const actual = tip.getWorldPosition(new T.Vector3()),
      dir = new T.Vector3(0, 0, -1).applyQuaternion(tip.getWorldQuaternion(new T.Quaternion()));
    for (const axis of ['x', 'y', 'z']) {
      close(actual[axis], solved.muzzles[i].position[axis]);
      close(dir[axis], solved.muzzles[i].direction[axis]);
    }
  }
});
test('a missile exits along its actual bore axis before ignition or guidance', () => {
  const profile = weaponProfile('missile', { speed: 4, length: 0.5 });
  const p = createProjectile({
    id: 1,
    weapon: 'missile',
    ship: 0,
    target: 1,
    origin: { x: 1, y: 2, z: 3 },
    direction: { x: 0, y: 0, z: -1 },
    profile,
  });
  advanceProjectile(p, { x: 20, y: 12, z: 3 }, 0.1);
  assert.equal(p.phase, 'ejection');
  close(p.x, 1);
  close(p.y, 2);
  close(p.z, 2.6);
  close(p.vx, 0);
  advanceProjectile(p, { x: 20, y: 12, z: 3 }, 0.09);
  assert.equal(p.phase, 'ignition');
  close(p.x, 1);
  const previous = new T.Vector3(p.vx, p.vy, p.vz).normalize();
  advanceProjectile(p, { x: 20, y: 12, z: 3 }, 0.12);
  assert.equal(p.phase, 'flight');
  assert.ok(
    previous.angleTo(new T.Vector3(p.vx, p.vy, p.vz).normalize()) <= profile.turnRate * 0.12 + 1e-6,
  );
});
test('engine profile overrides apply to new shots while existing flights retain their parameters', () => {
  const model = new VisualStudy();
  model.ships[0].weapons[0] = 'cannon';
  model.configureMounts(0, [{ position: { x: 0, y: 1, z: 0 }, muzzles: [muzzle('bore')] }]);
  model.setWeaponProfile('cannon', { speed: 17, length: 1.2, diameter: 0.031 });
  const [e] = model.fireMount(0, 0),
    p = model.shots[0];
  close(Math.hypot(p.vx, p.vy, p.vz), 17);
  model.setWeaponProfile('cannon', { speed: 31, length: 0.4 });
  assert.equal(p.profile.length, 1.2);
  assert.equal(model.fireMount(0, 0)[0].profile.speed, 31);
  assert.equal(e.origin.x, p.x);
  assert.equal(e.origin.y, p.y);
  assert.equal(e.origin.z, p.z);
});
test('flight renderer uses snapshot position and length, keeps the nose at the engine point and reuses geometry', () => {
  const scene = new T.Scene(),
    view = new ProjectileView(scene, { capacity: 4 });
  const geometries = scene.children.map((m) => m.geometry),
    profile = weaponProfile('cannon', { length: 2, diameter: 0.05, speed: 99 });
  const event = {
    id: 1,
    weapon: 'cannon',
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    profile,
    t: 0,
  };
  view.begin(event);
  view.sync(
    [
      {
        id: 1,
        kind: 'cannon',
        x: 10,
        y: 4,
        z: -2,
        vx: 9,
        vy: 0,
        vz: 0,
        age: 1,
        profile,
        origin: event.origin,
      },
    ],
    1,
  );
  const matrix = new T.Matrix4();
  view.cannon.getMatrixAt(0, matrix);
  const nose = new T.Vector3(0, 0.5, 0).applyMatrix4(matrix),
    rear = new T.Vector3(0, -0.5, 0).applyMatrix4(matrix);
  close(nose.x, 10);
  close(nose.y, 4);
  close(nose.z, -2);
  close(nose.distanceTo(rear), 2);
  for (let i = 0; i < 100; i++) {
    view.clear();
    view.begin({ ...event, id: i + 2 });
    view.sync([], i + 2);
  }
  assert.deepEqual(
    scene.children.map((m) => m.geometry),
    geometries,
  );
  assert.equal(view.slots.length, 4);
  view.dispose();
  assert.equal(scene.children.length, 0);
});
test('terminal missile event lands its retained trail at the last physical nozzle position', () => {
  const view = new ProjectileView(new T.Scene(), { capacity: 2 }),
    profile = weaponProfile('missile', { length: 0.5 });
  view.begin({
    id: 8,
    weapon: 'missile',
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    profile,
    t: 0,
  });
  view.sync(
    [
      {
        id: 8,
        kind: 'missile',
        x: 1,
        y: 0,
        z: 0,
        vx: 4,
        vy: 0,
        vz: 0,
        age: 0.4,
        phase: 'flight',
        profile,
      },
    ],
    0.4,
  );
  const slot = view.active.get(8);
  view.end({ id: 8, point: { x: 2, y: 0.1, z: 0 }, t: 0.5 });
  assert.equal(view.active.size, 0);
  const index = (slot.head - 1 + 96) % 96;
  close(slot.history[index * 3], 1.5);
  close(slot.history[index * 3 + 1], 0.1);
  view.sync([], 3);
  assert.equal(slot.used, false);
  view.dispose();
});

test('long slow missiles wait for tail clearance before ignition', () => {
  const profile = weaponProfile('missile', { length: 0.6, speed: 1 });
  const p = createProjectile({
    id: 1,
    weapon: 'missile',
    origin: { x: 0, y: 0, z: 0 },
    direction: { x: 1, y: 0, z: 0 },
    profile,
  });
  advanceProjectile(p, { x: 0, y: 2, z: 10 }, 0.5);
  assert.equal(p.phase, 'ejection');
  close(p.x, 0.5);
  advanceProjectile(p, { x: 0, y: 2, z: 10 }, 0.15);
  assert.equal(p.phase, 'ignition');
  assert.ok(p.x > profile.length);
});

test('art-study batteries repeat synchronized eight-round broadsides', () => {
  const model = new VisualStudy();
  const port = {
    position: { x: -1, y: 0.6, z: 0 },
    muzzles: Array.from({ length: 4 }, (_, i) => ({
      id: 'port-' + i,
      position: { x: (i - 1.5) * 0.1, y: 0.2, z: -0.7 },
    })),
  };
  const starboard = { ...port, position: { x: 1, y: 0.6, z: 0 } };
  model.ships[1].weapons = ['cannon', 'cannon'];
  model.ships[1].cooldowns = [0, 0];
  model.configureMounts(1, [port, starboard]);
  const batches = [];
  for (let i = 0; i < 200; i++) {
    model.step(1 / 60);
    const fire = model.drain().filter((e) => e.type === 'fire' && e.ship === 1);
    if (fire.length) batches.push(fire);
  }
  assert.ok(batches.length >= 3);
  for (const batch of batches) {
    assert.equal(batch.length, 8);
    assert.equal(new Set(batch.map((e) => e.t)).size, 1);
    assert.equal(new Set(batch.map((e) => e.batteryID)).size, 1);
    assert.equal(new Set(batch.map((e) => JSON.stringify(e.origin))).size, 8);
  }
});
test('ripple births advance only the elapsed fraction after scheduled launch', () => {
  const model = new WeaponRangeModel();
  model.configure('missile', {
    position: { x: 0, y: 0, z: 0 },
    muzzles: [muzzle('one'), muzzle('two')],
  });
  model.setParameters({ speed: 1, firing: { mode: 'ripple', count: 2, rippleInterval: 0.055 } });
  model.fire();
  model.step(0.06);
  const second = model.shots.find((p) => p.muzzleId === 'two');
  close(second.age, 0.005);
  close(
    Math.hypot(second.x - second.origin.x, second.y - second.origin.y, second.z - second.origin.z),
    0.005,
  );
});
