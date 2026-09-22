import test from 'node:test';
import assert from 'node:assert/strict';
import { VisualStudy } from '../tableau.js';
import { intersectSegmentBox } from '../runtime/math/box-intersection.js';
import { weaponProfile } from '../runtime/model/weapon-profiles.js';

const damage = { em: 0, thermal: 0, kinetic: 40, explosive: 0 };

function hullPort(target) {
  return (start, end) =>
    intersectSegmentBox(start, end, {
      center: { x: target.x, y: target.y, z: target.z },
      halfSize: { x: 1, y: 1, z: 1 },
    });
}

test('main tableau persists shield damage and sends raw overflow to the real hull surface', () => {
  const study = new VisualStudy();
  const target = study.ships[3];
  target.shieldNow = 1;
  study.setHullSurface(target.id, hullPort(target));
  const start = { x: target.x - 10, y: target.y, z: target.z };
  const end = { x: target.x + 10, y: target.y, z: target.z };
  const velocity = { x: 20, y: 0, z: 0 };
  study.time = 4;

  const result = study.resolveImpacts({
    projectileId: 72,
    kind: 'cannon',
    owner: 0,
    target,
    start,
    end,
    profile: weaponProfile('cannon', { damage }),
    incomingVelocity: velocity,
    stepDuration: 1,
  });
  const impacts = study.drain().filter((event) => event.type === 'impact');

  assert.equal(result.terminal, true);
  assert.equal(impacts.length, 2);
  assert.deepEqual(
    impacts.map((event) => event.shield),
    [true, false],
  );
  assert.equal(target.shieldNow, 0);
  assert.ok(target.hullNow < target.hull);
  assert.ok(impacts[0].point.x < impacts[1].point.x);
  assert.ok(impacts[0].t < impacts[1].t);
  assert.deepEqual(impacts[0].incomingVelocity, velocity);
  assert.deepEqual(impacts[1].incomingVelocity, velocity);
  assert.equal(impacts[0].terminal, false);
  assert.equal(impacts[1].terminal, true);

  study.step(1 / 60);
  assert.equal(target.shieldNow, 0, 'a simulation step must not restore shield HP');
  assert.ok(target.hullNow < target.hull, 'a simulation step must not restore hull HP');
});

test('overflow remains in flight at unchanged velocity until a hull surface is crossed', () => {
  const study = new VisualStudy();
  const target = study.ships[3];
  target.shieldNow = 1;
  const velocity = { x: 31, y: -2, z: 4 };
  const result = study.resolveImpacts({
    projectileId: 73,
    kind: 'cannon',
    owner: 0,
    target,
    start: { x: target.x - 10, y: target.y, z: target.z },
    end: { x: target.x, y: target.y, z: target.z },
    profile: weaponProfile('cannon', { damage }),
    incomingVelocity: velocity,
    stepDuration: 0.5,
  });

  assert.equal(result.terminal, false);
  assert.equal(result.passedShield, true);
  assert.ok(Object.values(result.damage).some((amount) => amount > 0));
  assert.deepEqual(study.drain()[0].incomingVelocity, velocity);
});

test('beam shield and overflow hull contacts share the firing timestamp and zero velocity', () => {
  const study = new VisualStudy();
  const target = study.ships[3];
  target.shieldNow = 1;
  study.setHullSurface(target.id, hullPort(target));
  const firedAt = 2.25;
  study.resolveImpacts({
    projectileId: 74,
    kind: 'rail',
    owner: 0,
    target,
    start: { x: target.x - 10, y: target.y, z: target.z },
    end: { x: target.x + 10, y: target.y, z: target.z },
    profile: weaponProfile('rail', { damage }),
    incomingVelocity: { x: 99, y: 0, z: 0 },
    firedAt,
  });
  const impacts = study.drain().filter((event) => event.type === 'impact');
  assert.deepEqual(
    impacts.map((event) => event.t),
    [firedAt, firedAt],
  );
  assert.ok(impacts.every((event) => event.instantaneous && event.incomingSpeed === 0));
});

test('dead ships cannot fire cooldown or queued ripple shots', () => {
  const study = new VisualStudy();
  const dead = study.ships[0];
  dead.alive = false;
  dead.cooldowns.fill(0);
  study.pendingFire.push({
    shipId: dead.id,
    mountIndex: 0,
    muzzleIndex: 0,
    t: 0,
    kind: 'pulse',
    profile: weaponProfile('pulse'),
  });
  study.step(0.1);
  assert.equal(study.totalShots, 0);
  assert.equal(study.pendingFire.length, 0);
  assert.equal(
    study.drain().some((event) => event.type === 'fire'),
    false,
  );
});

test('two-team targeting includes all ships and retargets only living opponents', () => {
  const study = new VisualStudy();
  assert.deepEqual(
    study.ships.map((ship) => ship.target),
    [3, 2, 1, 0],
  );
  study.ships[3].alive = false;
  for (const ship of study.ships) ship.cooldowns.fill(1000);
  study.step(0);
  assert.equal(study.ships[0].target, 2);
  assert.ok(
    study.ships.every((ship) => !ship.alive || study.ships[ship.target].id < 2 !== ship.id < 2),
  );
});

test('team elimination exposes one stable study end timestamp', () => {
  const study = new VisualStudy();
  for (const ship of study.ships) ship.cooldowns.fill(1000);
  study.ships[2].alive = false;
  study.ships[3].alive = false;
  study.step(0.25);
  assert.equal(study.endedAt, 0.25);
  study.step(1);
  assert.equal(study.endedAt, 0.25);
  study.reset();
  assert.equal(study.endedAt, null);
});

test('terminal projectile event uses the exact contact timestamp', () => {
  const study = new VisualStudy();
  for (const ship of study.ships) ship.cooldowns.fill(1000);
  const target = study.ships[3];
  study.shots.push({
    id: 91,
    kind: 'cannon',
    owner: 0,
    target: target.id,
    x: target.x - 12,
    y: target.y,
    z: target.z,
    vx: 24,
    vy: 0,
    vz: 0,
    life: 2,
    age: 0,
    bornAt: 0,
    profile: weaponProfile('cannon'),
  });
  study.step(1);
  const events = study.drain();
  const impact = events.find((event) => event.type === 'impact' && event.projectileId === 91);
  const ended = events.find((event) => event.type === 'projectile-end' && event.id === 91);
  assert.ok(impact.t < study.time);
  assert.equal(ended.t, impact.t);
});
