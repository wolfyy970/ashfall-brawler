import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Load-time batching only. Functional parent nodes and muzzle transforms are untouched. */
export function mergeRigGeometry(root) {
  const groups = new Map();
  root.traverse((object) => {
    if (!object.isMesh || Array.isArray(object.material)) return;
    const key = object.parent.uuid + ':' + object.material.uuid;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(object);
  });
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const parent = meshes[0].parent,
      material = meshes[0].material;
    const pieces = meshes.map((mesh) => {
      mesh.updateMatrix();
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      return geometry.applyMatrix4(mesh.matrix);
    });
    const geometry = mergeGeometries(pieces, false);
    if (!geometry) throw new Error('Incompatible rig geometry in ' + parent.name);
    const merged = new T.Mesh(geometry, material);
    merged.name = parent.name + '_static';
    merged.castShadow = true;
    merged.receiveShadow = true;
    parent.add(merged);
    for (const mesh of meshes) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    for (const piece of pieces) piece.dispose();
  }
}
