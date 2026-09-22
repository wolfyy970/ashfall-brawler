import * as T from '../../vendor/three.module.js';
import { shieldFieldStrength } from '../model/shield-field-state.js';
import { getReviewMode } from '../model/review-mode.js';

const dtoVector = (value) => new T.Vector3(value.x, value.y ?? 0, value.z);

/**
 * Translates model events into short-lived visuals, shield reactions and audio.
 * It owns presentation policy only; the simulation remains the sole combat writer.
 */
export class BattlePresentationController {
  constructor({
    simulation,
    models,
    effects,
    audio,
    pilots,
    report = () => {},
    getReview = () => 'all',
  }) {
    this.simulation = simulation;
    this.models = models;
    this.effects = effects;
    this.audio = audio;
    this.pilots = pilots;
    this.report = report;
    this.getReview = getReview;
  }

  presentPending() {
    for (const event of this.simulation.drain()) this.present(event);
  }

  present(event) {
    const mode = getReviewMode(this.getReview());

    if (event.type === 'fire' && mode.muzzleFire) this.presentFire(event);
    else if (event.type === 'impact' && (event.shield ? mode.shields : mode.hullHits))
      this.presentImpact(event);
    else if (event.type === 'projectile-end') this.effects.finishProjectile(event);
    else if (event.type === 'destroy' && mode.destruction) {
      this.effects.destroy(event);
      this.audio.play('destroy', event.x);
      this.report(`${this.pilots[event.owner].name} destroyed ${this.pilots[event.ship].name}`);
    } else if (event.type === 'warp' && mode.weapons) {
      this.effects.ring(dtoVector({ x: event.x, y: 0, z: event.z }), 0x68baff, 1.2, 5);
      this.report(`${this.pilots[event.ship].name} returned to grid`);
    } else if (event.type === 'webbed' && mode.weapons) {
      this.report(`${this.pilots[event.owner].name} webbed ${this.pilots[event.ship].name}`);
    }
  }

  presentFire(event) {
    const model = this.models[event.ship];
    if (!model || !event.origin) return;
    model.weapons[event.mount]?.userData.weaponView?.fire(event);
    const start = dtoVector(event.origin);
    this.effects.launch(event);
    const end = dtoVector(event.aimPoint ?? { x: event.tx, y: 0.55, z: event.tz });

    if (event.weapon === 'pulse' || event.weapon === 'rail') {
      this.effects.beam(
        start,
        end,
        event.profile.flight.color,
        event.profile.lifetime,
        event.profile.diameter / 2,
      );
    }
    if (event.weapon === 'web') this.effects.web(start, end);

    this.audio.play(event.weapon, event.x);
  }

  presentImpact(event) {
    const model = this.models[event.ship];
    if (!model) return;
    const point = dtoVector(event.point ?? event);
    if (event.shield && event.localUnitDirection) {
      model.shield.impact(event.localUnitDirection, {
        weapon: event.kind,
        time: event.t ?? this.simulation.time,
        response: event.response,
        damageMix: event.receiving?.damageMix,
      });
    }
    this.effects.impact(event);
    this.audio.play('impact', point.x);
  }

  update(dt) {
    const mode = getReviewMode(this.getReview());
    for (const ship of this.simulation.ships) {
      const model = this.models[ship.id];
      if (!model) continue;
      model.shield.mesh.visible = ship.alive && mode.shields;
      const integrity = Math.max(0, Math.min(1, ship.shieldNow / ship.shield));
      // Every hull uses one field envelope; identity and roster position have no visual privilege.
      const strength = shieldFieldStrength({
        integrity,
        active: ship.alive,
        hitAge: this.simulation.time - ship.hitTime,
      });
      model.shield.update({ time: this.simulation.time, strength });
    }
    this.effects.update(
      dt,
      mode.projectiles ? this.simulation : { shots: [], time: this.simulation.time },
    );
  }

  clear() {
    this.effects.clear();
    for (const model of this.models) {
      model?.shield.clear();
      for (const gun of model?.weapons ?? []) gun.userData.weaponView?.reset();
    }
  }
}
