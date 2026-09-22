import { add, mul, unit } from '../math/mount-pose.js';
export function createProjectile(event) {
  const p = event.profile,
    dir = unit(event.direction),
    v = mul(dir, p.speed);
  if (Math.hypot(dir.x, dir.y, dir.z) < 0.99)
    throw new Error('Projectile launch direction must be nonzero');
  const ignitionAt =
    event.weapon === 'missile'
      ? Math.max(p.ignitionDelay, (p.length + (p.launch.clearance ?? 0)) / p.speed)
      : 0;
  return {
    id: event.id,
    kind: event.weapon,
    owner: event.ship,
    target: event.target,
    mount: event.mount,
    muzzleId: event.muzzleId,
    muzzleIndex: event.muzzleIndex,
    profile: p,
    origin: { ...event.origin },
    x: event.origin.x,
    y: event.origin.y,
    z: event.origin.z,
    vx: v.x,
    vy: v.y,
    vz: v.z,
    age: 0,
    life: p.lifetime,
    phase: event.weapon === 'missile' ? 'ejection' : 'flight',
    bornAt: event.t ?? 0,
    ignitionAt,
    guidanceAt: Math.max(p.guidanceDelay ?? 0, ignitionAt + 0.1),
  };
}
export function advanceProjectile(p, target, dt) {
  const start = { x: p.x, y: p.y, z: p.z };
  p.age += dt;
  p.life -= dt;
  const profile = p.profile;
  if (p.kind === 'missile') {
    const ignitionAt = p.ignitionAt ?? profile.ignitionDelay,
      guidanceAt = p.guidanceAt ?? profile.guidanceDelay;
    p.phase = p.age < ignitionAt ? 'ejection' : p.age < guidanceAt ? 'ignition' : 'flight';
    const speed = Math.min(
      profile.maxSpeed,
      profile.speed + Math.max(0, p.age - ignitionAt) * profile.acceleration,
    );
    let heading = unit({ x: p.vx, y: p.vy, z: p.vz });
    if (p.age >= guidanceAt && target) {
      const desired = unit({ x: target.x - p.x, y: (target.y ?? 0) - p.y, z: target.z - p.z });
      // Bounded angular turn; no instantaneous sideways launch or speed-changing lerp.
      const dot = Math.max(
        -1,
        Math.min(1, heading.x * desired.x + heading.y * desired.y + heading.z * desired.z),
      );
      const angle = Math.acos(dot),
        fraction = angle > 1e-6 ? Math.min(1, (profile.turnRate * dt) / angle) : 1;
      if (angle < Math.PI - 0.001 && angle > 0.001) {
        const sin = Math.sin(angle);
        heading = add(
          mul(heading, Math.sin((1 - fraction) * angle) / sin),
          mul(desired, Math.sin(fraction * angle) / sin),
        );
      } else if (dot < -0.99) {
        let perpendicular = unit({ x: -heading.z, y: 0, z: heading.x });
        if (Math.hypot(perpendicular.x, perpendicular.z) < 0.1)
          perpendicular = { x: 1, y: 0, z: 0 };
        heading = add(
          mul(heading, Math.cos(profile.turnRate * dt)),
          mul(perpendicular, Math.sin(profile.turnRate * dt)),
        );
      } else heading = desired;
    }
    heading = unit(heading);
    p.vx = heading.x * speed;
    p.vy = heading.y * speed;
    p.vz = heading.z * speed;
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.z += p.vz * dt;
  return { start, end: { x: p.x, y: p.y, z: p.z } };
}
