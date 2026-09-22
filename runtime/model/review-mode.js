/**
 * The presentation switches are deliberately a small shared policy.  The
 * simulation does not read this module: an art pass can restart a study but
 * cannot change damage, targeting, or projectile resolution.
 */
export const ART_PASSES = Object.freeze({
  all: Object.freeze({
    id: 'all',
    shields: true,
    thrusters: true,
    weapons: true,
    projectiles: true,
    muzzleFire: true,
    hullHits: true,
    destruction: true,
    exposedHull: false,
  }),
  environment: Object.freeze({
    id: 'environment',
    shields: false,
    thrusters: false,
    weapons: false,
    projectiles: false,
    muzzleFire: false,
    hullHits: false,
    destruction: false,
    exposedHull: false,
  }),
  thrusters: Object.freeze({
    id: 'thrusters',
    shields: false,
    thrusters: true,
    weapons: false,
    projectiles: false,
    muzzleFire: false,
    hullHits: false,
    destruction: false,
    exposedHull: false,
  }),
  shields: Object.freeze({
    id: 'shields',
    shields: true,
    thrusters: false,
    weapons: false,
    projectiles: false,
    muzzleFire: false,
    hullHits: false,
    destruction: false,
    exposedHull: false,
  }),
  armor: Object.freeze({
    id: 'armor',
    shields: false,
    thrusters: false,
    weapons: true,
    projectiles: true,
    muzzleFire: true,
    hullHits: true,
    destruction: true,
    exposedHull: true,
  }),
  weapons: Object.freeze({
    id: 'weapons',
    shields: false,
    thrusters: false,
    weapons: true,
    projectiles: true,
    muzzleFire: true,
    hullHits: false,
    destruction: false,
    exposedHull: false,
  }),
});

export function getReviewMode(key) {
  return ART_PASSES[key] ?? ART_PASSES.all;
}
