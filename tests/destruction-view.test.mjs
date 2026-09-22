import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import { DestructionView } from '../runtime/views/destruction-view.js';

const event = (overrides = {}) => ({
  ship: 1,
  t: 2,
  point: { x: 4, y: -1, z: 7 },
  velocity: { x: 0.3, y: 0, z: -0.1 },
  forward: { x: 0, y: 0, z: -1 },
  radius: 2,
  length: 8,
  seed: 42,
  damageMix: { em: 0.2, thermal: 0.3, kinetic: 0.2, explosive: 0.3 },
  ...overrides,
});

function assertFiniteMatrices(view) {
  for (const mesh of [view.cards, view.arcs, view.debris])
    for (const value of mesh.instanceMatrix.array) assert.ok(Number.isFinite(value));
}

test('destruction effects reuse three bounded pools and replace the oldest slot', () => {
  const scene = new T.Scene();
  const view = new DestructionView(scene);
  assert.equal(scene.children.length, 3);
  assert.equal(view.stats.draws, 0);
  assertFiniteMatrices(view);
  for (let i = 0; i < 9; i++) view.explode(event({ seed: i + 1, t: 2 }));
  assert.deepEqual(view.stats, { active: 4, capacity: 4, draws: 3, cards: 52, debris: 28 });
  assert.equal(scene.children.length, 3);
  view.clear();
  assert.equal(view.stats.active, 0);
  assert.equal(view.stats.draws, 0);
  assertFiniteMatrices(view);
  view.dispose();
  assert.equal(scene.children.length, 0);
});

test('hull radius and length drive visible scale and axial placement', () => {
  const scene = new T.Scene();
  const view = new DestructionView(scene);
  view.explode(event({ radius: 0.5, length: 2, seed: 91 }));
  view.update(2.2);
  const smallScale = new T.Vector3();
  new T.Matrix4()
    .fromArray(view.cards.instanceMatrix.array, 0)
    .decompose(new T.Vector3(), new T.Quaternion(), smallScale);
  const smallAxial = Math.abs(view.slots[0].cards[6].offset.z);
  view.clear();
  view.explode(event({ radius: 4, length: 18, seed: 91 }));
  view.update(2.2);
  const largeScale = new T.Vector3();
  new T.Matrix4()
    .fromArray(view.cards.instanceMatrix.array, 0)
    .decompose(new T.Vector3(), new T.Quaternion(), largeScale);
  const largeAxial = Math.abs(view.slots[0].cards[6].offset.z);
  assert.ok(largeScale.x > smallScale.x * 5);
  assert.ok(largeAxial > smallAxial * 5);
  view.dispose();
});

test('absolute-time sequence hides pre-roll, flashes briefly, then retires cleanly', () => {
  const view = new DestructionView(new T.Scene());
  view.explode(event({ t: 10 }));
  const alpha = view.cards.geometry.getAttribute('instanceAlpha');
  view.update(9.9);
  assert.equal(alpha.getX(0), 0);
  view.update(10.04);
  assert.ok(alpha.getX(0) > 0.5);
  view.update(12.5);
  assert.equal(view.stats.active, 0);
  assert.equal(view.stats.draws, 0);
  for (let i = 0; i < alpha.count; i++) assert.equal(alpha.getX(i), 0);
  assertFiniteMatrices(view);
  view.clear();
  assert.equal(view.explode(event({ t: 0, seed: 77 })), 0);
  view.update(0.1);
  assert.equal(view.stats.active, 1);
  assert.equal(view.stats.draws, 3);
  assertFiniteMatrices(view);
  view.dispose();
});

test('plasma pockets remain compact and use varied seeded boundaries', () => {
  const view = new DestructionView(new T.Scene());
  view.explode(event({ radius: 3, length: 12, seed: 123 }));
  view.update(2.35);
  const scale = new T.Vector3();
  for (let i = 0; i < 13; i++) {
    new T.Matrix4()
      .fromArray(view.cards.instanceMatrix.array, i * 16)
      .decompose(new T.Vector3(), new T.Quaternion(), scale);
    assert.ok(Math.max(scale.x, scale.y) < 5, `card ${i} exceeded compact hull-relative scale`);
  }
  const seeds = view.cards.geometry.getAttribute('instanceSeed');
  assert.ok(new Set(Array.from({ length: 13 }, (_, i) => seeds.getX(i))).size > 10);
  assert.match(view.arcs.material.fragmentShader, /step\(0\.72,/);
  assert.equal(view.cards.geometry.getAttribute('instanceVapor').getX(7), 0);
  assert.equal(view.cards.geometry.getAttribute('instanceVapor').getX(8), 1);
  assert.ok(view.cards.geometry.getAttribute('instancePhase').getX(0) > 0);
  assert.match(view.cards.material.fragmentShader, /n1 \* 0\.57 \+ n2 \* 0\.29 \+ n3 \* 0\.14/);
  assert.match(view.cards.material.fragmentShader, /ridge/);
  view.dispose();
});
