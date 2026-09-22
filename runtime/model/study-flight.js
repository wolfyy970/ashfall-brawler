const FRAME = Object.freeze({ x: 23, z: 16 });
const CLEARANCE = 18;

const ROUTES = Object.freeze([
  Object.freeze([
    [-19, -14],
    [-10, -13],
    [-7, -8],
    [-14, -4],
    [-22, -8],
  ]),
  Object.freeze([
    [-13, 7],
    [-6, 2],
    [-4, 13],
    [-17, 15],
    [-22, 6],
  ]),
  Object.freeze([
    [18, -12],
    [23, -6],
    [17, -4],
    [8, -7],
    [7, -14],
  ]),
  Object.freeze([
    [19, 11],
    [12, 15],
    [7, 10],
    [10, 5],
    [20, 4],
    [23, 9],
  ]),
]);
const OPENING_LEGS = Object.freeze([1, 1, 3, 3]);

const unit2 = (x, z) => {
  const length = Math.hypot(x, z) || 1;
  return { x: x / length, z: z / length };
};

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const idHash = (id) => {
  let hash = 2166136261;
  for (const character of String(id)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
};

const routeFor = (ship, index) => {
  const source = ROUTES[index % ROUTES.length];
  const group = Math.floor(index / ROUTES.length);
  if (!group) return source.map(([x, z]) => Object.freeze({ x, z }));
  const hash = idHash(ship.id);
  const scale = Math.max(0.58, 0.9 - group * 0.09);
  const dx = ((hash & 7) - 3.5) * 0.45;
  const dz = (((hash >>> 3) & 7) - 3.5) * 0.32;
  return source.map(([x, z]) =>
    Object.freeze({
      x: clamp(x * scale + dx, -FRAME.x, FRAME.x),
      z: clamp(z * scale + dz, -FRAME.z, FRAME.z),
    }),
  );
};

/** Stores deterministic, independent patrol assignments for the replaceable demonstration pilot. */
export function beginStudyFlight(ships) {
  const active = ships.filter((ship) => ship.alive);
  const routes = new Map();
  const legs = new Map();
  active.forEach((ship, index) => {
    const route = routeFor(ship, index);
    routes.set(ship.id, Object.freeze(route));
    legs.set(ship.id, route.length > 1 ? OPENING_LEGS[index % OPENING_LEGS.length] : 0);
  });
  return Object.freeze({ elapsed: 0, routes, legs });
}

/** Demo-only pilot policy. It requests velocity and never writes a ship pose. */
export function studyFlightCommands(plan, ships, dt = 0) {
  const active = ships.filter((ship) => ship.alive);
  const commands = new Map();
  const nextLegs = new Map(plan.legs);
  for (const ship of active) {
    const route = plan.routes.get(ship.id);
    if (!route?.length) {
      commands.set(ship.id, Object.freeze({ velocity: Object.freeze({ x: 0, y: 0, z: 0 }) }));
      continue;
    }
    let leg = nextLegs.get(ship.id) ?? 0;
    let goal = route[leg % route.length];
    let dx = goal.x - ship.x;
    let dz = goal.z - ship.z;
    let distance = Math.hypot(dx, dz);
    if (distance < 3.6) {
      leg = (leg + 1) % route.length;
      nextLegs.set(ship.id, leg);
      goal = route[leg];
      dx = goal.x - ship.x;
      dz = goal.z - ship.z;
      distance = Math.hypot(dx, dz);
    }
    const direction = unit2(dx, dz);
    const nextGoal = route[(leg + 1) % route.length];
    const nextDirection = unit2(nextGoal.x - goal.x, nextGoal.z - goal.z);
    const cornerBlend = clamp((10 - distance) / 10, 0, 0.55);
    let vx = direction.x * (1 - cornerBlend) + nextDirection.x * cornerBlend;
    let vz = direction.z * (1 - cornerBlend) + nextDirection.z * cornerBlend;
    for (const other of active) {
      if (other === ship) continue;
      const rx = ship.x - other.x;
      const rz = ship.z - other.z;
      const rvx = (ship.vx ?? 0) - (other.vx ?? 0);
      const rvz = (ship.vz ?? 0) - (other.vz ?? 0);
      const relativeSpeed2 = rvx * rvx + rvz * rvz;
      const approachTime =
        relativeSpeed2 > 0.01 ? clamp(-(rx * rvx + rz * rvz) / relativeSpeed2, 0, 6) : 0;
      const closestX = rx + rvx * approachTime;
      const closestZ = rz + rvz * approachTime;
      const closest = Math.hypot(closestX, closestZ);
      if (closest < CLEARANCE) {
        const away = unit2(closestX || rx, closestZ || rz);
        const urgency = (1 - closest / CLEARANCE) * (approachTime > 0 ? 1.35 : 0.8);
        vx += away.x * urgency;
        vz += away.z * urgency;
      }
    }
    const futureX = ship.x + (ship.vx ?? 0) * 4;
    const futureZ = ship.z + (ship.vz ?? 0) * 4;
    if (Math.abs(futureX) > FRAME.x - 2) vx += -Math.sign(futureX) * 1.6;
    if (Math.abs(futureZ) > FRAME.z - 2) vz += -Math.sign(futureZ) * 1.8;
    const desired = unit2(vx, vz);
    const speed = clamp(
      distance * 0.34,
      1.15,
      (ship.hullType ?? ship.hull) === 'brawler' ? 1.55 : 2.3,
    );
    commands.set(
      ship.id,
      Object.freeze({
        velocity: Object.freeze({ x: desired.x * speed, y: 0, z: desired.z * speed }),
      }),
    );
  }
  return Object.freeze({
    plan: Object.freeze({ ...plan, elapsed: plan.elapsed + dt, legs: nextLegs }),
    commands,
  });
}
