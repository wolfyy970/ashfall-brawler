import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.js';
import { VisualStudy } from '../tableau.js';
import { createShipSurfaceQuery } from '../runtime/views/ship-surface-query.js';
import { hullQuaternion, rotate } from '../runtime/math/mount-pose.js';
import { weaponProfile } from '../runtime/model/weapon-profiles.js';

test('flight exposes different local hull faces through the same impact resolver', () => {
  const study = new VisualStudy();
  study.reset({ exposedHull: true });
  study.setFlightEnabled(true);
  const geometry = new T.BoxGeometry(3, 1, 7);
  const material = new T.MeshBasicMaterial();
  const faces = study.ships.map(() => new Set());
  const profile = weaponProfile('pulse', {
    damage: { em: 0.01, thermal: 0, kinetic: 0, explosive: 0 },
  });
  for (const ship of study.ships) {
    ship.cooldowns.fill(1000);
    const root = new T.Group();
    const hull = new T.Mesh(geometry, material);
    root.add(hull);
    study.configureHullSurface(
      ship.id,
      createShipSurfaceQuery({ root, hullRoot: hull, getPose: () => ship }),
    );
  }
  for (let tick = 0; tick < 12 * 60; tick++) {
    study.step(1 / 60);
    if (tick % 30 !== 0) continue;
    for (const attacker of study.ships) {
      const target = study.ships[attacker.target];
      study.resolveImpacts({
        projectileId: 1000 + tick * 4 + attacker.id,
        kind: 'pulse',
        owner: attacker.id,
        target,
        start: { x: attacker.x, y: target.y, z: attacker.z },
        end: { x: target.x, y: target.y, z: target.z },
        profile,
        incomingVelocity: { x: 0, y: 0, z: 0 },
        firedAt: study.time,
      });
    }
    for (const event of study.drain().filter((item) => item.type === 'impact')) {
      assert.equal(event.shield, false);
      const q = hullQuaternion(study.ships[event.ship]);
      const normal = rotate(event.normal, { x: -q.x, y: -q.y, z: -q.z, w: q.w });
      faces[event.ship].add(
        Math.abs(normal.x) > 0.9 ? (normal.x > 0 ? '+X' : '-X') : normal.z > 0 ? '+Z' : '-Z',
      );
    }
  }
  geometry.dispose();
  material.dispose();
  for (const [ship, hitFaces] of faces.entries())
    assert.ok(hitFaces.size >= 2, `ship ${ship} only received hits on ${[...hitFaces]}`);
});
