# Weapon lifecycle contract

The scene and firing range use the same rig, projectile, and impact modules. The future engine can replace the two demo models while keeping the presentation.

## Ownership

- **Engine/model:** selects the weapon and muzzle, supplies its firing pose, advances position/velocity, decides ignition/guidance, intersects collision surfaces, and emits terminal events.
- **Controller:** routes events to the correct rig, launch effect, flight view, shield, and sound.
- **Views:** apply poses and draw snapshots. They do not choose targets, turn missiles, infer hits, or apply damage.

`WeaponMountView.definition()` reads rest geometry from actual nodes. `solveMountPose()` is renderer-free math shared by the engine adapter and pose presentation. It handles hull bank, hardpoint orientation, turret yaw, pitch and arbitrary muzzle arrays. Each mount owns its own muzzle cursor. No global projectile ID is used to select a barrel.

`firingPattern()` and `planSalvo()` are renderer-free engine policy. Cannon, pulse and rail mounts default to a naval broadside: every physical barrel on the turret fires on one trigger. Missiles default to three simultaneous tubes; engine overrides may select 1, 2, 3 or 6 missiles and either simultaneous or deliberate ripple release. Counts larger than the fitted launcher are bounded by its physical muzzle count. `fireBattery(shipId)` coordinates every selected mount at one engine timestamp and tags its fire events with one `batteryID`.

The detailed AC-200 GLB is now used by the wreckfield’s autocannon mounts. Other rigs preserve their individual tube/barrel nodes. Static geometry is merged by moving parent and material; functional transforms stay separate.

## Units

One current scene unit is **16.130346733461423 metres**. Time is seconds. Positions, lengths and diameters use scene units; velocity uses scene units/second. `METRES_PER_WORLD_UNIT` is the explicit adapter scale. The firing range displays metres and metres/second and converts at that boundary.

The AC-200’s default projectile diameter is 200 mm. Its visible tracer length is independently configurable. Missile body diameter fits the open tube; the nose is the projectile position. A missile begins with its body inside the launcher and its nose at the lip.

## Event sequence

A `fire` event contains:

```js
{
  type: 'fire', id, shotID, salvoID, batteryID, ship, target, mount,
  muzzleId, muzzleIndex, t,
  origin: { x, y, z },       // exact world-space muzzle lip
  direction: { x, y, z },    // actual bore axis
  profile,                  // immutable per-shot parameters
  aimPoint                  // surface intersection for an instant beam
}
```

One trigger returns an array and emits one `fire` event per selected physical muzzle. Every event has a unique `id`/`shotID`; all members share the salvo's `salvoID` and scheduled timestamp when simultaneous. Battery members additionally share `batteryID`. Ripple members retain one `salvoID` while their timestamps advance by the configured `rippleInterval`. The event origin and direction are solved separately from each named muzzle, preserving parallel bores and physical offsets.

The firing model describes recoil impulse through each profile's launch settings. Any flash, recoil motion or debris is presentation; a view must not invent atmospheric muzzle smoke for vacuum combat.

`profile` supplies `mode`, `speed`, `length`, `diameter`, `lifetime`, and nested `launch`, `flight`, and `impact` settings. Missile profiles also supply ignition/guidance delays, acceleration, speed cap and turn rate. These are model inputs, not constants in the flight renderer. Changing a weapon profile affects subsequent launches; existing shots keep their original profile.

The engine then supplies snapshots:

```js
{
  id, kind, owner, target, mount, muzzleId, muzzleIndex,
  origin, profile,
  x, y, z, vx, vy, vz,       // authoritative nose position and velocity
  age, life, phase, bornAt, ignitionAt, guidanceAt
}
```

The view uses those coordinates directly. It anchors the visible body/tracer behind the nose; an initial cannon streak grows from the muzzle instead of extending through the hull.

Missile phases are ejection → ignition → flight. The model waits until the tail clears the tube, even when length or launch speed changes. Guidance begins after ignition. The view adds exhaust and fin deployment to those phase/timing inputs.

An `impact` event retains the projectile ID and profile, with `point`, `normal`, `incomingDir`, `localUnitDirection`, and `shield`. It chooses that projectile’s surface flash, sparks and independent shield response. A matching `projectile-end` event carries the exact terminal point and `reason: 'impact' | 'expired'`. An expiry removes the flight without inventing a shield hit. The retained missile trail is finished at its last physical nozzle position, then fades.

## Rendering budget

- Projectile flight uses five shared batches: cannon streaks, missile bodies, fins, exhaust and retained trails.
- 64 fixed projectile/history slots, each with at most 96 trail samples.
- Retiring trails may yield a slot to a new projectile. At capacity, cosmetic births can be skipped without changing the simulation.
- Eight simultaneous shader impacts per shield; 128 transient glints/beams/rings; 1,600 shared point-particle slots.
- No per-shot geometry allocation in the flight view. Geometry and history buffers survive clear/replay and have explicit disposal.
- Rig batching reduced the sampled full-scene count from about 544 to about 306 draw calls while preserving moving parts. The local browser remained near 60 fps in those samples. This is not a cross-device benchmark.

## Inspection

Open `weapon-range.html`. Select missile, autocannon, pulse or rail; choose muzzle, whole-flight or shield framing. Fire once or cycle all physical ports. Change launch speed and visible length. Pause and use **Step** for 1/60-second advances.

The displayed muzzle error compares the rendered node’s world transform to the model’s fire event. It is a CPU transform check at the displayed precision, not a measurement of raster precision.

The launcher now has open tube mouths, corrected outward-facing rims, a chamfered casing and the existing fleet atlas. Its visual refinement remains iterative; the current pass establishes launch/flight/impact consistency and controllable behavior.

## Validation for this pass

18 tests cover arbitrary barrel counts, independent sequencing, real Three.js hierarchy agreement, missile launch clearance/turn limits, parameter capture, snapshot-driven length/position, final trail position, buffer reuse and the previous multi-impact shield checks. Browser review exercised all six missile tubes, the AC-200’s two bores, changed speed/length, pause and frame stepping. The inspected volleys reported 0.000 mm at the displayed transform precision and distinct surface impacts. No browser console errors were observed.

Pulse and railgun two-barrel cycles were also exercised in the browser: both produced two surface impacts and 0.000 mm displayed muzzle alignment error. The final scene review showed approximately 306 draw calls and 216k triangles at 60 fps locally after rig batching.
