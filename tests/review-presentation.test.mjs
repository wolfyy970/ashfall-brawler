import test from 'node:test';
import assert from 'node:assert/strict';
import { BattlePresentationController } from '../runtime/controllers/battle-presentation-controller.js';

function inspect(mode) {
  const calls = [];
  const record =
    (name) =>
    (...args) =>
      calls.push({ name, args });
  const controller = new BattlePresentationController({
    simulation: { time: 1 },
    models: [{ weapons: [], shield: { impact: record('shield') } }],
    effects: {
      launch: record('launch'),
      impact: record('impact'),
      destroy: record('destroy'),
      finishProjectile: record('end'),
    },
    audio: { play() {} },
    pilots: [{ name: 'RUST' }],
    getReview: () => mode,
  });
  return { controller, calls };
}

const point = { x: 1, y: 0, z: 0 };
const shieldHit = { type: 'impact', ship: 0, shield: true, point, localUnitDirection: point };
const hullHit = { type: 'impact', ship: 0, shield: false, point };

test('armor inspection routes flight, actual hull contacts and destruction without shield effects', () => {
  const { controller, calls } = inspect('armor');
  const destruction = Object.freeze({ type: 'destroy', ship: 0, owner: 0, point, x: 1 });
  controller.present({ type: 'fire', ship: 0, weapon: 'cannon', origin: point, aimPoint: point });
  controller.present(shieldHit);
  controller.present(hullHit);
  controller.present(destruction);
  controller.present({ type: 'projectile-end', id: 9 });
  assert.deepEqual(
    calls.map((c) => c.name),
    ['launch', 'impact', 'destroy', 'end'],
  );
  assert.equal(calls[1].args[0], hullHit);
  assert.equal(calls[2].args[0], destruction, 'ship-derived event passes to the view unchanged');
});

test('shield inspection excludes hull hits and destruction; full scene routes both layers', () => {
  for (const mode of ['shields', 'all', 'environment', 'thrusters']) {
    const { controller, calls } = inspect(mode);
    controller.present(shieldHit);
    controller.present(hullHit);
    controller.present({ type: 'destroy', ship: 0, owner: 0, point, x: 1 });
    assert.deepEqual(
      calls.map((c) => c.name),
      mode === 'all'
        ? ['shield', 'impact', 'impact', 'destroy']
        : mode === 'shields'
          ? ['shield', 'impact']
          : [],
    );
  }
});
