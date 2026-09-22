# Combat contracts

This is the executable-design contract for Ashfall's local combat prototype. It defines one model contract for the fleet and firing range. Existing range behavior is labelled **delivered**; fleet work is labelled **required**.

## State contract

Each ship has only logical `shield` and `hull` durability layers. Each layer supplies capacity, remaining HP, and resistances; the model may store those values in flat fields or nested records. Hull includes material/armour properties through its resistances and surface query. There is no `armor` health object, `armorNow`, third resistance pass, or armour membrane. Capacitor, web state, cooldowns, and redeploy state are operational state, not durability layers.

Each resistance and damage mix includes `em`, `thermal`, `kinetic`, and `explosive`. `resolveLayerHit({ damage, resistances, capacity, remaining })` is the sole layer resolver. It returns immutable totals, normalized mix, remaining HP, breach status, and raw channel overflow. A downstream layer gets raw overflow and applies only its own resistance.

## Collision and time contract

The simulation advances every travelling projectile over a finite segment:

```js
const segment = { start, end, stepStart, stepDuration, velocity };
```

`velocity` is the projectile's measured velocity at the end of that integration step in world units/second. The collision process is ordered:

1. If `ship.shield.remaining > 0`, query the shield field for the first segment intersection.
2. Resolve the shield. If it has no raw overflow, emit one shield contact and terminate the projectile.
3. If overflow remains, begin the residual segment at the exact shield point. Query the hull port for the first real hull-surface intersection.
4. Resolve the hull. Emit the hull contact and terminate the projectile.

For a crossing whose local segment fraction is `u`, accumulate the fraction over the original step and set `t = stepStart + u * stepDuration`. Do not stamp every contact with the enclosing frame time. Contacts at the same point must still preserve ordering; a later physical crossing has a larger fraction.

The model never moves a projectile to a target point to make an impact happen. It only advances position from velocity and intersects the swept path. Guidance may change future velocity according to its profile, but collision does not reset velocity, teleport position, or use damage as a speed proxy.

## Impact event contract

```js
{
  type: 'impact',
  ship, owner, projectileId, kind, profile, t,
  point: { x, y, z }, normal: { x, y, z },
  incomingDir: { x, y, z },
  incomingVelocity: { x, y, z },
  incomingSpeed,
  instantaneous, shield,
  receiving, response,
  localUnitDirection // required only for shield contacts
}
```

The event is immutable after creation. `incomingSpeed` is exactly the magnitude of `incomingVelocity`. For every non-instantaneous shield event, `response.propagationSpeed === incomingSpeed`; both values use world units/second. The response may use damage to choose power, width, instability, duration, collapse, flash scale, and particle count. It must never use damage or resistance to alter propagation speed.

A beam is instantaneous: it intersects its bore-axis segment immediately, emits its contact at the fire timestamp, has `incomingVelocity = {x:0,y:0,z:0}`, zero incoming/propagation speed, and creates no flight entity. Its visual beam is a view of that already-resolved event.

## Surface-query contract

Asset collision is an external model port:

```js
const hullSurface = {
  aimPoint: { x, y, z },
  intersectSegment(start, end) {
    return { t, point, normal } || null;
  },
};
```

It must return the first finite-segment hull contact in world space. The range currently fulfils it by loading `interceptor-rust.glb` and raycasting its visible triangles; bounding box and sphere checks only reject misses before triangle work. The fleet must supply a corresponding asset-derived query before hull impacts are enabled. Composition may build the query while loading a scene asset, but the combat model receives only this port and never calls `Object3D` methods while resolving a shot.

## Presentation contract

Controllers consume drained model events once, in model order. They choose addressed visual recipients and route immutable values. They do not call damage resolution, change health, calculate segment intersections, or calculate projectile velocity.

Shield presentation receives `localUnitDirection`, response data, damage mix, and timestamp. Hull presentation receives the true hull point, normal, response, damage mix, and timestamp. `ShieldView` can only add field slots; `HullImpactView` can only add bounded surface marks. Effects and audio observe the event and cannot determine whether it hit shield or hull.

Every ship uses:

```js
shieldFieldStrength({ integrity, hitAge, active })
```

with values from model state. Ship identity, roster index, paint, selected state, and camera state are forbidden inputs. The current shared function is delivered in `runtime/model/shield-field-state.js` and the controller calls it for every fleet ship.

## Status and required work

| Contract | Range | Fleet tableau |
| --- | --- | --- |
| Swept projectile motion and measured terminal velocity | Delivered | Delivered for visual shots |
| Exact fractional shield contact timestamp | Delivered | Delivered for current shield crossing |
| Beam resolves in its firing instant | Delivered | Delivered for shield and overflow hull contacts |
| Shield overflow reaches real hull surface | Delivered with the stationary target port | Delivered by the pure fleet sweep and per-GLB triangle port |
| Persistent shield + hull health | Delivered as inspection counters | Delivered as `shieldNow` + `hullNow`; hull destruction is model-owned |
| Asset-derived hull port | Delivered as interceptor GLB triangle query | Delivered per loaded fleet GLB; query follows model pose |
| Same field rule for all ships | Delivered | Delivered in `BattlePresentationController` |
| Bounded visual pools | Delivered | Delivered by existing fixed caps; verify under two-layer event load |

The remaining code cleanup is bounded: rename HUD and pilot data from armour to hull, then retire the legacy combat entry point. Keep Three.js traversal outside the model and preserve the controller event-routing boundary.
