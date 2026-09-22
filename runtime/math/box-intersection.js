/** First crossing of a finite segment and an axis-aligned solid inspection target. */
export function intersectSegmentBox(start, end, { center, halfSize }) {
  let enter = -Infinity,
    leave = Infinity,
    enterNormal,
    leaveNormal;
  for (const axis of ['x', 'y', 'z']) {
    const direction = end[axis] - start[axis];
    const local = start[axis] - center[axis];
    const half = halfSize[axis];
    if (!Number.isFinite(half) || half <= 0) throw new RangeError('Invalid box half size');
    if (Math.abs(direction) < 1e-9) {
      if (Math.abs(local) > half) return null;
      continue;
    }
    let a = (-half - local) / direction,
      b = (half - local) / direction;
    const n = { x: 0, y: 0, z: 0 };
    n[axis] = direction > 0 ? -1 : 1;
    if (a > b) [a, b] = [b, a];
    if (a > enter) {
      enter = a;
      enterNormal = n;
    }
    if (b < leave) {
      leave = b;
      leaveNormal = { x: -n.x, y: -n.y, z: -n.z };
    }
    if (enter > leave) return null;
  }
  const t = enter >= 0 ? enter : leave;
  if (!Number.isFinite(t) || t < 0 || t > 1) return null;
  return {
    t,
    point: {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
      z: start.z + (end.z - start.z) * t,
    },
    normal: enter >= 0 ? enterNormal : leaveNormal,
  };
}
