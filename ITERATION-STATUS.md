# Latest completed iteration: interceptor fit controls

The interceptor study now fits three real small hardpoints independently. Its view selector preserves all mount transforms and restores all three weapons in Fitted ship. A new Hardpoint selector and Weapon selector support compact twin/quad autocannons, pulse lasers and missile pods. Fire salvo and Fire all three use the same weapon rigs, profiles, muzzle pose solver and discharge/flight effects as the main scene and range. The study's renderer-free adapter is `runtime/model/weapon-fitout-model.js`; no combat rules or asset geometry changed. The old single AC-200 alternating-flash preview is now historical.

The complete canonical suite currently passes 82 tests. Real UI checks covered all four weapon selections and all three views; a mixed battery emitted nine muzzle events with 0.000 mm displayed origin error. The view now uses the capped render scheduler and finishes transient/recoil/trail playback before sleeping.

## Previous completed iteration: model assembly seating

The Kestrel source and all four team exports now have supported hardpoint assemblies and integrated middle paint markings. The brawler's center mount has a supporting keel plate, and its dorsal marking is a surface inlay. Its olive and oxblood exports also now retain distinct paint factors. All active model-study, weapon-range and main-scene asset paths were updated from the same validated exports. Historical model checkpoints and unused legacy LODs remain historical.

All six GLBs pass Khronos validation with zero errors or warnings. Browser checks covered the Kestrel's low-angle seating and both hulls in the main scene; the main opening remains at 371 draw calls.

## Previous iteration: deliberate flight with momentum

The main scene is the acceptance target. Flight now uses a generic motor with angular inertia, forward thrust and bounded drift correction, driven by a separate demo pilot. Light and heavy hulls have different handling. Toggling Flight must not reset combat, teleport ships or restart their current maneuver. Turning it off holds current hull poses while combat continues. The armor selector and shared destruction integration remain the baseline below. Asset redesign, engine migration and new combat systems are outside this pass.

## Ownership

| Owner | Files and responsibility |
| --- | --- |
| Sol / flight_pilot | Independent patrol orders, anticipation and spacing |
| Sol / destruction_art | Read-only movement/renderer contract review |
| Lead | Generic motor, handling, opening-course corrections, thruster response, tests, integration and visual acceptance |

Armor mode begins with shields down and uses the same actual-hull collision and response path. Full scene begins with intact shields. A mode change restarts the study instead of inheriting the previous mode's damaged/dead ships. Destruction dimensions come from loaded mesh bounds; model events carry time, pose/velocity, dimensions, seed and fatal damage mix to the shared view. The view must not decide health or add per-explosion lights, physics or postprocessing passes.

## Required behavior

- Two durability layers: shield, then combined hull/armor. Damage belongs to the model.
- Projectile contact velocity carries unchanged into shield propagation; effects use exact contact time. Beams resolve instantly.
- Shield overflow follows the remaining swept path to the actual hull. No detached armor wall, invented hull contact, or projectile teleport.
- Every ship uses the same shield renderer and field-strength function. Differences come from incoming hit and receiving state.
- Hull marks follow their ship. All effect pools remain bounded.
- The main scene uses the same authored ships, compact multi-muzzle turrets, flight effects, and damage response components as inspection clients.

## Acceptance gates

1. Independent agents agree the DTO and surface-query ports; no renderer dependency enters the combat model.
2. Model tests cover persistent health, shield-to-hull traversal, contact timing/speed, simultaneous salvos, and shared shield behavior.
3. Main and range load their actual assets with no runtime/shader errors.
4. Through real UI, observe complete salvos, shields weakening/breaching, and hits on the hull. Check moving marks and the four-ship composition.
5. Record observed draw/effect counts and scheduler behavior. Active rendering stays capped at 30 fps, hidden/paused views sleep. Do not equate a frame cap with measured device performance.

## Delivered and checked — 6 September 2026

Main and range now share the defense sweep, damage resolver, impact response, actual-mesh surface query, weapon/effect views, and shield field rule. Main ships retain shield and combined hull HP across frames. All four participate in a two-team exchange; destroyed ships stop firing, and a complete study resets six seconds after team elimination (or at the 45-second scene boundary). Ports and loaded assets survive the reset.

The full canonical command `node --test tests/*.test.mjs runtime/render-scheduler.test.mjs` passes 60 tests. Coverage includes surface queries under rotation/nonuniform scale, moving/dead hull marks, raw overflow, contact velocity/time, instantaneous beams, same-time salvos, and render lifecycle bounds.

Browser acceptance uses the existing Codex in-app tabs at 1266 × 1045 CSS pixels. The range loaded the actual textured interceptor at 29 idle draws. Standard shield + three simultaneous missiles produced three shield hits, 62% shield and untouched hull; displayed contact and propagation were both 183.0 m/s. A nearly depleted shield produced one shield event followed by three actual hull events and 42% remaining hull. No runtime/shader errors were logged.

The main scene displayed persistent hull damage on all four ships after shield loss. At scene time 8 seconds, hull values were approximately 60%, 89%, 40%, and 75%. A later corrected-shader run reached team elimination: three ships lost, the surviving Cinder hull at 78%, with no firing from dead ships. Main screenshots show the authored interceptor/brawler exports, their physical mounts, engine plumes, and wreckfield together.

A black rectangular artifact was isolated using the existing art-pass controls: weapons and background were clean, thrusters reproduced it. Thruster GLSL contained signed-base `pow` and a reversed `smoothstep`; these were replaced with defined-domain math. Analogous math was corrected in shield, hull and projectile shaders. The corrected full scene rendered cleanly through the opening, destruction and automatic replay phases. The replay was observed returning from a survivor-only state at 16 seconds to four active ships in the next exchange; its 9-second frame remained clean, with hull contact visible on Moss. Reset also now clears GPU opacity buffers and effect clocks immediately.

Performance observations are short samples, not device qualification: the main opening used 371 draws / 229,624 triangles, and a busy sample used 385 draws / 233,616 triangles with 9/128 transient effects and 20/64 projectiles. Observed rate was roughly 23–24 fps under the 30 fps cap. A survivor-only frame used 144 draws / 117,544 triangles. GPU milliseconds and long-run memory were not measured. Further draw/cadence profiling is still needed; this pass adds no lights or postprocessing passes.

## Armor selector and destruction iteration — 6 September 2026

The selector now includes **Armor / hull**. Fresh loads explicitly select **Full scene**. A pass change restores the opening camera, clears follow state and effects, resets time/health, and resumes playback. Armor inspection starts all four hulls at 100% with shields at 0%; returning to Full scene restores both layers to 100%. These transitions were exercised through the existing in-app controls, including transitions from paused destruction frames.

The old generic destruction burst has been replaced by a shared `DestructionView`: a fast white rupture, irregular secondary plasma with holes and hot seams, brief separated shock fragments, and cooling vapor/debris. Two browser-driven revisions removed repeated pointed flame shapes, the full elliptical ring, and then overly smooth orange clouds. The final secondary phase was inspected at scene time 7 seconds, with uneven density and fading fragments visible. Destruction uses loaded hull dimensions, heading/velocity, deterministic variation and fatal damage mix. Hull strikes remain tied to the actual ship surface. This is cosmetic structural failure, not authored mesh fracture.

**Validation:** 68 canonical tests pass. Terra's separate integration review found no stale health/events/effects or coordinate defects. The revised shaders compiled and played in the real browser without logged errors. Full scene uses the same destruction path; Armor is an inspection preset, not a separate effect implementation.

**Measured samples:** at 1266 × 1045 CSS pixels, the opening Full scene showed 371 draws / 229,624 triangles and 0 destruction draws. The final Armor rupture frame showed 299 draws / 190,026 triangles, including 1/4 active destructions using 3 shared draws. At time 8 seconds the effect retired to 0/4 and 0 destruction draws. Returning to Full scene restored 371 draws / 229,624 triangles, zero transient effects/projectiles/destructions, and full health. After effect warmup, geometry/texture counts remained at 162/35 across the observed detonation, retirement and reset. These short samples do not establish long-run memory stability. Observed frame rate remained about 23 fps under the existing 30 fps cap; GPU milliseconds were not measured.

The destruction renderer has a fixed four-event pool: 52 cards, four short arcs and 28 fragments across three instanced meshes. It adds no textures, lights or postprocessing passes. Its card shader uses three fixed noise octaves, with no ray marching or volumetric simulation. Idle meshes are hidden and skip pool updates. Existing scheduler tests verify capped active rendering and sleeping paused/hidden views.

## Flight controls and reusable movement — 7 September 2026

The visible Flight toggle is independent of the art-pass selector. It engages a replaceable demo pilot that requests velocities from a generic movement motor. The motor owns acceleration, heading limits and integration; hull effects consume actual contact events and current poses, with no pre-rendered combat or route-specific effects. Flight off holds the current ships while combat continues. Enabling Flight from a paused study resumes playback. Mode changes/restarts retain Flight selection, and fresh pages default to Full scene with Flight off.

The canonical suite now passes **74 tests**. Tests include arbitrary motor coordinates/commands, finite input validation, speed/acceleration/turn limits, different fleet sizes and string identities, state-preserving toggles, dead ships, and retained Flight choice after reset. A contact integration test uses current-pose hull meshes and the shared damage path: every target receives hits on at least two distinct local hull faces over twelve seconds. A 45-second four-ship motion check stays inside |x| < 26 and |z| < 19, peaks at 3.2 world units/s and keeps centers at least 13.2 world units apart. This is evidence for this demonstration fleet, not a general collision-avoidance guarantee.

The browser initially combined the new HTML button with cached older JavaScript. Versioned entry modules forced a fresh load, and `outputs/game-design/serve-preview.py` now serves the local preview with `Cache-Control: no-store`. The main page then exposed Flight as selected and showed MANEUVERING; real screenshots showed the ships turning and changing positions, with live weapon origins following turret mounts. Armor mode retained Flight and showed the moved formation at time four seconds with no logged runtime/shader errors. No new geometry, lights, effects or render passes were introduced for movement; overall scene performance remains subject to the earlier profiling limits.

## Flight feel correction — 7 September 2026

The initial shared orbit and direct velocity steering above were rejected visually. The replacement motor turns with limited angular acceleration and braking, accelerates along the hull's forward axis, carries momentum through course changes, and uses bounded flight-assist corrections for drift. Interceptors are capped at 2.4 world units/s and 0.42 rad/s; brawlers at 1.6 and 0.28. Engine plumes consume actual positive thrust, shortening/dimming during coasting. No banking or vertical sine bobbing was added. Hidden/dead plumes skip uniform updates; there are no extra meshes, textures, lights or render passes.

The demo pilot now issues separate sustained patrol orders with anticipated corners, future spacing checks and boundary lookahead. These are demo navigation goals, not pre-rendered trajectories: the motor generates all poses and the existing contact/effect systems consume them. Root corrected the initial goals against the actual +X/-Z forward convention; each opening order is within 19 degrees of its hull heading. Flight off/on retains the current plan. These routes are local study content, not production navigation or a collision-avoidance guarantee.

**Validation:** 77 tests pass, including preserved momentum, limited angular acceleration, no immediate sideways acceleration, accelerating/coasting thrust, 30/60 Hz agreement, state-preserving toggles and multiple local hull contact faces. A separate final 45-second numerical run measured minimum center separation 13.05, maximum |x| 20.77, |z| 14.00, speed 2.14 and turn rate 0.42. This evidence is for the four demonstration craft.

The existing main browser tab was reloaded and inspected at the opening, four seconds and eleven seconds. Hulls carried forward into distinct turns and exhaust varied during coasting. With Flight off, screenshots at eleven and thirteen seconds held the surviving hulls in place while weapon damage/destruction continued. Re-enabling Flight resumed playback and retained the maneuver. No browser runtime/shader errors were logged. The final tab is Full scene, Flight on, playing, sound off. Earlier performance limits still apply; no new GPU-time claim is made.

## Next bounded work

Keep this integration as the baseline. Profile active-frame cadence and draw submission before broadening effects. Continue individual ship/background/weapon art studies separately; this pass does not claim those designs match the reference fully. Legacy `armor` source/CSS names and unused old combat entry points remain documented cleanup before the game engine is introduced.

Live server: http://127.0.0.1:8767/ . It was restarted after the user asked to see the result. Use the main/range tabs and pause after controlled checks; do not launch extra renderers or Blender jobs for this pass.
