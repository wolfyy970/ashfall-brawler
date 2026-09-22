# Shield impact architecture

Status: **proposed and partially scaffolded**. `runtime/math/shield-intersection.js` and `runtime/views/shield-view.js` are implemented as isolated modules, but the current demo controller does not use them yet. Existing combat presentation remains unchanged while the authored interceptor and one textured autocannon are reviewed.

## Current limitations

- `tableau.js` detects cannon and missile hits with a scalar distance threshold (`impactRadius`) rather than the visible shield ellipsoid. It can remove a projectile before its segment reaches the rendered surface.
- `main.js` reconstructs the impact point from the target center toward the attacker in `shieldPoint()`. That loses the projectile's actual approach segment, and curved missiles can appear to strike a different side from their final trajectory.
- `effects.js` stores one `impactTime` and one `impactDir` per shield. A second hit overwrites the first, so simultaneous and closely sequenced responses cannot coexist.
- `main.js` owns GLB loading, simulation stepping, collision presentation, effect selection, sound, and HUD updates. This makes renderer details leak into event interpretation and prevents either layer from being reused independently.

## Boundary and event contract

The **model** advances ships and projectiles and emits renderer-free DTOs. The **controller** converts model poses into collision inputs, calls analytic intersection for each projectile segment, and emits a resolved impact event. The **view** consumes that event and changes only visual state.

A resolved event should contain `{ id, projectileId, time, weapon, sourceId, targetId, worldPoint, worldNormal, localUnitDirection, shielded, strength }`. `worldPoint` and `worldNormal` support sparks, decals, and audio placement. `localUnitDirection` is the normalized unit-sphere direction used directly by `ShieldView.impact()`. The event is immutable after dispatch. Damage calculation may consume the same collision result, but the view never decides damage.

## Analytic ellipsoid interception

For each fixed simulation step, preserve the projectile's previous and next positions. Transform both segment endpoints into shield-local coordinates using the target pose, then divide each axis by ellipsoid radii. In normalized space the shield is a unit sphere. Substitute `p(t) = p0 + t(p1-p0)` into `dot(p(t), p(t)) = 1`, solve the quadratic, and choose the smallest root in `[0,1]`. This is the actual segment entry point, including oblique and curved-projectile approaches. Transform the point back to world space. Compute the ellipsoid normal from the local gradient `(x/rx^2, y/ry^2, z/rz^2)`, normalize it, then rotate it to world space.

`intersectSegmentEllipsoid(start, end, { center, radii, rotation })` implements this with plain vector/quaternion DTOs and returns `null` or `{ t, point, normal, localPoint, localUnitDirection }`.

## Weapon responses and bounded rendering

`ShieldView` exposes `mesh`, `material`, `setTime(seconds)`, `setStrength(value)`, `update({time, strength})`, `impact(localUnitDir, event)`, `clear()`, and `dispose()`. Cannon produces a compact warm puncture and fast ring; pulse produces a warm, tight energy response; rail produces the sharpest cold response and fastest ring; missile produces the broadest, slower bloom. Projectile travel and external sparks remain separate views.

Each shield shader owns exactly eight impact slots. A CPU ring cursor writes direction, start time, strength, and weapon type into the next slot; all active slots render together, and the ninth hit deterministically replaces the oldest slot. The shader loop is compile-time bounded at eight. Geometry and material are allocated once per shield. External glints, sparks, and trails should use capped pools; suggested scene caps are 64 transient glints, 256 spark particles, and 24 missile trails, dropping the least visible optional effect when full.

## Gradual implementation

1. Finish and approve the authored interceptor plus one textured autocannon with no shield integration changes.
2. Unit-test segment/ellipsoid interception and the eight-slot overwrite order; keep these renderer-free and deterministic.
3. Add a controller adapter for one cannon projectile. Feed its previous-to-next segment into the helper and dispatch one resolved impact event.
4. Replace that ship's legacy shield material with `ShieldView`; verify grazing, head-on, simultaneous, and rapid sequential hits.
5. Add pulse and rail ray segments, then missile step segments, one weapon family at a time.
6. After visual approval, pool external impact effects and profile draw calls/GPU time before expanding to the fleet.
