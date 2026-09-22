# Ashfall combat architecture

Ashfall has one intended combat boundary. `runtime/model` owns authoritative state and emits immutable events. Controllers route those events. Three.js views draw them. `main.js` and `weapon-range.js` are composition roots, not alternate combat implementations.

## Ownership

| Area | Owner | Contract |
| --- | --- | --- |
| Ship pose, target selection, firing schedule, projectile position and velocity | model | World units and seconds; model snapshots are authoritative. |
| Collision and ordered damage traversal | model | Trace the finite swept segment through shield first and hull second. The same measured projectile velocity continues through both contacts. |
| Health | model | A ship has exactly logical `shield` and `hull` layers. They may be flat fields or nested records. Hull includes its armour characteristics; there is no third armour layer. `resolveLayerHit` applies each layer's own resistance to raw overflow. |
| Surface geometry | external model port | `surfaceQuery.intersectSegment(start, end)` returns the first world-space surface hit or `null`; `aimPoint` is optional. It is supplied from an asset-derived adapter and must not depend on a renderer view. |
| Event delivery | controller | Route a model event to the addressed ship rig, shield, hull-contact batch, transient effects, audio, and HUD/reporting. Controllers do not derive collision, health, velocity, or resistance. |
| Meshes, shaders, pools, audio, camera and DOM | view/composition | Consume snapshots and event DTOs only. Views do not select targets, repair health, decide hits, or manufacture damage. |

`WeaponRangeModel` is the current compact reference adapter. `VisualStudy` is the fleet's temporary model. `BattlePresentationController` is the controller used by `main.js`. `ShieldView`, `HullImpactView`, `WeaponEffectsView`, `ProjectileView`, and fitted weapon views are presentation only.

`environment.js` owns the wreckfield atmosphere through `YardAtmosphereView`
(`runtime/views/yard-atmosphere-view.js`). Only scenery materials opt into its
contrast treatment. A world-anchored, depth-tested veil below the flight plane
blends the wreck silhouettes into faint blue-grey cloud banks. Strength and
color are constructor options; no ship positions or asset textures are changed.
It chains the existing rock shader and restores material hooks on disposal.
Its added resources are one two-triangle draw and a shared 256×256 single-channel
noise texture (~85 KiB including mipmaps). Density is generated once; there is
no per-frame animation work, particle pool or extra postprocessing pass.
Verified in the cinematic and tactical cameras: the opening scene adds exactly
one draw and two triangles (371 → 372 draws; 245,936 → 245,938 triangles).

## Model ports and DTOs

The model receives asset collision through this port:

```js
const surfaceQuery = {
  aimPoint: { x, y, z }, // optional; used for aiming only
  intersectSegment(start, end) {
    // -> { t, point: {x,y,z}, normal: {x,y,z} } | null
  },
};
```

`t` is in `[0, 1]` along the provided finite segment. `point` and `normal` are world-space and exact enough for a contact event. The adapter may use an asset's collision proxy, BVH, or authored primitive; it is a model dependency and may not reach into `Object3D`, material, or shader state during resolution.

The model emits the following minimum DTOs:

```js
// Fire: exact physical muzzle and scheduled simulation time.
{ type: 'fire', id, shotID, salvoID, batteryID, ship, target, mount,
  muzzleId, muzzleIndex, t, origin, direction, profile, aimPoint }

// Projectile snapshot: position and velocity are authoritative in world units/s.
{ id, kind, owner, target, mount, muzzleId, muzzleIndex, profile,
  x, y, z, vx, vy, vz, age, life, phase, bornAt }

// Contact: immutable result of model collision and health resolution.
{ type: 'impact', ship, owner, projectileId, kind, t, point, normal,
  incomingDir, incomingVelocity, incomingSpeed, instantaneous, shield,
  receiving, response, profile }

{ type: 'projectile-end', id, kind, point, t, hit, reason, profile }
```

`shield` is a boolean layer label only. `receiving` is the frozen `resolveLayerHit` result. `response` is the frozen presentation derivation. A beam emits `fire` and any contact at the same simulation timestamp; it creates no travelling substitute. A travelling projectile's contact time is `stepStart + crossedFraction * stepDuration`, including a later hull crossing in the same step.

Structural failure emits an immutable destruction event at the fatal hull contact time:

```js
{ type: 'destroy', ship, owner, t, point, forward, velocity,
  radius, length, seed, damageMix }
```

The composition root supplies the model with dimensions from each loaded hull's bounds through `configureDestruction`. The event carries plain world-space vectors and the fatal damage mix. `BattlePresentationController` routes it unchanged through `WeaponEffectsView` to `DestructionView`. That view owns only staged light/plasma cards, fragmented shock arcs and cooling debris; it neither resolves damage nor queries model geometry. Ship size, motion and orientation drive the presentation, with a deterministic seed for secondary variation. Actual hull hit locations still come from the separate surface-query port. The debris is cosmetic, not mesh fracture or a rigid-body simulation.

`DestructionView` reserves four events across three shared instanced meshes (52 cards, four arcs, 28 fragments). It adds at most three draws while active and hides all three meshes when idle. No explosion creates a light or an extra postprocessing pass. `clear()` resets clocks, slots, matrices and GPU attributes; `dispose()` releases its geometry and materials.

## Art-pass reset contract

The independent **Flight** toggle controls a replaceable demonstration pilot. `study-flight.js` reads the current fleet and requests velocities; it never writes ship poses. `ship-motion.js` exposes `stepShipMotion(ship, command, dt, spec)` with a flight-assist model: angular acceleration and braking turn the hull toward its requested course, main acceleration follows the hull's forward axis, and bounded lateral corrections remove drift. Large course changes reduce throttle while momentum carries the craft forward. Interceptors and brawlers receive separate speed, acceleration and turn limits through data. This is deliberately assisted spaceflight, not a full rigid-body simulation.

The motor has no renderer, ship-identity, fleet-size or arena dependencies. Its command is `{ velocity: { x, y, z } }`, with an explicit `{ stop: true }` inspection hold. The returned velocity is the velocity actually integrated into the returned position. Returned `angularVelocity` preserves turn inertia; `thrust` drives engine-plume power so accelerating and coasting look different. A human or neural pilot can supply the same command shape without changing effects.

`VisualStudy` connects the demonstration pilot to that motor at its fixed step and keeps firing/damage on the existing path. Flight begins from current state without teleporting or resetting combat; disabling it holds the current hull poses while weapons continue. A study reset retains the selected Flight mode. Fresh pages start with Flight off. Existing surface queries, turret origins and hull marks consume the resulting current poses. This adds a reusable movement boundary; navigation, collision avoidance guarantees for arbitrary fleets, multiplayer authority and a complete game world remain future work.

`runtime/model/review-mode.js` is the single display policy for Full scene, Background, Thrusters, Shields, Armor / hull and Weapons. Opening the page selects Full scene. Selecting any other pass resets time, living ships, health, effects, follow target and camera, then resumes that study. Armor / hull explicitly initializes intact hulls with shields depleted; Full scene initializes both layers intact. The model accepts the `exposedHull` reset preset but does not read DOM controls. Review visibility is presentation policy and does not become an alternate damage implementation.

For a shield contact, `localUnitDirection` is also required. It is the local ellipsoid direction consumed by `ShieldView`. Hull contacts instead carry the actual hull point and normal from the surface-query port.

## Required combat rules

1. **Two layers only.** Every live ship has shield and hull capacity, remaining HP, and resistances; a flat or nested model representation is valid. Replace legacy `armor`/`armorNow` naming and UI state with `hull`/`hullNow`; armour is a hull attribute, not an intervening health bar.
2. **Shield then hull.** While shield remains, intersect its field. Resolve it. Only raw channel overflow continues from the shield contact along the unmodified segment and velocity to the hull surface. A healthy shield terminates the shot; a hull hit terminates it. A depleted shield does no mitigation.
3. **Velocity is measured, never inferred from damage.** `incomingVelocity` is the projectile's velocity at the crossing. `incomingSpeed = length(incomingVelocity)`. Shield propagation speed equals `incomingSpeed` in world units/s. Damage, resistance, weapon family, and integrity can shape intensity and duration but cannot rescale propagation. Instantaneous beams have zero propagation speed.
4. **Universal field rule.** Every live ship calls `shieldFieldStrength({ integrity, hitAge, active })` using the same input units. No ship ID, roster position, paint, hull class, or selected camera state can alter the result unless that value is an explicit model field included in the function's input.
5. **Views have bounded cosmetics.** Shield contact slots: 8 per ship. Hull marks: 32 shared across the scene. Rendered projectiles: 64. Transient effects: 128. Shared particles: 1,600. Reaching a visual cap may drop or replace cosmetics only; it must not suppress model events, damage, or projectile termination.

## Delivered now

- `WeaponRangeModel` advances projectiles, keeps terminal measured velocity, computes fractional crossing time, resolves shield overflow, and continues the same shot to its injected hull surface.
- Its beam path contacts immediately. The range hull target loads the actual interceptor GLB and raycasts its visible mesh triangles; box and sphere bounds only reject impossible rays, rather than supplying the contact.
- `resolveLayerHit`, `createImpactEvent`, and `deriveImpactResponse` are renderer-free. Shield propagation already uses measured incoming speed, and the shared `shieldFieldStrength` function is used in the range and controller.
- `BattlePresentationController` forwards model events and applies one shield field formula for all fleet entries. `ShieldView` and `HullImpactView` use fixed pools.
- `VisualStudy` now has persistent `shieldNow` and `hullNow`, invokes the pure `resolveDefenseSweep`, preserves measured velocity across shield overflow, and accepts a per-ship hull-surface port through `setHullSurface(id, surface)`.

## Remaining cleanup

`main.js` now creates an asset-derived triangle query for every loaded fleet GLB, supplies it through `configureHullSurface`, and registers the hull with the fixed impact-mark view. `setHullSurface(id, surface)` deliberately accepts only the external query interface, keeping triangle traversal out of `VisualStudy`.

`PILOTS` still uses `armor` as source-data naming while `VisualStudy` maps that starting value to `hull`/`hullNow`; HUD selectors in `main.js` still use the old CSS/data label. Rename this presentation/data vocabulary to hull. `sim.js` and `combat-main.js` remain a legacy path that bypasses the current tableau/controller architecture. The range keeps compact `shieldRemaining`/`hullRemaining` inspection counters, which are valid equivalent two-layer state rather than a mandated fleet representation.

## Acceptance gates for the next implementation pass

| Gate | Pass condition |
| --- | --- |
| Contact continuity | A projectile that exhausts a shield produces ordered shield and hull contacts in one or more steps. Hull `t` is later, both contacts retain identical velocity, and distance divided by contact-time difference equals measured speed within floating-point tolerance. |
| Exact hull contact | With shield absent or breached, cannon, missile, rail, and beam contacts use the hull port's first finite-segment result. The emitted point and normal equal that result; no shield-envelope point is reused. |
| Two-layer health | A live fleet ship persists only shield and hull health. Shield resistance applies once, raw overflow receives only hull resistance, hull reaching zero causes destruction, and reset/redeploy restores both capacities deliberately. |
| Shared shield rule | Equal `{ integrity, hitAge, active }` yields equal field strength for every ship, including IDs 0–3. Tests must vary ID/order and prove there is no privileged ship. |
| Beam timing | A beam has `impact.t === fire.t`, `instantaneous === true`, and zero propagation. No projectile snapshot is created for it. |
| Bounds and performance | Under sustained fire, model event/damage counts remain complete while cosmetic state stays at or below 8 shield slots, 32 hull marks, 64 projectiles, 128 effects, and 1,600 particles. Render scheduling remains capped at 30 fps and sleeps under the documented idle/hidden/paused conditions. |

The legacy source vocabulary and unused entry point are future cleanup before introducing the game engine. Acceptance of this integration uses the active `main.js`/`VisualStudy` path. See `ITERATION-STATUS.md` for the actual checks and remaining visual/performance work.
