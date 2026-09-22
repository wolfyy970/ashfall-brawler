import test from 'node:test';
import assert from 'node:assert/strict';
import { VisualStudy } from '../tableau.js';
import { stepShipMotion } from '../runtime/model/ship-motion.js';
import { beginStudyFlight, studyFlightCommands } from '../runtime/model/study-flight.js';

const spec = { maxSpeed: 4, acceleration: 2, turnRate: 1 };
const pose = ({ x, y, z, angle }) => ({ x, y, z, angle });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('generic motor respects speed, acceleration and turn limits for arbitrary movement commands', () => {
  let ship = { x: 200, y: 13, z: -92, angle: 0, vx: 0, vy: 0, vz: 0 };
  const command = { velocity: { x: 50, y: 2, z: 3 } };
  for (let i = 0; i < 1200; i++) {
    const previous = { ...ship };
    const next = stepShipMotion(ship, command, 1 / 60, spec);
    assert.deepEqual(ship, previous, 'motor must not mutate its input');
    assert.ok(Math.hypot(next.vx, next.vy, next.vz) <= 4 + 1e-8);
    assert.ok(Math.hypot(next.vx - ship.vx, next.vy - ship.vy, next.vz - ship.vz) <= 2 / 60 + 1e-8);
    assert.ok(
      Math.abs(Math.atan2(Math.sin(next.angle - ship.angle), Math.cos(next.angle - ship.angle))) <=
        1 / 60 + 1e-8,
    );
    assert.ok(Math.abs(next.angularVelocity - (ship.angularVelocity ?? 0)) <= 1 / 60 + 1e-8);
    close(next.x - ship.x, next.vx / 60);
    close(next.y - ship.y, next.vy / 60);
    close(next.z - ship.z, next.vz / 60);
    ship = next;
  }
  close(ship.angle, Math.atan2(ship.vx, -ship.vz));
});

test('zero time and invalid inputs cannot corrupt motion or simulation clocks', () => {
  const ship = {
    x: 2,
    y: 0,
    z: 4,
    angle: 0.3,
    vx: 1,
    vy: 0,
    vz: 2,
    bank: 0,
    angularVelocity: 0,
    thrust: 0,
  };
  assert.deepEqual(stepShipMotion(ship, { velocity: { x: 4 } }, 0, spec), ship);
  assert.deepEqual(stepShipMotion(ship, { stop: true }, 0, spec), ship);
  assert.throws(
    () => stepShipMotion({ ...ship, angularVelocity: 2 }, {}, 1 / 60, spec),
    RangeError,
  );
  for (const field of ['angle', 'bank', 'angularVelocity', 'thrust'])
    assert.throws(() => stepShipMotion({ ...ship, [field]: NaN }, { stop: true }, 1 / 60, spec));
  assert.equal(stepShipMotion({ x: 1 }, { stop: true }, 0, spec).angle, 0);
  const study = new VisualStudy();
  for (const dt of [NaN, Infinity, -0.1]) assert.throws(() => study.step(dt));
  assert.equal(study.time, 0);
});

test('Flight toggles preserve health, time and queued combat; disabling holds the current poses', () => {
  const study = new VisualStudy();
  study.reset({ exposedHull: true });
  for (const ship of study.ships) ship.cooldowns.fill(1000);
  study.ships[0].hullNow = 37;
  study.emit({ type: 'queued' });
  const before = study.ships.map(pose);
  study.setFlightEnabled(true);
  assert.deepEqual(study.ships.map(pose), before);
  assert.equal(study.ships[0].hullNow, 37);
  assert.equal(study.events.length, 1);
  for (let i = 0; i < 120; i++) study.step(1 / 60);
  assert.notDeepEqual(study.ships.map(pose), before);
  const frozen = study.ships.map(pose),
    time = study.time;
  const maneuver = study.flightPlan;
  study.setFlightEnabled(false);
  assert.equal(study.time, time);
  study.step(1);
  assert.deepEqual(study.ships.map(pose), frozen);
  assert.ok(study.ships.every((ship) => Math.hypot(ship.vx, ship.vy, ship.vz) === 0));
  study.setFlightEnabled(true);
  assert.equal(
    study.flightPlan,
    maneuver,
    'resume the existing maneuver instead of restarting its route',
  );
  assert.deepEqual(study.ships.map(pose), frozen);
  const dead = study.ships[1];
  dead.alive = false;
  const deadPose = pose(dead);
  study.step(1 / 60);
  assert.deepEqual(pose(dead), deadPose);
  assert.equal(Math.hypot(dead.vx, dead.vy, dead.vz), 0);
  study.reset();
  assert.equal(study.flightEnabled, true);
  assert.deepEqual(study.ships.map(pose), before);
});

test('demo pilot only requests velocities and supports different fleet sizes and identities', () => {
  for (const count of [1, 3, 6]) {
    const ships = Array.from({ length: count }, (_, i) => ({
      id: `pilot-${10 + i * 7}`,
      x: 15 * Math.cos(i * 2),
      y: 0,
      z: 13 * Math.sin(i * 2),
      alive: true,
    }));
    const original = structuredClone(ships);
    const result = studyFlightCommands(beginStudyFlight(ships), ships, 1 / 60);
    assert.deepEqual(ships, original);
    assert.equal(result.commands.size, count);
    for (const ship of ships) {
      const command = result.commands.get(ship.id);
      assert.deepEqual(Object.keys(command), ['velocity']);
      assert.ok(Object.values(command.velocity).every(Number.isFinite));
    }
  }
});

test('the full flight study stays within frame and preserves spacing without velocity spikes', () => {
  const study = new VisualStudy();
  study.setFlightEnabled(true);
  for (const ship of study.ships) ship.cooldowns.fill(1000);
  for (let i = 0; i < 45 * 60; i++) {
    study.step(1 / 60);
    for (const ship of study.ships) {
      assert.ok(
        Math.hypot(ship.vx, ship.vy, ship.vz) <= (ship.hullType === 'brawler' ? 1.6 : 2.4) + 1e-8,
      );
      assert.ok(Math.abs(ship.x) < 26 && Math.abs(ship.z) < 19);
    }
    for (let a = 0; a < study.ships.length; a++)
      for (let b = a + 1; b < study.ships.length; b++)
        assert.ok(
          Math.hypot(study.ships[a].x - study.ships[b].x, study.ships[a].z - study.ships[b].z) > 12,
        );
  }
});

test('a broadside command turns the hull before accelerating and preserves momentum in a course change', () => {
  const heavy = { maxSpeed: 1.6, acceleration: 0.4, turnRate: 0.28, angularAcceleration: 0.2 };
  let ship = { x: 0, y: 0, z: 0, angle: 0, vx: 0, vy: 0, vz: 0 };
  const command = { velocity: { x: 1.6 } };
  for (let i = 0; i < 60; i++) ship = stepShipMotion(ship, command, 1 / 60, heavy);
  assert.ok(ship.angle > 0 && ship.angle < 0.11, 'yaw must spool up, not swivel instantly');
  assert.ok(
    Math.hypot(ship.x, ship.z) < 0.02,
    'engines cannot accelerate sideways before the turn',
  );
  const cruise = { x: 0, y: 0, z: 0, angle: 0, vx: 0, vy: 0, vz: -1.6, thrust: 0 };
  const turning = stepShipMotion(cruise, command, 1 / 60, heavy);
  assert.ok(turning.vz < -1.59, 'existing forward momentum survives a new course order');
  assert.ok(Math.abs(turning.vx) < 0.001, 'no instant lateral velocity');
});

test('forward engine power rises under acceleration and falls while coasting', () => {
  const heavy = { maxSpeed: 1.6, acceleration: 0.4, turnRate: 0.28, angularAcceleration: 0.2 };
  let ship = { x: 0, y: 0, z: 0, angle: 0 };
  const command = { velocity: { z: -1.6 } };
  for (let i = 0; i < 60; i++) ship = stepShipMotion(ship, command, 1 / 60, heavy);
  assert.ok(ship.thrust > 0.9);
  for (let i = 0; i < 20 * 60; i++) ship = stepShipMotion(ship, command, 1 / 60, heavy);
  assert.ok(ship.thrust < 0.01, 'constant speed is not full engine thrust');
  assert.ok(ship.vz < -1.59);
});

test('motion at 30 and 60 Hz follows the same maneuver without frame-dependent turns', () => {
  const limits = { maxSpeed: 2.4, acceleration: 0.65, turnRate: 0.42, angularAcceleration: 0.3 };
  const run = (hz) => {
    let ship = { x: 0, y: 0, z: 0, angle: 0 };
    for (let i = 0; i < 16 * hz; i++) {
      ship = stepShipMotion(
        ship,
        { velocity: i < 6 * hz ? { z: -2.4 } : { x: 2.4 } },
        1 / hz,
        limits,
      );
    }
    return ship;
  };
  const a = run(30),
    b = run(60);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 0.08);
  assert.ok(Math.abs(a.angle - b.angle) < 0.01);
});
