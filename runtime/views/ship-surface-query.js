import * as T from '../../vendor/three.module.js';

const HIDDEN_HULL_PART = /human|crew|mannequin/i;

function visibleHullMesh(object, root) {
  for (let node = object; node && node !== root; node = node.parent) {
    if (!node.visible || node.name.startsWith('CAP_') || HIDDEN_HULL_PART.test(node.name))
      return false;
  }
  return object.isMesh && object.geometry;
}

function dto(v) {
  return { x: v.x, y: v.y, z: v.z };
}

export function setShipRootMatrixFromPose(matrix, pose, fallbackScale) {
  const position = pose?.position ?? pose;
  const scale = pose?.scale ?? fallbackScale;
  const sx = typeof scale === 'number' ? scale : (scale?.x ?? 1);
  const sy = typeof scale === 'number' ? scale : (scale?.y ?? 1);
  const sz = typeof scale === 'number' ? scale : (scale?.z ?? 1);
  const rotation = new T.Euler(
    pose?.rotation?.x ?? 0,
    pose?.rotation?.y ?? -(pose?.angle ?? 0),
    pose?.rotation?.z ?? -(pose?.bank ?? 0) * 0.065,
    pose?.rotation?.order ?? 'XYZ',
  );
  return matrix.compose(
    new T.Vector3(position?.x ?? 0, position?.y ?? 0, position?.z ?? 0),
    new T.Quaternion().setFromEuler(rotation),
    new T.Vector3(sx, sy, sz),
  );
}

/**
 * Creates a finite-segment query over a ship's visible hull geometry.
 * Geometry and local broadphase bounds are captured once. getPose, when supplied,
 * is called for every query so simulation pose wins over stale render matrices.
 */
export function createShipSurfaceQuery({ root, hullRoot = root, getPose } = {}) {
  if (!root || !hullRoot) throw new TypeError('A ship surface query requires a root and hullRoot.');
  root.updateMatrixWorld(true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const localBox = new T.Box3();
  const entries = [];
  hullRoot.traverse((object) => {
    if (!visibleHullMesh(object, hullRoot)) return;
    object.geometry.computeBoundingBox();
    object.geometry.computeBoundingSphere();
    const relativeMatrix = inverseRoot.clone().multiply(object.matrixWorld);
    const proxy = new T.Mesh(object.geometry, object.material);
    proxy.matrixAutoUpdate = false;
    entries.push({ proxy, relativeMatrix });
    localBox.union(object.geometry.boundingBox.clone().applyMatrix4(relativeMatrix));
  });
  if (!entries.length || localBox.isEmpty())
    throw new Error('Ship hull has no visible mesh geometry.');

  const localSphere = localBox.getBoundingSphere(new T.Sphere());
  const proxies = entries.map((entry) => entry.proxy);
  const rootMatrix = new T.Matrix4();
  const inverse = new T.Matrix4();
  const localStart = new T.Vector3();
  const localEnd = new T.Vector3();
  const direction = new T.Vector3();
  const closest = new T.Vector3();
  const boxPoint = new T.Vector3();
  const normal = new T.Vector3();
  const normalMatrix = new T.Matrix3();
  const raycaster = new T.Raycaster();
  const fallbackScale = root.scale.clone();

  function currentRootMatrix(pose) {
    if (pose || getPose)
      return setShipRootMatrixFromPose(rootMatrix, pose ?? getPose(), fallbackScale);
    root.updateWorldMatrix(true, false);
    return rootMatrix.copy(root.matrixWorld);
  }

  function intersectSegment(start, end, pose) {
    const matrix = currentRootMatrix(pose);
    inverse.copy(matrix).invert();
    localStart.set(start.x, start.y, start.z).applyMatrix4(inverse);
    localEnd.set(end.x, end.y, end.z).applyMatrix4(inverse);
    const localLength = localEnd.distanceTo(localStart);
    if (localLength <= 1e-9) return null;
    direction.subVectors(localEnd, localStart).multiplyScalar(1 / localLength);
    raycaster.set(localStart, direction);
    raycaster.near = 0;
    raycaster.far = localLength;
    const along = T.MathUtils.clamp(
      normal.subVectors(localSphere.center, localStart).dot(direction),
      0,
      localLength,
    );
    closest.copy(direction).multiplyScalar(along).add(localStart);
    if (closest.distanceToSquared(localSphere.center) > localSphere.radius ** 2) return null;
    if (
      !localBox.containsPoint(localStart) &&
      (!raycaster.ray.intersectBox(localBox, boxPoint) ||
        boxPoint.distanceTo(localStart) > localLength)
    )
      return null;

    for (const entry of entries) entry.proxy.matrixWorld.copy(entry.relativeMatrix);
    const hit = raycaster.intersectObjects(proxies, false)[0];
    if (!hit) return null;
    const worldPoint = hit.point.applyMatrix4(matrix);
    const worldStart = new T.Vector3(start.x, start.y, start.z);
    const worldEnd = new T.Vector3(end.x, end.y, end.z);
    const worldLength = worldEnd.distanceTo(worldStart);
    if (worldLength <= 1e-9) return null;
    if (hit.face) {
      normal
        .copy(hit.face.normal)
        .applyMatrix3(normalMatrix.getNormalMatrix(matrix.clone().multiply(hit.object.matrixWorld)))
        .normalize();
    } else {
      normal.subVectors(worldStart, worldEnd).normalize();
    }
    return {
      t: worldPoint.distanceTo(worldStart) / worldLength,
      point: dto(worldPoint),
      normal: dto(normal),
    };
  }

  return {
    intersectSegment,
    localBounds: {
      min: dto(localBox.min),
      max: dto(localBox.max),
      center: dto(localSphere.center),
      radius: localSphere.radius,
    },
  };
}
