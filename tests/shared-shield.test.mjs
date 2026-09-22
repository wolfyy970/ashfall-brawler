import test from 'node:test';
import assert from 'node:assert/strict';
import { BattlePresentationController } from '../runtime/controllers/battle-presentation-controller.js';

test('identical shield states have identical presentation regardless of roster position', () => {
  const ships = [0, 1, 2, 3].map((id) => ({
    id,
    alive: true,
    shield: 100,
    shieldNow: 75,
    hitTime: 9,
  }));
  const states = [];
  const models = ships.map((s) => ({
    shield: { mesh: {}, update: (state) => (states[s.id] = state) },
  }));
  const c = new BattlePresentationController({
    simulation: { ships, time: 10 },
    models,
    effects: { update() {} },
    audio: {},
    pilots: [],
  });
  c.update(1 / 30);
  for (const state of states) assert.deepEqual(state, states[0]);
  ships[0].shieldNow = 25;
  c.update(1 / 30);
  assert.ok(states[0].strength < states[3].strength);
  ships[3].shieldNow = 25;
  c.update(1 / 30);
  assert.deepEqual(states[0], states[3]);
});
