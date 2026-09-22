import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { METRES_PER_WORLD_UNIT as M } from '../model/weapon-profiles.js';
import { createShipSurfaceQuery } from './ship-surface-query.js';

function dto(v) {
  return { x: v.x, y: v.y, z: v.z };
}

export async function createRangeShipTarget({ scene, center = { x: 2.8, y: 0.16, z: 0 } }) {
  const root = new T.Group();
  root.name = 'RangeShipTarget';
  scene.add(root);

  let disposed = false;
  try {
    const gltf = await new GLTFLoader().loadAsync('./assets/interceptor-rust.glb');
    if (disposed) return null;
    const model = gltf.scene;
    model.name = model.name || 'RangeInterceptor';
    model.scale.setScalar(1 / M);
    root.add(model);

    model.traverse((o) => {
      if (o.name.startsWith('CAP_') || /human|crew|mannequin/i.test(o.name)) o.visible = false;
      if (o.isMesh) {
        o.geometry.computeBoundingBox();
        o.geometry.computeBoundingSphere();
      }
    });
    root.updateMatrixWorld(true);

    const sourceBox = new T.Box3().setFromObject(root);
    const sourceSize = sourceBox.getSize(new T.Vector3());
    // The incoming range shot travels +X. Keep the hull's longest horizontal axis
    // along Z so the ray sees the broad flank rather than looking down its length.
    if (sourceSize.x > sourceSize.z) root.rotation.y = Math.PI / 2;
    root.updateMatrixWorld(true);

    // Preserve the fleet's metres-per-world-unit scale; the range camera frames it.
    root.updateMatrixWorld(true);

    const targetCenter = new T.Vector3(center.x, center.y, center.z);
    const alignedBox = new T.Box3().setFromObject(root);
    root.position.add(targetCenter.sub(alignedBox.getCenter(new T.Vector3())));
    root.updateMatrixWorld(true);

    const surface = createShipSurfaceQuery({ root, hullRoot: model });
    const worldBox = new T.Box3().setFromObject(root);
    const worldSphere = worldBox.getBoundingSphere(new T.Sphere());
    const { intersectSegment } = surface;

    // Probe the incoming flank itself. Offset samples avoid the interceptor's fork
    // and guarantee the public aim point lies on visible hull geometry.
    const c = worldBox.getCenter(new T.Vector3());
    const size = worldBox.getSize(new T.Vector3());
    const samples = [
      [0, 0],
      [0, 0.18],
      [0, -0.18],
      [0.12, 0],
      [-0.12, 0],
      [0.12, 0.22],
      [-0.12, 0.22],
      [0.12, -0.22],
      [-0.12, -0.22],
      [0, 0.34],
      [0, -0.34],
    ];
    let aimHit = null;
    for (const [yf, zf] of samples) {
      aimHit = intersectSegment(
        { x: worldBox.min.x - 0.25, y: c.y + size.y * yf, z: c.z + size.z * zf },
        { x: worldBox.max.x + 0.25, y: c.y + size.y * yf, z: c.z + size.z * zf },
      );
      if (aimHit) break;
    }
    if (!aimHit) throw new Error('Range interceptor has no reachable visible flank surface');

    const materials = new Set(),
      geometries = new Set(),
      textures = new Set();
    model.traverse((object) => {
      if (!object.isMesh) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    return {
      root,
      intersectSegment,
      bounds: {
        min: dto(worldBox.min),
        max: dto(worldBox.max),
        center: dto(worldSphere.center),
        radius: worldSphere.radius,
      },
      aimPoint: aimHit.point,
      dispose() {
        if (disposed) return;
        disposed = true;
        root.removeFromParent();
        for (const geometry of geometries) geometry.dispose();
        for (const material of materials) material.dispose();
        for (const texture of textures) texture.dispose();
        root.clear();
      },
    };
  } catch (error) {
    root.removeFromParent();
    throw error;
  }
}
