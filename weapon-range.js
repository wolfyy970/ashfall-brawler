import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createEquippedWeapon } from './runtime/views/weapon-mount-view.js';
import { WeaponRangeModel } from './runtime/model/weapon-range-model.js';
import { WeaponEffectsView } from './runtime/views/weapon-effects-view.js';
import { createRangeShipTarget } from './runtime/views/range-ship-target-view.js';
import { shieldFieldStrength } from './runtime/model/shield-field-state.js';
import { ShieldView } from './runtime/views/shield-view.js';
import { weaponProfile, METRES_PER_WORLD_UNIT as M } from './runtime/model/weapon-profiles.js';
import { createRenderScheduler } from './runtime/render-scheduler.mjs';
const $ = (id) => document.getElementById(id),
  model = new WeaponRangeModel(),
  scene = new T.Scene();
scene.background = new T.Color(0x091016);
const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);
renderer.domElement.setAttribute(
  'aria-label',
  'A physical turret firing configurable projectiles into an energy shield',
);
const camera = new T.OrthographicCamera(-6, 6, 3, -3, 0.01, 100),
  controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
const room = new RoomEnvironment(),
  pmrem = new T.PMREMGenerator(renderer),
  env = pmrem.fromScene(room, 0.04);
scene.environment = env.texture;
scene.environmentIntensity = 0.5;
room.dispose();
pmrem.dispose();
scene.add(new T.HemisphereLight(0xb8cddd, 0x182126, 0.55));
for (const [x, y, z, color, power] of [
  [-4, 8, 4, 0xc9dfef, 2.8],
  [3, 4, -7, 0xe1bf92, 1.3],
]) {
  const light = new T.DirectionalLight(color, power);
  light.position.set(x, y, z);
  scene.add(light);
}
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new T.Vector2(innerWidth, innerHeight), 0.32, 0.42, 1.1));
composer.addPass(new OutputPass());
const effects = new WeaponEffectsView(scene),
  shieldRoot = new T.Group();
shieldRoot.position.set(2.8, 0.16, 0);
scene.add(shieldRoot);
const shield = new ShieldView({ parent: shieldRoot, radii: model.ellipsoid.radii });
let shipTarget;
const pad = new T.Mesh(
  new T.CylinderGeometry(0.41, 0.46, 0.07, 32),
  new T.MeshStandardMaterial({ color: 0x26313a, metalness: 0.75, roughness: 0.5 }),
);
pad.position.set(model.ship.x, -0.055, 0);
scene.add(pad);
let stepRequested = false;
let scheduler;
let rig = null,
  last = 0,
  paused = false,
  slow = false,
  volley = 0,
  nextFire = 0,
  accumulator = 0,
  generation = 0,
  span = 15,
  selected = 'missile',
  lastKind = '',
  lastEventAt = -10,
  maxError = 0;
const cached = new Map();
function cameraView() {
  const view = $('view').value;
  span =
    view === 'range'
      ? 15
      : view === 'launch'
        ? selected === 'cannon' || selected === 'rail'
          ? 1.2
          : 1.7
        : 11;
  controls.target.set(
    view === 'launch' ? model.ship.x : view === 'impact' ? model.target.x : -2,
    0,
    0,
  );
  camera.position
    .copy(controls.target)
    .add(
      new T.Vector3(
        view === 'launch' ? 3 : 4,
        view === 'launch' ? 2 : 8,
        view === 'launch' ? 2 : 8,
      ),
    );
  controls.update();
  resize();
}
function resize() {
  const a = innerWidth / innerHeight;
  if ($('view').value === 'range') span = Math.max(22, 36 / a);
  else if ($('view').value === 'impact') span = Math.max(14, 17 / a);
  camera.left = (-span * a) / 2;
  camera.right = (span * a) / 2;
  camera.top = span / 2;
  camera.bottom = -span / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  effects.pmat.uniforms.pixel.value = (innerHeight / span) * renderer.getPixelRatio();
  scheduler?.invalidate();
}
function parameters() {
  const speed = Number($('speed').value) / M,
    length = Number($('length').value) / M,
    p = weaponProfile(selected);
  const mode = $('salvo').value;
  const firing =
    selected === 'missile'
      ? {
          mode: mode === 'ripple' ? 'ripple' : 'simultaneous',
          count: mode === 'ripple' ? 6 : mode === 'all' ? 'all' : Number(mode),
          rippleInterval: mode === 'ripple' ? 0.16 : 0,
        }
      : { mode: 'all', count: 'all' };
  model.setParameters(
    p.mode === 'projectile'
      ? {
          speed,
          length,
          firing,
          ...(selected === 'missile' ? { maxSpeed: speed * 3, acceleration: speed * 2 } : {}),
        }
      : { firing },
  );
  $('speed-value').textContent =
    p.mode === 'beam' ? 'Instant beam' : Math.round(speed * M) + ' m/s';
  $('length-value').textContent =
    p.mode === 'beam' ? 'Surface-intercept beam' : (length * M).toFixed(1) + ' m';
  scheduler?.invalidate();
}
function clear() {
  model.reset();
  effects.clear();
  shield.clear();
  rig?.reset();
  volley = 0;
  nextFire = 0;
  accumulator = 0;
  maxError = 0;
  lastEventAt = -10;
  $('event').textContent = 'Ready · ' + (rig?.muzzles.length ?? 0) + ' physical muzzle nodes';
  $('stages').textContent = '';
  $('contact-speed').textContent = '';
  scheduler?.invalidate();
}
async function equip(selection) {
  const kind = selection === 'cannon-twin' ? 'cannon' : selection;
  const own = ++generation;
  selected = kind;
  $('fire').disabled = $('volley').disabled = true;
  if (rig) rig.root.visible = false;
  clear();
  let pending = cached.get(selection);
  if (!pending) {
    pending = createEquippedWeapon(kind, {
      barrels: selection === 'cannon-twin' ? 2 : undefined,
    }).then((view) => {
      scene.add(view.root);
      return view;
    });
    cached.set(selection, pending);
  }
  const next = await pending;
  if (own !== generation) {
    if (next !== rig) next.root.visible = false;
    return;
  }
  rig = next;
  rig.root.visible = true;
  rig.root.position.set(0, 0, 0);
  rig.root.quaternion.identity();
  rig.reset();
  rig.applyPose({ yaw: 0, pitch: 0 });
  model.configure(kind, rig.definition(1));
  rig.root.position.set(model.ship.x, model.ship.y, model.ship.z);
  rig.root.rotation.y = -model.ship.angle;
  rig.applyPose(model.pose());
  const profile = weaponProfile(kind),
    beam = profile.mode === 'beam';
  $('speed').disabled = $('length').disabled = beam;
  $('speed').max = kind === 'missile' ? '180' : '1400';
  $('speed').value = String(profile.speed * M);
  $('length').max = kind === 'missile' ? '10' : '45';
  $('length').value = String(Math.max(3, profile.length * M));
  $('salvo').disabled = kind !== 'missile';
  $('salvo').value = kind === 'missile' ? '3' : 'all';
  parameters();
  $('fire').disabled = $('volley').disabled = false;
  $('volley').textContent = 'Three salvos';
  $('event').textContent = 'Ready · ' + rig.muzzles.length + ' physical muzzle nodes';
  cameraView();
  scheduler?.invalidate();
}
function present(event) {
  if (event.type === 'fire') {
    const actual = rig.muzzlePosition(event.muzzleIndex);
    maxError = Math.max(
      maxError,
      actual.distanceTo(new T.Vector3(event.origin.x, event.origin.y, event.origin.z)),
    );
    rig.fire(event);
    effects.launch(event);
    if (event.profile.mode === 'beam')
      effects.beam(
        new T.Vector3(event.origin.x, event.origin.y, event.origin.z),
        new T.Vector3(event.aimPoint.x, event.aimPoint.y, event.aimPoint.z),
        event.profile.flight.color,
        event.profile.lifetime,
        event.profile.diameter / 2,
      );
    $('event').textContent =
      event.salvoID +
      ' · ' +
      (event.profile.firing.count === 'all' ? rig.muzzles.length : event.profile.firing.count) +
      ' ports · shot ' +
      event.id +
      ' from ' +
      event.muzzleId;
    lastKind = event.weapon;
    lastEventAt = model.time;
  } else if (event.type === 'impact') {
    if (event.shield)
      shield.impact(event.localUnitDirection, {
        weapon: event.kind,
        time: event.t,
        response: event.response,
        damageMix: event.receiving?.damageMix,
      });
    effects.impact(event);
    $('event').textContent =
      (event.shield ? 'Shield' : 'Hull') +
      ' · ' +
      model.hits +
      ' hits · ' +
      event.receiving.appliedDamage.toFixed(1) +
      ' damage / ' +
      event.receiving.mitigatedDamage.toFixed(1) +
      ' resisted' +
      (event.receiving.breached ? ' · BREACH' : '') +
      ' · SHIELD ' +
      Math.round(model.shieldRemaining) +
      '% / HULL ' +
      Math.round(model.hullRemaining) +
      '%';
    $('contact-speed').textContent = event.instantaneous
      ? 'Instant contact'
      : (event.shield ? 'Contact ' : 'Hull contact ') +
        (event.incomingSpeed * M).toFixed(1) +
        ' m/s' +
        (event.shield
          ? ' → shield ' + (event.response.propagationSpeed * M).toFixed(1) + ' m/s'
          : '');
    lastEventAt = model.time;
  } else if (event.type === 'projectile-end') effects.finishProjectile(event);
}
$('weapon').onchange = () => equip($('weapon').value).catch(error);
$('speed').oninput = $('length').oninput = parameters;
$('salvo').onchange = parameters;
$('defense').onchange = () => {
  model.setDefense($('defense').value);
  clear();
  shield.mesh.visible = model.shieldRemaining > 0;
  scheduler?.invalidate();
};
$('view').onchange = cameraView;
$('fire').onclick = () => {
  if (rig) {
    resumePlayback();
    rig.applyPose(model.pose());
    model.fire();
  }
};
$('volley').onclick = () => {
  resumePlayback();
  volley = 3;
  nextFire = model.time;
};
$('slow').onclick = () => {
  slow = !slow;
  $('slow').setAttribute('aria-pressed', String(slow));
};
function setPaused(value) {
  paused = value;
  $('pause').textContent = paused ? 'Resume' : 'Pause';
  $('step').disabled = !paused;
}
function resumePlayback() {
  stepRequested = false;
  last = 0;
  setPaused(false);
  scheduler?.invalidate();
}
$('pause').onclick = () => {
  setPaused(!paused);
  last = 0;
  scheduler?.invalidate();
};
$('reset').onclick = clear;
$('step').onclick = () => {
  stepRequested = true;
  scheduler?.invalidate();
};
function error(e) {
  $('error').hidden = false;
  $('error').textContent = e.message;
  console.error(e);
}
addEventListener('resize', resize);
controls.addEventListener('change', () => scheduler?.invalidate());
document.addEventListener('visibilitychange', () => {
  last = 0;
  scheduler?.setVisible(!document.hidden);
});
renderer.domElement.addEventListener('webglcontextlost', () => scheduler?.stop());
addEventListener('pagehide', () => scheduler?.setVisible(false));
addEventListener('pageshow', () => {
  last = 0;
  scheduler?.setVisible(!document.hidden);
});
cameraView();
function frame(ms) {
  const raw = last ? Math.min(0.05, (ms - last) / 1000) : 0;
  last = ms;
  const dt = stepRequested ? 1 / 60 : paused || document.hidden ? 0 : raw * (slow ? 0.25 : 1);
  stepRequested = false;
  accumulator += dt;
  if (rig) {
    while (accumulator >= 1 / 120) {
      model.step(1 / 120);
      accumulator -= 1 / 120;
      if (volley && model.time >= nextFire) {
        model.fire();
        volley--;
        nextFire = model.time + 1.1;
      }
    }
    rig.applyPose(model.pose());
    for (const event of model.drain()) present(event);
    rig.update(model.time);
  }
  effects.update(dt, model);
  shield.mesh.visible = model.shieldRemaining > 0 || model.time - model.lastShieldHit < 2.2;
  shield.update({
    time: model.time,
    strength: shieldFieldStrength({
      integrity: model.shieldRemaining / 100,
      hitAge: model.time - model.lastShieldHit,
    }),
  });
  controls.update();
  renderer.info.reset();
  composer.render();
  const phases = new Set(model.shots.map((p) => p.phase));
  $('stages').innerHTML = (
    selected === 'missile'
      ? ['ejection', 'ignition', 'flight', 'impact']
      : selected === 'cannon'
        ? ['muzzle', 'flight', 'impact']
        : ['emission', 'contact', 'decay']
  )
    .map((p) =>
      phases.has(p) ||
      ((p === 'impact' || p === 'contact') && model.hits && model.time - lastEventAt < 0.5) ||
      ((p === 'emission' || p === 'muzzle') && model.time - lastEventAt < 0.1) ||
      (p === 'decay' && model.time - lastEventAt >= 0.15 && model.time - lastEventAt < 0.5)
        ? '<b>' + p.toUpperCase() + '</b>'
        : p.toUpperCase(),
    )
    .join('  /  ');
  $('metrics').textContent =
    'Muzzle error ' +
    (maxError * M * 1000).toFixed(3) +
    ' mm · ' +
    renderer.info.render.calls +
    ' draws · ' +
    effects.projectiles.size +
    '/64 projectiles';
}
scheduler = createRenderScheduler({
  draw: frame,
  active: () =>
    !paused &&
    (volley > 0 ||
      model.pendingFire.length > 0 ||
      model.events.length > 0 ||
      model.shots.length > 0 ||
      effects.projectiles.size > 0 ||
      model.time - lastEventAt < 3),
  fps: 30,
});
scheduler.setVisible(!document.hidden);
createRangeShipTarget({ scene, center: model.target })
  .then(async (target) => {
    shipTarget = target;
    model.setHullSurface(target);
    scheduler.invalidate();
    await equip('missile');
  })
  .catch(error);
