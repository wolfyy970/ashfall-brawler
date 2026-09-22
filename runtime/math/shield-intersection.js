const EPSILON = 1e-9;

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function addScaled(a, b, t) {
  return { x: a.x + b.x * t, y: a.y + b.y * t, z: a.z + b.z * t };
}

function normalize(v) {
  const length = Math.hypot(v.x, v.y, v.z);
  return length > EPSILON
    ? { x: v.x / length, y: v.y / length, z: v.z / length }
    : { x: 0, y: 0, z: 0 };
}

function rotateByQuaternion(v, q) {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  };
}

function inverseRotate(v, q) {
  return rotateByQuaternion(v, { x: -q.x, y: -q.y, z: -q.z, w: q.w });
}

/**
 * Finds the first surface crossing of a finite world-space segment and an ellipsoid.
 * Inputs and outputs are plain {x,y,z} DTOs; no renderer types are required.
 * Rotation is an optional normalized world-space quaternion.
 */
export function intersectSegmentEllipsoid(start, end, ellipsoid) {
  const center = ellipsoid.center ?? { x: 0, y: 0, z: 0 };
  const radii = ellipsoid.radii;
  if (!radii || radii.x <= 0 || radii.y <= 0 || radii.z <= 0) {
    throw new RangeError('Ellipsoid radii must be positive.');
  }

  const rotation = ellipsoid.rotation ?? { x: 0, y: 0, z: 0, w: 1 };
  const localStart = inverseRotate(subtract(start, center), rotation);
  const localEnd = inverseRotate(subtract(end, center), rotation);
  const delta = subtract(localEnd, localStart);
  const scaledStart = {
    x: localStart.x / radii.x,
    y: localStart.y / radii.y,
    z: localStart.z / radii.z,
  };
  const scaledDelta = {
    x: delta.x / radii.x,
    y: delta.y / radii.y,
    z: delta.z / radii.z,
  };
  const a = scaledDelta.x ** 2 + scaledDelta.y ** 2 + scaledDelta.z ** 2;
  if (a <= EPSILON) return null;
  const b = 2 * (scaledStart.x * scaledDelta.x + scaledStart.y * scaledDelta.y + scaledStart.z * scaledDelta.z);
  const c = scaledStart.x ** 2 + scaledStart.y ** 2 + scaledStart.z ** 2 - 1;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;

  const root = Math.sqrt(Math.max(0, discriminant));
  const roots = [(-b - root) / (2 * a), (-b + root) / (2 * a)]
    .filter((t) => t >= -EPSILON && t <= 1 + EPSILON)
    .sort((left, right) => left - right);
  if (!roots.length) return null;

  const t = Math.max(0, Math.min(1, roots[0]));
  const localPoint = addScaled(localStart, delta, t);
  const localUnitDirection = normalize({
    x: localPoint.x / radii.x,
    y: localPoint.y / radii.y,
    z: localPoint.z / radii.z,
  });
  const localNormal = normalize({
    x: localPoint.x / (radii.x * radii.x),
    y: localPoint.y / (radii.y * radii.y),
    z: localPoint.z / (radii.z * radii.z),
  });
  const worldOffset = rotateByQuaternion(localPoint, rotation);
  const worldNormal = normalize(rotateByQuaternion(localNormal, rotation));

  return {
    t,
    point: { x: center.x + worldOffset.x, y: center.y + worldOffset.y, z: center.z + worldOffset.z },
    normal: worldNormal,
    localPoint,
    localUnitDirection,
  };
}
