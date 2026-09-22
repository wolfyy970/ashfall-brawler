import { PILOTS } from './sim.js';
import { intersectSegmentEllipsoid } from './runtime/math/shield-intersection.js';
import { createImpactEvent } from './runtime/model/impact-event.js';
import { solveMountPose, hullQuaternion, rotate, unit, sub } from './runtime/math/mount-pose.js';
import { weaponProfile } from './runtime/model/weapon-profiles.js';
import { createProjectile, advanceProjectile } from './runtime/model/projectile-motion.js';
import { planSalvo } from './runtime/model/firing-pattern.js';
import { DEMO_DEFENSES } from './runtime/model/damage-response.js';
import { resolveDefenseSweep } from './runtime/model/defense-sweep.js';
import {
  createDestructionEvent,
  DEFAULT_DESTRUCTION_SHAPE,
} from './runtime/model/destruction-event.js';
import { beginStudyFlight, studyFlightCommands } from './runtime/model/study-flight.js';
import { stepShipMotion } from './runtime/model/ship-motion.js';

const POSES = [
  [-19, -14, 2.08],
  [-13, 7, 0.92],
  [18, -12, -2.14],
  [19, 11, -1.24],
];
const SCALE = [1, 1.5, 1, 1.18],
  RADII = { x: 5.2, y: 4.2, z: 5.9 };
const FLIGHT_MOTION = Object.freeze({
  interceptor: Object.freeze({
    maxSpeed: 2.4,
    acceleration: 0.65,
    turnRate: 0.42,
    angularAcceleration: 0.3,
  }),
  brawler: Object.freeze({
    maxSpeed: 1.6,
    acceleration: 0.4,
    turnRate: 0.28,
    angularAcceleration: 0.2,
  }),
});
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Demo engine adapter: owns choreography and projectile motion; never imports Three.js. */
export class VisualStudy {
  constructor() {
    this.mountConfigs = new Map();
    this.profileOverrides = new Map();
    this.hullSurfaces = new Map();
    this.destructionShapes = new Map();
    this.flightEnabled = false;
    this.flightPlan = null;
    this.reset();
  }
  reset({ exposedHull = false } = {}) {
    this.time = 0;
    this.events = [];
    this.shots = [];
    this.serial = 0;
    this.salvoSerial = 0;
    this.batterySerial = 0;
    this.pendingFire = [];
    this.totalKills = 0;
    this.totalShots = 0;
    this.endedAt = null;
    this.ships = PILOTS.map((p, i) => ({
      ...p,
      x: POSES[i][0],
      y: 0,
      z: POSES[i][1],
      vx: 0,
      vy: 0,
      vz: 0,
      angle: POSES[i][2],
      bank: 0,
      angularVelocity: 0,
      thrust: 0,
      shieldNow: exposedHull ? 0 : p.shield,
      hullType: p.hull,
      hull: p.armor,
      hullNow: p.armor,
      shieldResistances: DEMO_DEFENSES.shield,
      hullResistances: DEMO_DEFENSES.hull,
      cap: 100,
      target: [3, 2, 1, 0][i],
      cooldowns: p.weapons.map((kind) => 1.7 + i * 0.57 + p.weapons.indexOf(kind) * 0.3),
      barrelCounters: p.weapons.map(() => 0),
      webUntil: 0,
      hitTime: -20,
      alive: true,
      kills: 0,
      phase: i * 1.7,
      warp: 0,
    }));
    this.flightPlan = this.flightEnabled ? beginStudyFlight(this.ships) : null;
  }
  setFlightEnabled(enabled) {
    enabled = Boolean(enabled);
    if (enabled === this.flightEnabled) return;
    this.flightEnabled = enabled;
    if (enabled) this.flightPlan ??= beginStudyFlight(this.ships);
    if (!enabled)
      for (const ship of this.ships) {
        ship.vx = 0;
        ship.vy = 0;
        ship.vz = 0;
        ship.angularVelocity = 0;
        ship.thrust = 0;
      }
  }
  drain() {
    const result = this.events;
    this.events = [];
    return result;
  }
  emit(event) {
    const queued = event.t === undefined ? { ...event, t: this.time } : event;
    this.events.push(queued);
    return queued;
  }
  configureMounts(id, mounts) {
    mounts.forEach((m) => {
      if (!m.muzzles?.length) throw new Error('Weapon requires at least one physical muzzle');
    });
    this.mountConfigs.set(id, freeze(structuredClone(mounts)));
  }
  setHullSurface(id, surface) {
    const intersectSegment = typeof surface === 'function' ? surface : surface?.intersectSegment;
    if (typeof intersectSegment !== 'function')
      throw new TypeError('Hull surface requires an intersectSegment callback');
    this.hullSurfaces.set(id, (start, end) => intersectSegment.call(surface, start, end));
  }
  configureHullSurface(id, surface) {
    this.setHullSurface(id, surface);
  }
  configureDestruction(id, { radius, length }) {
    // This is only loaded asset geometry.  It carries no per-ship visual style.
    const shape = createDestructionEvent({
      ship: 0,
      owner: 0,
      t: 0,
      point: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
      radius,
      length,
      seed: 0,
    });
    this.destructionShapes.set(id, Object.freeze({ radius: shape.radius, length: shape.length }));
  }
  setWeaponProfile(kind, overrides) {
    // Validate now, and apply changes only to subsequent shots.
    weaponProfile(kind, overrides);
    this.profileOverrides.set(kind, structuredClone(overrides));
  }
  mountPose(ship, mountIndex) {
    const config = this.mountConfigs.get(ship.id)?.[mountIndex];
    if (!config) return null;
    const target = this.ships[ship.target];
    return solveMountPose(ship, { x: target.x, y: target.y, z: target.z }, config);
  }
  fireOrigin(ship, target, mountIndex, muzzleIndex) {
    const config = this.mountConfigs.get(ship.id)?.[mountIndex];
    if (!config) throw new Error('Missing configured muzzle for ship ' + ship.id);
    const pose = solveMountPose(ship, { x: target.x, y: target.y ?? 0, z: target.z }, config);
    return pose.muzzles[muzzleIndex % pose.muzzles.length].position;
  }
  shieldEllipsoid(ship) {
    const scale = this.mountConfigs.get(ship.id)?.[0]?.displayScale ?? SCALE[ship.id] ?? 1;
    return {
      center: { x: ship.x, y: ship.y, z: ship.z },
      radii: { x: RADII.x * scale, y: RADII.y * scale, z: RADII.z * scale },
      rotation: hullQuaternion(ship),
    };
  }
  shieldHit(start, end, target) {
    if (!target?.alive || target.shieldNow <= 0) return null;
    return intersectSegmentEllipsoid(start, end, this.shieldEllipsoid(target));
  }
  resolveImpacts({
    projectileId,
    kind,
    owner,
    target,
    start,
    end,
    profile,
    muzzleIndex,
    incomingVelocity,
    stepDuration = 0,
    passedShield = false,
    damagePayload = profile.damage,
    firedAt = this.time,
  }) {
    if (!target?.alive)
      return { contacts: [], terminal: false, passedShield, damage: damagePayload };
    const instantaneous = profile.mode === 'beam';
    const result = resolveDefenseSweep({
      start,
      end,
      damage: damagePayload,
      passedShield,
      shield: {
        capacity: target.shield,
        remaining: target.shieldNow,
        resistances: target.shieldResistances,
      },
      hull: {
        capacity: target.hull,
        remaining: target.hullNow,
        resistances: target.hullResistances,
      },
      intersectShield: (a, b) => intersectSegmentEllipsoid(a, b, this.shieldEllipsoid(target)),
      intersectHull: this.hullSurfaces.get(target.id),
    });
    target.shieldNow = result.shield.remaining;
    target.hullNow = result.hull.remaining;
    const incomingDir = unit(sub(end, start));
    for (const [index, contact] of result.contacts.entries()) {
      const shield = contact.layer === 'shield';
      const contactTime = instantaneous
        ? firedAt
        : this.time - stepDuration + contact.fraction * stepDuration;
      if (shield) target.hitTime = contactTime;
      this.emit({
        ...createImpactEvent({
          ship: target.id,
          owner,
          projectileId,
          kind,
          hit: contact.hit,
          incomingDir,
          incomingVelocity: instantaneous ? { x: 0, y: 0, z: 0 } : incomingVelocity,
          instantaneous,
          shield,
          receiving: contact.receiving,
          layerCapacity: shield ? target.shield : target.hull,
          weaponSize: profile.weaponSize,
          contactDuration: instantaneous ? profile.lifetime : 0,
        }),
        profile,
        muzzleIndex,
        t: contactTime,
        terminal: result.terminal && index === result.contacts.length - 1,
      });
    }
    if (target.hullNow <= 0 && target.alive) {
      target.alive = false;
      this.totalKills++;
      const attacker = this.ships[owner];
      if (attacker) attacker.kills++;
      const fatal =
        [...result.contacts].reverse().find((contact) => contact.layer === 'hull') ??
        result.contacts.at(-1);
      const fatalTime = instantaneous
        ? firedAt
        : this.time - stepDuration + (fatal?.fraction ?? 1) * stepDuration;
      const shape = this.destructionShapes.get(target.id) ?? DEFAULT_DESTRUCTION_SHAPE;
      this.emit(
        createDestructionEvent({
          ship: target.id,
          owner,
          t: fatalTime,
          point: { x: target.x, y: target.y ?? 0, z: target.z },
          velocity: { x: target.vx ?? 0, y: target.vy ?? 0, z: target.vz ?? 0 },
          forward: rotate({ x: 0, y: 0, z: -1 }, hullQuaternion(target)),
          radius: shape.radius,
          length: shape.length,
          seed: target.id * 1000003 + owner * 9176 + Math.round(fatalTime * 1000),
          damageMix: fatal?.receiving?.damageMix,
        }),
      );
      target.vx = 0;
      target.vy = 0;
      target.vz = 0;
    }
    return result;
  }
  fireMount(shipId, mountIndex, options = {}) {
    const ship = this.ships[shipId],
      target = this.ships[ship.target],
      pose = this.mountPose(ship, mountIndex);
    if (!pose) return [];
    const kind = ship.weapons[mountIndex],
      profile = weaponProfile(kind, this.profileOverrides.get(kind));
    const plan = planSalvo({
      pattern: profile.firing,
      muzzleCount: pose.muzzles.length,
      cursor: ship.barrelCounters[mountIndex],
    });
    ship.barrelCounters[mountIndex] = plan.nextCursor;
    const salvoID = 'salvo-' + ++this.salvoSerial,
      firedAt = options.t ?? this.time,
      immediate = [];
    for (const shot of plan.shots) {
      const order = {
        shipId,
        mountIndex,
        muzzleIndex: shot.muzzleIndex,
        salvoID,
        batteryID: options.batteryID,
        t: firedAt + shot.delay,
        kind,
        profile,
      };
      if (shot.delay === 0) immediate.push(this.emitShot(order));
      else this.pendingFire.push(order);
    }
    return immediate;
  }
  fireBattery(shipId, mountIndices = null) {
    const ship = this.ships[shipId];
    if (!ship) return [];
    const batteryID = 'battery-' + ++this.batterySerial,
      indices = mountIndices ?? ship.weapons.map((_, index) => index);
    return indices.flatMap((mountIndex) =>
      this.fireMount(shipId, mountIndex, { batteryID, t: this.time }),
    );
  }
  emitShot({ shipId, mountIndex, muzzleIndex, salvoID, batteryID, t, kind, profile }) {
    const ship = this.ships[shipId],
      target = this.ships[ship?.target];
    if (!ship?.alive || !target?.alive) return null;
    const pose = this.mountPose(ship, mountIndex);
    if (!pose) return null;
    const muzzle = pose.muzzles[muzzleIndex];
    const id = ++this.serial,
      start = { ...muzzle.position },
      direction = { ...muzzle.direction };
    const center = { x: target.x, y: target.y, z: target.z };
    // Beams continue on the actual bore axis. This accounts for offset parallel barrels.
    const distance = Math.hypot(center.x - start.x, center.y - start.y, center.z - start.z) + 15;
    const end = {
      x: start.x + direction.x * distance,
      y: start.y + direction.y * distance,
      z: start.z + direction.z * distance,
    };
    const hit =
      profile.mode === 'beam' && kind !== 'web'
        ? (this.shieldHit(start, end, target) ??
          this.hullSurfaces.get(target.id)?.(start, end) ??
          null)
        : null;
    const event = {
      type: 'fire',
      id,
      shotID: id,
      salvoID,
      batteryID,
      weapon: kind,
      ship: ship.id,
      target: target.id,
      mount: mountIndex,
      muzzleId: muzzle.id,
      muzzleIndex,
      origin: start,
      direction,
      profile,
      x: ship.x,
      y: ship.y,
      z: ship.z,
      tx: target.x,
      ty: target.y,
      tz: target.z,
      aimPoint: kind === 'web' ? center : (hit?.point ?? end),
      t,
    };
    const queuedFire = this.emit(event);
    this.totalShots++;
    if (kind === 'web') {
      event.aimPoint = center;
      target.webUntil = this.time + 2.5;
      this.emit({ type: 'webbed', ship: target.id, owner: ship.id });
    } else if (profile.mode === 'beam') {
      const result = this.resolveImpacts({
        projectileId: id,
        kind,
        owner: ship.id,
        target,
        start,
        end,
        profile,
        muzzleIndex,
        incomingVelocity: { x: 0, y: 0, z: 0 },
        firedAt: t,
      });
      const terminal = result.contacts.at(-1);
      if (terminal) event.aimPoint = queuedFire.aimPoint = terminal.hit.point;
    } else {
      const projectile = createProjectile(event);
      projectile.shotID = id;
      projectile.salvoID = salvoID;
      projectile.batteryID = batteryID;
      this.shots.push(projectile);
    }
    return event;
  }
  step(dt) {
    if (!Number.isFinite(dt) || dt < 0)
      throw new TypeError('Study delta must be finite and non-negative');
    this.time += dt;
    const t = this.time;
    let flightCommands = new Map();
    if (this.flightEnabled) {
      const flight = studyFlightCommands(this.flightPlan, this.ships, dt);
      this.flightPlan = flight.plan;
      flightCommands = flight.commands;
    }
    for (const s of this.ships) {
      const command = flightCommands.get(s.id);
      if (command)
        Object.assign(
          s,
          stepShipMotion(s, command, dt, FLIGHT_MOTION[s.hullType] ?? FLIGHT_MOTION.interceptor),
        );
      else {
        s.vx = 0;
        s.vy = 0;
        s.vz = 0;
        s.angularVelocity = 0;
        s.thrust = 0;
      }
      s.cap = 100;
      if (s.alive) {
        const opponents = this.ships.filter(
          (candidate) => candidate.alive && candidate.id < 2 !== s.id < 2,
        );
        if (!this.ships[s.target]?.alive || this.ships[s.target].id < 2 === s.id < 2)
          s.target = opponents[0]?.id ?? s.target;
      }
    }
    const due = this.pendingFire
      .filter((order) => order.t <= t && this.ships[order.shipId]?.alive)
      .sort((a, b) => a.t - b.t);
    this.pendingFire = this.pendingFire.filter((order) => order.t > t);
    for (const order of due) this.emitShot(order);
    for (const ship of this.ships) {
      if (!ship.alive) continue;
      for (let i = 0; i < ship.cooldowns.length; i++) ship.cooldowns[i] -= dt;
      for (const kind of new Set(ship.weapons)) {
        const indices = ship.weapons
          .map((weapon, index) => (weapon === kind ? index : -1))
          .filter((i) => i >= 0);
        if (ship.cooldowns[indices[0]] > 0) continue;
        const interval = weaponProfile(kind, this.profileOverrides.get(kind)).interval;
        for (const index of indices) ship.cooldowns[index] = interval;
        this.fireBattery(ship.id, indices);
      }
    }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const p = this.shots[i];
      if (p.bornAt === t) continue;
      // Legacy fixture/engine snapshots may omit the optional visual profile.
      p.profile ??= weaponProfile(p.kind);
      p.vy ??= 0;
      p.y ??= 0.5;
      const target = this.ships[p.target],
        stepDuration = Math.min(dt, Math.max(0, t - (p.bornAt ?? t - dt))),
        segment = advanceProjectile(p, target?.alive ? target : null, stepDuration);
      const result = this.resolveImpacts({
        projectileId: p.id,
        kind: p.kind,
        owner: p.owner,
        target,
        ...segment,
        profile: p.profile,
        muzzleIndex: p.muzzleIndex,
        incomingVelocity: { x: p.vx, y: p.vy, z: p.vz },
        stepDuration,
        passedShield: p.passedShield,
        damagePayload: p.damagePayload ?? p.profile.damage,
      });
      p.passedShield = result.passedShield;
      p.damagePayload = result.damage;
      if (result.terminal || p.life <= 0) {
        const hit = result.contacts.at(-1)?.hit;
        const point = hit?.point ?? segment.end;
        const contactTime = result.terminal
          ? this.time - stepDuration + result.contacts.at(-1).fraction * stepDuration
          : this.time;
        this.emit({
          type: 'projectile-end',
          id: p.id,
          kind: p.kind,
          point,
          x: point.x,
          y: point.y,
          z: point.z,
          hit: result.terminal,
          reason: result.terminal ? 'impact' : 'expired',
          profile: p.profile,
          t: contactTime,
        });
        this.shots.splice(i, 1);
      }
    }
    const teamAlive = [
      this.ships.some((ship) => ship.id < 2 && ship.alive),
      this.ships.some((ship) => ship.id >= 2 && ship.alive),
    ];
    if (this.endedAt === null && teamAlive.includes(false)) this.endedAt = this.time;
  }
}
