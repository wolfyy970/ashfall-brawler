import { solveMountPose, unit, sub } from '../math/mount-pose.js';
import { intersectSegmentEllipsoid } from '../math/shield-intersection.js';
import { weaponProfile } from './weapon-profiles.js';
import { createProjectile, advanceProjectile } from './projectile-motion.js';
import { createImpactEvent } from './impact-event.js';
import { planSalvo } from './firing-pattern.js';
import { DEMO_DEFENSES } from './damage-response.js';
import { resolveDefenseSweep } from './defense-sweep.js';

export const RANGE_DEFENSES = Object.freeze({
  shield: Object.freeze({
    layer: 'shield',
    capacity: 100,
    remaining: 100,
    resistances: DEMO_DEFENSES.shield,
  }),
  hardened: Object.freeze({
    layer: 'shield',
    capacity: 100,
    remaining: 100,
    resistances: Object.freeze({ ...DEMO_DEFENSES.shield, em: 0.8, thermal: 0.65 }),
  }),
  weak: Object.freeze({
    layer: 'shield',
    capacity: 100,
    remaining: 1,
    resistances: DEMO_DEFENSES.shield,
  }),
  hull: Object.freeze({
    layer: 'hull',
    capacity: 100,
    remaining: 100,
    resistances: DEMO_DEFENSES.hull,
  }),
});

/** A small engine adapter for inspecting one weapon. Uses the production pose/motion/event contracts. */
export class WeaponRangeModel {
  constructor() {
    this.mount = null;
    this.kind = 'missile';
    this.parameters = {};
    this.defense = RANGE_DEFENSES.shield;
    this.reset();
  }
  reset() {
    this.time = 0;
    this.shots = [];
    this.events = [];
    this.serial = 0;
    this.salvoSerial = 0;
    this.barrel = 0;
    this.pendingFire = [];
    this.hits = 0;
    this.shieldRemaining = this.defense.layer === 'shield' ? this.defense.remaining : 0;
    this.hullRemaining = 100;
    this.lastShieldHit = -Infinity;
    this.ship = { id: 0, x: -11, y: 0, z: 0, angle: Math.PI / 2, bank: 0 };
    this.target = { id: 1, x: 2.8, y: 0.16, z: 0 };
    this.ellipsoid = { center: this.target, radii: { x: 5.2, y: 4.2, z: 5.9 } };
  }
  configure(kind, mount) {
    this.kind = kind;
    this.mount = mount;
    this.parameters = {};
    this.reset();
  }
  setParameters(parameters) {
    weaponProfile(this.kind, parameters);
    this.parameters = { ...parameters };
  }
  setDefense(name) {
    if (!RANGE_DEFENSES[name]) throw new RangeError('Unknown target defense');
    this.defense = RANGE_DEFENSES[name];
    this.reset();
  }
  surfaceHit(start, end) {
    return this.shieldRemaining > 0
      ? intersectSegmentEllipsoid(start, end, this.ellipsoid)
      : (this.hullSurface?.(start, end) ?? null);
  }
  setHullSurface({ intersectSegment, aimPoint }) {
    this.hullSurface = intersectSegment;
    this.aimPoint = { ...aimPoint };
  }
  pose() {
    return this.mount ? solveMountPose(this.ship, this.aimPoint ?? this.target, this.mount) : null;
  }
  drain() {
    const events = this.events;
    this.events = [];
    return events;
  }
  impact(event, start, end, stepStart = this.time, stepDuration = 0) {
    const instantaneous = event.profile.mode === 'beam';
    const incomingDir = unit(sub(end, start));
    const incomingVelocity = instantaneous
      ? { x: 0, y: 0, z: 0 }
      : {
          x: event.vx ?? incomingDir.x * event.profile.speed,
          y: event.vy ?? incomingDir.y * event.profile.speed,
          z: event.vz ?? incomingDir.z * event.profile.speed,
        };
    const result = resolveDefenseSweep({
      start,
      end,
      damage: event.damagePayload ?? event.profile.damage,
      passedShield: event.passedShield,
      shield: {
        capacity: 100,
        remaining: this.shieldRemaining,
        resistances: this.defense.resistances,
      },
      hull: { capacity: 100, remaining: this.hullRemaining, resistances: DEMO_DEFENSES.hull },
      intersectShield: (a, b) => intersectSegmentEllipsoid(a, b, this.ellipsoid),
      intersectHull: this.hullSurface,
    });
    this.shieldRemaining = result.shield.remaining;
    this.hullRemaining = result.hull.remaining;
    for (const contact of result.contacts) {
      const shield = contact.layer === 'shield',
        time = instantaneous ? (event.t ?? this.time) : stepStart + contact.fraction * stepDuration;
      this.hits++;
      if (shield) this.lastShieldHit = time;
      this.events.push({
        ...createImpactEvent({
          ship: 1,
          owner: 0,
          projectileId: event.id,
          kind: event.weapon ?? event.kind,
          hit: contact.hit,
          incomingDir,
          incomingVelocity,
          instantaneous,
          shield,
          receiving: contact.receiving,
          layerCapacity: 100,
          weaponSize: event.profile.weaponSize,
          contactDuration: instantaneous ? event.profile.lifetime : 0,
        }),
        profile: event.profile,
        t: time,
      });
    }
    event.passedShield = result.passedShield;
    event.damagePayload = result.damage;
    const last = result.contacts.at(-1);
    return last ? { ...last.hit, t: last.fraction, terminal: result.terminal } : null;
  }
  fire() {
    const pose = this.pose();
    if (!pose) return [];
    const profile = weaponProfile(this.kind, this.parameters),
      plan = planSalvo({
        pattern: profile.firing,
        muzzleCount: pose.muzzles.length,
        cursor: this.barrel,
      }),
      salvoID = 'salvo-' + ++this.salvoSerial,
      events = [];
    this.barrel = plan.nextCursor;
    for (const shot of plan.shots) {
      const order = { muzzleIndex: shot.muzzleIndex, salvoID, t: this.time + shot.delay, profile };
      if (shot.delay === 0) events.push(this.emitShot(order));
      else this.pendingFire.push(order);
    }
    return events;
  }
  emitShot({ muzzleIndex, salvoID, t, profile }) {
    const pose = this.pose();
    if (!pose) return null;
    const m = pose.muzzles[muzzleIndex];
    const end = {
      x: m.position.x + m.direction.x * 40,
      y: m.position.y + m.direction.y * 40,
      z: m.position.z + m.direction.z * 40,
    };
    const event = {
      type: 'fire',
      id: ++this.serial,
      shotID: this.serial,
      salvoID,
      ship: 0,
      target: 1,
      mount: 0,
      weapon: this.kind,
      muzzleId: m.id,
      muzzleIndex,
      origin: { ...m.position },
      direction: { ...m.direction },
      profile,
      t,
    };
    const hit = profile.mode === 'beam' ? this.surfaceHit(event.origin, end) : null;
    event.aimPoint = hit?.point ?? end;
    this.events.push(event);
    if (profile.mode === 'beam') {
      const contact = this.impact(event, event.origin, end);
      event.aimPoint = contact?.terminal ? contact.point : end;
    } else {
      const projectile = createProjectile(event);
      projectile.shotID = event.shotID;
      projectile.salvoID = event.salvoID;
      this.shots.push(projectile);
    }
    return event;
  }
  step(dt) {
    this.time += dt;
    const due = this.pendingFire.filter((order) => order.t <= this.time).sort((a, b) => a.t - b.t);
    this.pendingFire = this.pendingFire.filter((order) => order.t > this.time);
    for (const order of due) this.emitShot(order);
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const p = this.shots[i],
        stepDuration = Math.min(dt, Math.max(0, this.time - p.bornAt)),
        { start, end } = advanceProjectile(p, this.aimPoint ?? this.target, stepDuration),
        hit = this.impact(p, start, end, this.time - stepDuration, stepDuration);
      if (hit?.terminal || p.life <= 0) {
        this.events.push({
          type: 'projectile-end',
          id: p.id,
          kind: p.kind,
          point: hit?.point ?? end,
          hit: Boolean(hit),
          reason: hit ? 'impact' : 'expired',
          t: this.time,
          profile: p.profile,
        });
        this.shots.splice(i, 1);
      }
    }
  }
}
