import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mathSource = await readFile(new URL('../runtime/math/shield-intersection.js', import.meta.url), 'utf8');
const { intersectSegmentEllipsoid } = await import(`data:text/javascript,${encodeURIComponent(mathSource)}`);

const close = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test('returns the first segment entry, not a center-to-source approximation', () => {
  const hit = intersectSegmentEllipsoid(
    { x: -10, y: 2, z: 0 },
    { x: 10, y: 2, z: 0 },
    { center: { x: 0, y: 0, z: 0 }, radii: { x: 5, y: 3, z: 2 } },
  );
  close(hit.point.x, -Math.sqrt(125 / 9));
  close(hit.point.y, 2);
  assert.ok(hit.t > 0 && hit.t < 0.5);
});

test('rejects a finite segment that does not reach the ellipsoid', () => {
  assert.equal(intersectSegmentEllipsoid(
    { x: -10, y: 0, z: 0 },
    { x: -6, y: 0, z: 0 },
    { radii: { x: 5, y: 3, z: 2 } },
  ), null);
});

test('supports translated and rotated ellipsoids', () => {
  const halfTurnY = { x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) };
  const hit = intersectSegmentEllipsoid(
    { x: 2, y: 0, z: -10 },
    { x: 2, y: 0, z: 10 },
    { center: { x: 2, y: 0, z: 1 }, radii: { x: 5, y: 3, z: 2 }, rotation: halfTurnY },
  );
  close(hit.point.z, -4);
  close(Math.hypot(hit.normal.x, hit.normal.y, hit.normal.z), 1);
});

test('independent crossing queries preserve simultaneous impacts', () => {
  const shield = { radii: { x: 5, y: 3, z: 2 } };
  const left = intersectSegmentEllipsoid({ x: -8, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, shield);
  const top = intersectSegmentEllipsoid({ x: 0, y: 7, z: 0 }, { x: 0, y: 0, z: 0 }, shield);
  assert.deepEqual([left.localUnitDirection.x, top.localUnitDirection.y], [-1, 1]);
});

test('eight impact slots coexist before deterministic ring overwrite', async () => {
  let source = await readFile(new URL('../runtime/views/shield-view.js', import.meta.url), 'utf8');
  source = source.replace("import * as T from '../../vendor/three.module.js';", 'const T = {};');
  const { ImpactSlotRing } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
  const ring = new ImpactSlotRing(8);
  assert.deepEqual(Array.from({ length: 10 }, () => ring.take()), [0, 1, 2, 3, 4, 5, 6, 7, 0, 1]);
});
