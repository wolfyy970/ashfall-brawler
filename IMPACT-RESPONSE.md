# Impact response contract

`resolveLayerHit()` and `deriveImpactResponse()` serve different jobs. The first is authoritative gameplay resolution for one durability layer. The second maps its immutable result to bounded presentation values. Neither function chooses a target, traces geometry, or moves a projectile.

## Shipped behavior

`resolveLayerHit({ damage, resistances, capacity, remaining })` accepts four channels: `em`, `thermal`, `kinetic`, and `explosive`. It applies that receiving layer's resistance per channel and returns frozen totals, remaining HP, integrity, breach state, normalized damage mix, and raw channel overflow.

When a layer is exhausted, overflow remains raw by channel. The next layer applies its own resistance once; it does not inherit the shield's protection. A depleted layer mitigates nothing and forwards the complete raw hit. This gives Ashfall a clear conservation rule:

```text
incoming = mitigated by this layer + applied to this layer + raw overflow
```

The range currently uses this rule for an ordered shield then hull contact. Its target is the actual `interceptor-rust.glb`, loaded by `createRangeShipTarget()`. The adapter raycasts the visible mesh triangles and returns the first hit's world-space `t`, `point`, and normal. It uses the asset's world box and sphere only as early rejection bounds; they do not determine contact. The box intersection module remains a deterministic unit-test fixture.

`createImpactEvent()` snapshots the resolved layer result and calls `deriveImpactResponse()`. The event includes contact point, normal, incoming direction, measured incoming velocity, speed, layer label, and response. It is immutable after creation.

## Timing and propagation

For a travelling projectile, collision occurs on the finite segment traversed during an integration step. The event time is the exact fractional crossing within that step. If a shield breach continues to hull, the hull contact has its own later fractional time. The projectile does not teleport from field to hull or restart its motion.

`incomingVelocity` is the model's velocity at contact in world units/second; `incomingSpeed` is its magnitude. For every non-instantaneous shield event:

```text
response.propagationSpeed === incomingSpeed
```

Damage, resistance, weapon family, and remaining integrity may influence intensity, footprint, duration, instability, collapse, flash scale, and particle count. They cannot change the propagation speed. An instantaneous beam resolves during its fire event, has zero velocity and propagation speed, and has no projectile flight substitute.

## Presentation output

`deriveImpactResponse()` returns a frozen object containing:

```js
{ power, coreWidth, duration, propagationSpeed, instability,
  collapse, flashScale, particleCount, layer, instantaneous }
```

Values are bounded: shader lifetime is 0.12–2.2 seconds and per-impact particle count is at most 32. A shield can collapse only when its own resolved contact breaches it. A hull contact has zero propagation speed and is presented as a local surface response. These are visual controls, not claims about literal energy, momentum, or material science.

`ShieldView` receives a shield contact's local field direction and fills one of eight fixed shader slots. `HullImpactView` receives the true hull point and normal and writes one of 32 fixed instanced marks. Effects and audio observe the same event after the controller routes it. Presentation capacity may replace or omit cosmetics; it never changes model damage or terminal events.

## Current scope and next integration

The range is the delivered reference for: measured projectile velocity, exact contact timestamps, immediate beam contacts, raw-overflow continuity, and an actual interceptor hull surface query. Its health counters are intentionally compact inspection state, not a prescribed object layout.

The fleet now uses the same rules with persistent `shieldNow` and `hullNow` state through the pure `resolveDefenseSweep()` model module. Those layers may be represented as flat fields or nested objects; the invariant is two ordered durability layers and no separate armour layer. `main.js` constructs a per-ship triangle query from each loaded GLB, injects it through `configureHullSurface`, and registers its local hull anchor with the fixed impact-mark view. The controller routes the resulting immutable events, while views remain presentation-only.

The shared `shieldFieldStrength({ integrity, hitAge, active })` is the only fleet/range field-strength rule. Equal inputs must yield equal output for every ship, including ship ID 3; identity and roster position are not valid inputs.

## Validation

The targeted tests cover resistance and overflow conservation, fractional contact timing, carried terminal velocity, shield-to-hull continuity, immediate beams, shared shield behavior, fixed shield slots, and fixed hull-contact capacity. Browser visual acceptance is separate from these deterministic checks.
