// Pure transform math, shared by model and presentation. Three.js uses +Y up / -Z forward.
const zero = { x: 0, y: 0, z: 0 },
  identity = { x: 0, y: 0, z: 0, w: 1 };
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export function unit(v) {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return mul(v, 1 / l);
}
export function quaternion(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}
export function rotate(v, q) {
  const tx = 2 * (q.y * v.z - q.z * v.y),
    ty = 2 * (q.z * v.x - q.x * v.z),
    tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + q.y * tz - q.z * ty,
    y: v.y + q.w * ty + q.z * tx - q.x * tz,
    z: v.z + q.w * tz + q.x * ty - q.y * tx,
  };
}
const inverse = (q) => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export const yawQ = (a) => ({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) });
const pitchQ = (a) => ({ x: Math.sin(a / 2), y: 0, z: 0, w: Math.cos(a / 2) });
export function hullQuaternion(ship) {
  return (
    ship.quaternion ??
    quaternion(yawQ(-ship.angle), {
      x: 0,
      y: 0,
      z: Math.sin((-(ship.bank ?? 0) * 0.065) / 2),
      w: Math.cos((-(ship.bank ?? 0) * 0.065) / 2),
    })
  );
}
export function solveMountPose(ship, target, mount) {
  const scale = mount.displayScale ?? 1,
    hull = hullQuaternion(ship),
    rotation = quaternion(hull, mount.quaternion ?? identity);
  const base = add(
    { x: ship.x, y: ship.y ?? 0, z: ship.z },
    rotate(mul(mount.position, scale), hull),
  );
  const yawOrigin = mount.yawOrigin ?? zero,
    pitchOrigin = mount.pitchOrigin ?? zero;
  const localTarget = mul(rotate(sub(target, base), inverse(rotation)), 1 / scale);
  const aim = sub(localTarget, yawOrigin);
  const yaw = Math.atan2(-aim.x, -aim.z),
    yawRotation = yawQ(yaw);
  const pitchedTarget = sub(rotate(aim, inverse(yawRotation)), sub(pitchOrigin, yawOrigin));
  const pitch =
    mount.elevation === false
      ? 0
      : Math.max(
          mount.minElevation ?? -0.14,
          Math.min(
            mount.maxElevation ?? 0.7,
            Math.atan2(pitchedTarget.y, Math.hypot(pitchedTarget.x, pitchedTarget.z)),
          ),
        );
  const pitchRotation = pitchQ(pitch),
    barrelRotation = quaternion(rotation, quaternion(yawRotation, pitchRotation));
  const muzzles = mount.muzzles.map((m, index) => {
    const p = m.position ?? m;
    const local = add(
      yawOrigin,
      rotate(
        add(sub(pitchOrigin, yawOrigin), rotate(sub(p, pitchOrigin), pitchRotation)),
        yawRotation,
      ),
    );
    return {
      id: m.id ?? 'MUZZLE_' + String(index + 1).padStart(2, '0'),
      index,
      position: add(base, rotate(mul(local, scale), rotation)),
      direction: unit(rotate(m.direction ?? { x: 0, y: 0, z: -1 }, barrelRotation)),
    };
  });
  return { yaw, pitch, muzzles };
}
