import { solveMountPose } from '../math/mount-pose.js';
import { weaponProfile } from './weapon-profiles.js';
import { planSalvo } from './firing-pattern.js';
import { createProjectile, advanceProjectile } from './projectile-motion.js';

/** Renderer-free adapter for comparing independently fitted ship hardpoints. */
export class WeaponFitoutModel {
  constructor() {
    this.time = 0;
    this.shots = [];
    this.target = { x: 0, y: 1, z: -40 };
    this.ship = { id: 0, x: 0, y: 0, z: 0, angle: 0, bank: 0 };
    this.mounts = new Map();
    this.maxProjectiles = 64;
    this.maxPending = 64;
    this.maxEvents = 256;
    this.events = [];
    this.pendingFire = [];
    this.serial = 0;
    this.salvoSerial = 0;
    this.effectUntil = 0;
  }

  get active() {
    return this.pendingFire.length > 0 || this.shots.length > 0 || this.time < this.effectUntil;
  }

  equip(id, { kind, definition, parameters = {} }) {
    if (id === undefined || id === null) throw new TypeError('A mount id is required');
    if (!definition?.muzzles?.length) throw new TypeError('A mount definition requires muzzles');
    const profile = weaponProfile(kind, parameters);
    // Orders already emitted to consumers remain historical; only future work from this mount is stale.
    this.pendingFire = this.pendingFire.filter((order) => order.mount !== id);
    this.events = this.events.filter((event) => event.mount !== id);
    this.shots = this.shots.filter((shot) => shot.mount !== id);
    this.mounts.set(id, { kind, definition, parameters: { ...parameters }, profile, cursor: 0 });
    return this.mounts.get(id);
  }

  pose(id) {
    const fitted = this.mounts.get(id);
    return fitted ? solveMountPose(this.ship, this.target, fitted.definition) : null;
  }

  fire(id) {
    const fitted = this.mounts.get(id);
    if (!fitted) return [];
    const pose = this.pose(id);
    if (!pose) return [];
    const plan = planSalvo({
      pattern: fitted.profile.firing,
      muzzleCount: pose.muzzles.length,
      cursor: fitted.cursor,
    });
    const projectileOrders = fitted.profile.mode === 'projectile' ? plan.shots.length : 0;
    const reserved = this.shots.length + this.pendingFire.reduce(
      (count, order) => count + (order.profile.mode === 'projectile' ? 1 : 0), 0,
    );
    const delayedOrders = plan.shots.reduce((count, shot) => count + (shot.delay > 0 ? 1 : 0), 0);
    if (
      reserved + projectileOrders > this.maxProjectiles ||
      this.pendingFire.length + delayedOrders > this.maxPending
    ) return [];

    fitted.cursor = plan.nextCursor;
    const salvoID = `salvo-${++this.salvoSerial}`;
    const immediate = [];
    for (const shot of plan.shots) {
      const order = {
        mount: id,
        muzzleIndex: shot.muzzleIndex,
        salvoID,
        t: this.time + shot.delay,
        profile: fitted.profile,
      };
      if (shot.delay === 0) immediate.push(this.emitShot(order));
      else this.pendingFire.push(order);
    }
    return immediate;
  }

  fireBattery() {
    const fired = [];
    for (const id of this.mounts.keys()) fired.push(...this.fire(id));
    return fired;
  }

  emitShot({ mount, muzzleIndex, salvoID, t, profile }) {
    const fitted = this.mounts.get(mount);
    if (!fitted || fitted.profile !== profile) return null;
    const muzzle = this.pose(mount)?.muzzles[muzzleIndex];
    if (!muzzle) return null;
    const id = ++this.serial;
    const event = {
      type: 'fire', id, shotID: id, salvoID,
      ship: 0, target: 1, mount, weapon: fitted.kind,
      muzzleId: muzzle.id, muzzleIndex,
      origin: { ...muzzle.position }, direction: { ...muzzle.direction }, profile, t,
      aimPoint: {
        x: muzzle.position.x + muzzle.direction.x * 40,
        y: muzzle.position.y + muzzle.direction.y * 40,
        z: muzzle.position.z + muzzle.direction.z * 40,
      },
    };
    this.queueEvent(event);
    this.effectUntil = Math.max(
      this.effectUntil,
      t + Math.max(0.24, profile.launch.duration, profile.mode === 'beam' ? profile.lifetime : 0),
    );
    if (profile.mode === 'projectile') {
      const projectile = createProjectile(event);
      projectile.shotID = id;
      projectile.salvoID = salvoID;
      this.shots.push(projectile);
    }
    return event;
  }

  step(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be a non-negative number');
    this.time += dt;
    const due = this.pendingFire.filter((order) => order.t <= this.time).sort((a, b) => a.t - b.t);
    this.pendingFire = this.pendingFire.filter((order) => order.t > this.time);
    for (const order of due) this.emitShot(order);
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const projectile = this.shots[i];
      const duration = Math.min(dt, Math.max(0, this.time - projectile.bornAt));
      const { end } = advanceProjectile(projectile, this.target, duration);
      if (projectile.life <= 0) {
        this.queueEvent({
          type: 'projectile-end', id: projectile.id, kind: projectile.kind,
          point: end, hit: false, reason: 'expired', t: this.time, profile: projectile.profile,
        });
        this.shots.splice(i, 1);
      }
    }
  }

  drain() {
    const events = this.events;
    this.events = [];
    return events;
  }

  queueEvent(event) {
    this.events.push(event);
    if (this.events.length > this.maxEvents)
      this.events.splice(0, this.events.length - this.maxEvents);
  }

  clear() {
    this.time = 0;
    this.shots = [];
    this.events = [];
    this.pendingFire = [];
    this.effectUntil = 0;
    for (const fitted of this.mounts.values()) fitted.cursor = 0;
  }
}
