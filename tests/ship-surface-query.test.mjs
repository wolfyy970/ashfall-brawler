import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import { createShipSurfaceQuery } from '../runtime/views/ship-surface-query.js';
import { HullImpactView } from '../runtime/views/hull-impact-view.js';

test('surface query uses current pose for a rotated, nonuniformly scaled hull', () => {
  const root = new T.Group();
  root.scale.set(2, 1, 0.5);
  const hull = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial());
  root.add(hull);
  const pose = { x: 10, y: 0, z: 0, angle: Math.PI / 2, bank: 0, alive: true };
  const surface = createShipSurfaceQuery({ root, hullRoot: hull, getPose: () => pose });
  const hit = surface.intersectSegment({ x: 8, y: 0, z: 0 }, { x: 12, y: 0, z: 0 });
  assert.ok(hit);
  assert.ok(Math.abs(hit.point.x - 9.75) < 1e-6);
  assert.ok(hit.normal.x < -0.999);
  assert.ok(Math.abs(hit.t - 0.4375) < 1e-6);
});

test('bounded hull marks follow simulation pose and disappear with their ship', () => {
  const view = new HullImpactView(new T.Scene(), 32);
  const staleRoot = new T.Group();
  const pose = { x: 10, y: 0, z: 0, angle: 0, bank: 0, alive: true };
  view.registerHull(7, staleRoot, () => pose);
  const impact = {
    ship: 7,
    shield: false,
    damage: 1,
    point: { x: 10, y: 0, z: 0 },
    normal: { x: 1, y: 0, z: 0 },
    response: { flashScale: 1, duration: 2, power: 1 },
    receiving: { damageMix: { em: 0, thermal: 0, kinetic: 1, explosive: 0 } },
  };
  for (let i = 0; i < 40; i++) view.impact({ ...impact, t: i * 0.001 });
  assert.equal(view.cursor, 40);
  assert.equal(view.anchors.length, 32);
  const matrix = new T.Matrix4();
  view.mesh.getMatrixAt(7, matrix);
  const before = new T.Vector3().setFromMatrixPosition(matrix);
  pose.x = 12;
  view.update(0.1);
  view.mesh.getMatrixAt(7, matrix);
  const after = new T.Vector3().setFromMatrixPosition(matrix);
  assert.ok(Math.abs(after.x - before.x - 2) < 1e-6);
  pose.alive = false;
  view.update(0.11);
  view.mesh.getMatrixAt(7, matrix);
  assert.equal(matrix.determinant(), 0);
  view.dispose();
});
