import test from 'node:test';
import assert from 'node:assert/strict';
import {VisualStudy} from '../tableau.js';
import { ART_PASSES, getReviewMode } from '../runtime/model/review-mode.js';

const close = (actual, expected, epsilon = 1e-7) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
};

function configureFixtureMount(study) {
  study.configureMounts(0, [{
    position: { x: 1.25, y: .6, z: -.4 },
    muzzles: [{ x: -.12, y: .28, z: -.83 }, { x: .12, y: .28, z: -.83 }],
    displayScale: 1.2,
  }]);
}

test('hitscan impact carries renderer-independent intersection details', () => {
  const study = new VisualStudy();
  configureFixtureMount(study);
  for (const ship of study.ships) ship.cooldowns.fill(1000);
  study.ships[0].cooldowns[0] = 0;
  study.step(1 / 60);

  const events = study.drain();
  const fire = events.find(event => event.type === 'fire');
  const impact = events.find(event => event.type === 'impact');
  assert.equal(impact.kind, 'pulse');
  assert.equal(impact.projectileId, fire.id);
  assert.deepEqual(fire.aimPoint, impact.point);
  const expectedOrigin = study.fireOrigin(study.ships[0], study.ships[3], 0, fire.muzzleIndex);
  close(fire.origin.x, expectedOrigin.x);
  close(fire.origin.y, expectedOrigin.y);
  close(fire.origin.z, expectedOrigin.z);
  assert.notEqual(fire.origin.x, study.ships[0].x);
  close(Math.hypot(impact.normal.x, impact.normal.y, impact.normal.z), 1);
  close(Math.hypot(impact.incomingDir.x, impact.incomingDir.y, impact.incomingDir.z), 1);
  close(Math.hypot(
    impact.localUnitDirection.x,
    impact.localUnitDirection.y,
    impact.localUnitDirection.z,
  ), 1);
});

test('each projectile segment emits its own exact impact in the same tick', () => {
  const study = new VisualStudy();
  study.step(0);
  study.drain();
  for (const ship of study.ships) ship.cooldowns.fill(1000);
  const target = study.ships[3];
  const left = { x: target.x - 12, y: target.y, z: target.z };
  const right = { x: target.x + 12, y: target.y, z: target.z };
  study.shots.push(
    { id: 101, kind: 'cannon', owner: 0, target: 3, ...left, vx: 12, vy: 0, vz: 0, life: 2, age: 0 },
    { id: 102, kind: 'cannon', owner: 0, target: 3, ...right, vx: -12, vy: 0, vz: 0, life: 2, age: 0 },
  );

  study.step(1);
  const impacts = study.drain().filter(event => event.type === 'impact');
  assert.equal(impacts.length, 2);
  assert.deepEqual(new Set(impacts.map(event => event.projectileId)), new Set([101, 102]));
  assert.ok(impacts[0].point.x !== impacts[1].point.x);
  assert.ok(impacts[0].incomingDir.x * impacts[1].incomingDir.x < 0);
  assert.equal(study.shots.length, 0);
});

test('a depleted shield does not intercept the projectile segment', () => {
  const study = new VisualStudy();
  const target = study.ships[3];
  target.shieldNow = 0;
  assert.equal(study.shieldHit(
    { x: target.x - 20, y: target.y, z: target.z },
    { x: target.x, y: target.y, z: target.z },
    target,
  ), null);
});

test('reset removes queued projectiles and presentation events', () => {
  const study = new VisualStudy();
  configureFixtureMount(study);
  study.shots.push({ id: 9 });
  study.emit({ type: 'test' });
  study.reset();
  assert.deepEqual(study.shots, []);
  assert.deepEqual(study.drain(), []);
  assert.equal(study.time, 0);
  assert.equal(study.mountConfigs.get(0)[0].displayScale, 1.2);
});

test('review mode policy defaults safely and armor reset starts with exposed hull', () => {
  assert.equal(getReviewMode('unknown'), ART_PASSES.all);
  assert.equal(getReviewMode('armor').shields, false);
  assert.equal(getReviewMode('armor').projectiles, true);
  assert.equal(getReviewMode('armor').muzzleFire, true);
  assert.equal(getReviewMode('armor').hullHits, true);
  assert.equal(getReviewMode('armor').destruction, true);
  assert.equal(getReviewMode('shields').hullHits, false);
  assert.equal(getReviewMode('environment').weapons, false);
  const study = new VisualStudy();
  configureFixtureMount(study);
  study.reset({ exposedHull: true });
  assert.ok(study.ships.every((ship) => ship.shieldNow === 0));
  assert.equal(study.mountConfigs.get(0)[0].displayScale, 1.2);
  study.reset();
  assert.deepEqual(study.ships.map((ship) => ship.shieldNow), study.ships.map((ship) => ship.shield));
});

test('fatal destruction uses the hull contact time, current hull pose, and configured geometry', () => {
  const study = new VisualStudy();
  const target = study.ships[3];
  target.shieldNow = 0;
  target.hullNow = 1;
  target.x = 31;
  target.y = 2;
  target.z = -7;
  target.vx = 4;
  target.vy = -1;
  target.vz = 3;
  target.angle = 0;
  study.time = 5;
  study.configureDestruction(target.id, { radius: 3, length: 9 });
  study.configureDestruction(2, { radius: 1.25, length: 3.5 });
  assert.notDeepEqual(study.destructionShapes.get(2), study.destructionShapes.get(target.id));
  study.configureHullSurface(target.id, () => ({
    t: .6,
    point: { x: 30, y: 2, z: -7 },
    normal: { x: -1, y: 0, z: 0 },
  }));
  study.resolveImpacts({
    projectileId: 1, kind: 'cannon', owner: 0, target,
    start: { x: 25, y: 2, z: -7 }, end: { x: 35, y: 2, z: -7 },
    profile: { mode: 'projectile', damage: { em: 0, thermal: 0, kinetic: 100, explosive: 0 }, weaponSize: 'small' },
    muzzleIndex: 0, incomingVelocity: { x: 10, y: 0, z: 0 }, stepDuration: 1,
  });
  const destroy = study.drain().find((event) => event.type === 'destroy');
  assert.equal(destroy.t, 4.6);
  assert.deepEqual(destroy.point, { x: 31, y: 2, z: -7 });
  assert.deepEqual(destroy.velocity, { x: 4, y: -1, z: 3 });
  assert.deepEqual(destroy.forward, { x: 0, y: 0, z: -1 });
  assert.equal(destroy.radius, 3);
  assert.equal(destroy.length, 9);
  assert.equal(destroy.x, 31);
  assert.equal(destroy.z, -7);
  assert.ok(Object.isFrozen(destroy));
  assert.ok(Object.isFrozen(destroy.point));
  assert.throws(() => { destroy.radius = 99; }, TypeError);
  study.reset();
  assert.deepEqual(study.destructionShapes.get(target.id), { radius: 3, length: 9 });
});

 test('configured mount geometry retains its physical offset',()=>{
 const study=new VisualStudy();configureFixtureMount(study);
 const p=study.fireOrigin({id:0,x:10,y:2,z:20,angle:Math.PI/2},{x:10,y:0,z:0},0,0);
 assert.ok(p.x>10 && p.z>20);assert.ok(p.y>2);
 });
