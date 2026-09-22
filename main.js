import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PILOTS } from './sim.js';
import { VisualStudy } from './tableau.js?v=flight-20260907';
import { enginePlume } from './weapons.js';
import { createEquippedWeapon } from './runtime/views/weapon-mount-view.js';
import { environment } from './environment.js';
import { Effects } from './effects.js';
import { BattleAudio } from './audio.js';
import { ShieldView } from './runtime/views/shield-view.js';
import { createShipSurfaceQuery } from './runtime/views/ship-surface-query.js';
import { getReviewMode } from './runtime/model/review-mode.js';
import { BattlePresentationController } from './runtime/controllers/battle-presentation-controller.js';
import { createRenderScheduler } from './runtime/render-scheduler.mjs';
const $ = (id) => document.getElementById(id);
const sim = new VisualStudy(),
  sound = new BattleAudio(),
  models = [],
  feed = [];
let review = 'all';
$('pass').value = review;
$('flight').setAttribute('aria-pressed', String(sim.flightEnabled));
const inspect = new URLSearchParams(location.search).has('inspect');
const renderStats = inspect ? document.createElement('output') : null;
if (renderStats) {
  renderStats.id = 'render-stats';
  renderStats.style.cssText =
    'position:fixed;top:82px;right:34px;color:#a4b5c0;font:11px monospace;z-index:9;pointer-events:none';
  document.body.appendChild(renderStats);
}
const frameSamples = [];
let started = false,
  paused = false,
  slow = false,
  tactical = false,
  focus = -1,
  zoom = 1,
  last = 0,
  accumulator = 0,
  wall = 0,
  uiTime = 0;
let scheduler;
const scene = new T.Scene();
scene.background = new T.Color(0x080e14);
const renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.16;
renderer.info.autoReset = false;
$('stage').appendChild(renderer.domElement);
renderer.domElement.setAttribute(
  'aria-label',
  'Four industrial spaceships exchanging fire over a ruined orbital drydock',
);
const camera = new T.OrthographicCamera(-40, 40, 30, -30, 0.1, 650);
camera.position.set(0, 75, 44);
camera.lookAt(0, 0, 0);
const room = new RoomEnvironment(),
  pmrem = new T.PMREMGenerator(renderer),
  env = pmrem.fromScene(room, 0.04);
scene.environment = env.texture;
scene.environmentIntensity = 0.23;
room.dispose();
pmrem.dispose();
scene.add(new T.HemisphereLight(0x9eb8cc, 0x141b20, 0.22));
const key = new T.DirectionalLight(0xc7ddef, 2.3);
key.position.set(-25, 50, -12);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -49, right: 49, top: 40, bottom: -40, near: 1, far: 145 });
key.shadow.normalBias = 0.045;
key.shadow.bias = -0.0001;
scene.add(key);
const rim = new T.DirectionalLight(0xdcb68c, 1.05);
rim.position.set(28, 15, 20);
scene.add(rim);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new T.Vector2(innerWidth, innerHeight), 0.38, 0.52, 1.05);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const yard = environment(scene),
  fx = new Effects(scene),
  loader = new GLTFLoader();
const presentation = new BattlePresentationController({
  simulation: sim,
  models,
  effects: fx,
  audio: sound,
  pilots: PILOTS,
  report,
  getReview: () => review,
});
const targetCam = new T.Vector3(),
  look = new T.Vector3();
function resize() {
  const aspect = innerWidth / innerHeight,
    span = aspect < 1 ? 78 : 57;
  camera.left = (-span * aspect) / 2;
  camera.right = (span * aspect) / 2;
  camera.top = span / 2;
  camera.bottom = -span / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  fx.pmat.uniforms.pixel.value = (innerHeight / span) * renderer.getPixelRatio();
  scheduler?.invalidate();
}
addEventListener('resize', resize);
resize();
const mounts = ['HP_S01_PORT', 'HP_S02_STARBOARD', 'HP_S03_CENTRE'];
for (const p of PILOTS) {
  const card = document.createElement('button');
  card.className = 'pilot';
  card.style.setProperty('--paint', p.color);
  card.id = 'pilot-' + p.id;
  card.setAttribute('aria-label', 'Follow ' + p.name);
  card.setAttribute('aria-pressed', 'false');
  card.innerHTML =
    '<strong>' +
    p.name +
    '</strong><span class="hull">' +
    p.callsign +
    '</span><span class="role">' +
    p.role +
    '</span>' +
    ['shield', 'armor', 'cap']
      .map(
        (k, i) =>
          '<div class="meter ' +
          k +
          '"><label>' +
          ['SHD', 'HULL', 'CAP'][i] +
          '</label><div class="track"><div class="fill"></div></div></div>',
      )
      .join('') +
    '<span class="state">FLIGHT READY</span>';
  card.onclick = () => {
    focus = focus === p.id ? -1 : p.id;
    updateHUD();
    scheduler?.invalidate();
  };
  $('roster').appendChild(card);
}
function report(text) {
  feed.unshift(text);
  feed.splice(4);
  $('feed').textContent = '';
  for (const line of feed) {
    const d = document.createElement('div');
    d.textContent = line;
    $('feed').appendChild(d);
  }
}
async function loadFleet() {
  let loaded = 0;
  await Promise.all(
    PILOTS.map(async (p) => {
      const gltf = await loader.loadAsync('./assets/' + p.hull + '-' + p.paint + '.glb');
      const group = new T.Group();
      group.scale.setScalar(p.id === 1 ? 1.5 : p.id === 3 ? 1.18 : 1);
      scene.add(group);
      gltf.scene.scale.setScalar(1 / 16.130346733461423);
      group.add(gltf.scene);
      gltf.scene.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.name.startsWith('CAP_') || /human|crew|mannequin/i.test(o.name)) o.visible = false;
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap'])
              if (m[k]) m[k].anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
            if (/engine|exhaust|nozzle.*glow/i.test(m.name)) {
              m.emissive?.set(0x57baff);
              m.emissiveIntensity = 1.4;
            }
          }
        }
      });
      group.updateMatrixWorld(true);
      const weapons = await Promise.all(
        p.weapons.map(async (kind, i) => {
          const hp = gltf.scene.getObjectByName(mounts[i]);
          if (!hp) throw new Error('Missing authored ' + mounts[i]);
          const view = await createEquippedWeapon(kind),
            gun = view.root;
          gun.position.copy(group.worldToLocal(hp.getWorldPosition(new T.Vector3())));
          gun.quaternion.copy(
            group
              .getWorldQuaternion(new T.Quaternion())
              .invert()
              .multiply(hp.getWorldQuaternion(new T.Quaternion())),
          );
          group.add(gun);
          return gun;
        }),
      );
      const exhaust = [];
      const fxNodes = [];
      gltf.scene.traverse((o) => {
        if (o.name.startsWith('FX_') && /engine|exhaust/i.test(o.name)) fxNodes.push(o);
      });
      const enginePositions = fxNodes.length
        ? fxNodes.map((o) => group.worldToLocal(o.getWorldPosition(new T.Vector3())))
        : [
            new T.Vector3(p.hull === 'brawler' ? -1.29 : -1.03, 0, 3.49),
            new T.Vector3(p.hull === 'brawler' ? 1.29 : 1.03, 0, 3.49),
          ];
      for (const pos of enginePositions) {
        const plume = enginePlume();
        plume.position.copy(pos);
        group.add(plume);
        exhaust.push(plume);
      }
      sim.configureMounts(
        p.id,
        weapons.map((gun) => gun.userData.weaponView.definition(group.scale.x)),
      );
      const shield = new ShieldView({ parent: group });
      const getPose = () => sim.ships[p.id];
      const hullSurface = createShipSurfaceQuery({ root: group, hullRoot: gltf.scene, getPose });
      sim.configureHullSurface(p.id, hullSurface);
      const bounds = hullSurface.localBounds;
      const hullLength =
        Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z) * group.scale.x;
      sim.configureDestruction(p.id, { radius: hullLength * 0.5, length: hullLength });
      fx.registerHull(p.id, group, getPose);
      models[p.id] = { group, weapons, exhaust, shield, hullSurface };
      loaded++;
      $('loading').textContent = loaded + ' / 4 ships prepared';
    }),
  );
  await yard.ready;
  sim.reset({ exposedHull: getReviewMode(review).exposedHull });
  $('begin').disabled = false;
  $('begin').textContent = 'Enter the wreckfield';
  $('loading').textContent = 'FLIGHT SYSTEMS READY';
  scheduler?.invalidate();
}
function updateHUD() {
  const s = Math.floor(sim.time);
  $('clock').innerHTML =
    String(Math.floor(s / 60)).padStart(2, '0') +
    ':' +
    String(s % 60).padStart(2, '0') +
    ' <span>SIM TIME</span>';
  for (const p of sim.ships) {
    const card = $('pilot-' + p.id);
    card.classList.toggle('selected', focus === p.id);
    card.classList.toggle('dead', !p.alive);
    card.setAttribute('aria-pressed', String(focus === p.id));
    for (const [k, value] of [
      ['shield', p.shieldNow / p.shield],
      ['armor', p.hullNow / p.hull],
      ['cap', p.cap / 100],
    ])
      card.querySelector('.' + k + ' .fill').style.width =
        Math.max(0, Math.min(1, value)) * 100 + '%';
    card.querySelector('.state').textContent = !p.alive
      ? 'HULL LOST'
      : p.warp > 0
        ? 'WARP ARRIVAL'
        : sim.time < p.webUntil
          ? 'WEBBED · THRUST 42%'
          : p.kills + ' KILLS · ' + (focus === p.id ? 'TRACKING' : 'IN FLIGHT');
  }
  $('engagement').textContent =
    'ART STUDY / ' +
    (focus < 0
      ? sim.flightEnabled
        ? 'MANEUVERING'
        : 'HOLDING POSITION'
      : 'FOLLOWING ' + PILOTS[focus].name);
}
function pause() {
  if (!started) return;
  paused = !paused;
  $('pause').textContent = paused ? '▶' : 'Ⅱ';
  $('pause').setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  sound.mute(paused || $('sound').getAttribute('aria-pressed') !== 'true');
  last = 0;
  scheduler?.invalidate();
}
function reset() {
  sim.reset({ exposedHull: getReviewMode(review).exposedHull });
  presentation.clear();
  feed.length = 0;
  $('feed').textContent = '';
  accumulator = 0;
  last = 0;
  wall = 0;
  focus = -1;
  updateHUD();
  scheduler?.invalidate();
}
function cam() {
  tactical = !tactical;
  $('camera').textContent = tactical ? 'Cinematic' : 'Tactical';
  scheduler?.invalidate();
}
$('begin').onclick = async () => {
  started = true;
  document.body.classList.add('started');
  reset();
  try {
    await sound.unlock();
    $('sound').textContent = 'Sound on';
    $('sound').setAttribute('aria-pressed', 'true');
  } catch {
    report('Audio unavailable · visual demo continues');
  }
};
$('pass').onchange = () => {
  review = getReviewMode($('pass').value).id;
  $('pass').value = review;
  tactical = false;
  zoom = camera.zoom = 1;
  $('camera').textContent = 'Tactical';
  look.set(0, 0, 0);
  camera.position.set(0, 75, 44);
  camera.lookAt(look);
  paused = false;
  $('pause').textContent = 'Ⅱ';
  $('pause').setAttribute('aria-label', 'Pause');
  sound.mute($('sound').getAttribute('aria-pressed') !== 'true');
  reset();
};
$('pause').onclick = pause;
$('flight').onclick = () => {
  sim.setFlightEnabled(!sim.flightEnabled);
  $('flight').setAttribute('aria-pressed', String(sim.flightEnabled));
  if (sim.flightEnabled && started && paused) pause();
  updateHUD();
  scheduler?.invalidate();
};
$('reset').onclick = reset;
$('camera').onclick = cam;
$('slow').onclick = () => {
  slow = !slow;
  $('slow').setAttribute('aria-pressed', String(slow));
  scheduler?.invalidate();
};
$('sound').onclick = async () => {
  const enable = $('sound').getAttribute('aria-pressed') !== 'true';
  if (enable) await sound.unlock();
  sound.mute(!enable || paused);
  $('sound').setAttribute('aria-pressed', String(enable));
  $('sound').textContent = enable ? 'Sound on' : 'Sound off';
  scheduler?.invalidate();
};
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLButtonElement && e.code === 'Space') return;
  if (e.code === 'Space') {
    e.preventDefault();
    pause();
  }
  if (e.code === 'KeyR') reset();
  if (e.code === 'KeyC') cam();
  if (e.code === 'KeyH') document.body.classList.toggle('clean');
});
renderer.domElement.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    zoom = T.MathUtils.clamp(zoom * Math.exp(-e.deltaY * 0.0007), 0.7, 1.6);
    scheduler?.invalidate();
  },
  { passive: false },
);
document.addEventListener('visibilitychange', () => {
  last = 0;
  accumulator = 0;
  if (document.hidden) sound.mute(true);
  else sound.mute(paused || $('sound').getAttribute('aria-pressed') !== 'true');
  scheduler?.setVisible(!document.hidden);
});
renderer.domElement.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  paused = true;
  scheduler?.stop();
  $('error').hidden = false;
  $('error').textContent =
    'Graphics context interrupted. Reload the page to restart the local demo.';
});
addEventListener('pagehide', () => scheduler?.setVisible(false));
addEventListener('pageshow', () => {
  last = 0;
  scheduler?.setVisible(!document.hidden);
});
function frame(ms) {
  const raw = last ? Math.min(0.1, (ms - last) / 1000) : 0;
  last = ms;
  wall += paused ? 0 : raw;
  const dt = started && !paused && !document.hidden ? raw * (slow ? 0.5 : 1) : 0;
  accumulator += dt;
  let steps = 0;
  while (accumulator >= 1 / 60 && steps < 6) {
    sim.step(1 / 60);
    presentation.presentPending();
    accumulator -= 1 / 60;
    steps++;
  }
  if (steps === 6) accumulator = 0;
  if ((sim.endedAt !== null && sim.time - sim.endedAt >= 6) || sim.time >= 45) reset();
  for (const s of sim.ships) {
    const m = models[s.id];
    if (!m) continue;
    m.group.visible = s.alive && review !== 'environment';
    m.group.position.set(s.x, s.y, s.z);
    m.group.rotation.set(0, -s.angle, -s.bank * 0.065);
    const enemy = sim.ships[s.target];
    for (let i = 0; i < m.weapons.length; i++) {
      const rig = m.weapons[i].userData.weaponView;
      rig.applyPose(sim.mountPose(s, i));
      rig.update(sim.time);
    }
    const speed = Math.hypot(s.vx, s.vz);
    const enginePower = sim.flightEnabled ? 0.2 + 0.8 * s.thrust : 1;
    const showThrusters = s.alive && getReviewMode(review).thrusters;
    for (const plume of m.exhaust) {
      plume.visible = showThrusters;
      if (!showThrusters) continue;
      plume.scale.set(
        1,
        0.85,
        sim.flightEnabled ? 0.4 + enginePower : 0.65 + Math.min(speed, 5) * 0.23,
      );
      plume.userData.mat.uniforms.time.value = sim.time;
      plume.userData.mat.uniforms.power.value = s.warp > 0 ? 1.7 : enginePower;
    }
  }
  presentation.update(dt);
  yard.update(sim.time);
  if (focus >= 0 && sim.ships[focus].alive)
    targetCam.set(sim.ships[focus].x, 0, sim.ships[focus].z);
  else targetCam.set(0, 0, 0);
  const cameraSnap = !started || paused;
  look.lerp(targetCam, cameraSnap ? 1 : 1 - Math.exp(-raw * 2));
  const height = tactical ? 85 : 75,
    depth = tactical ? 0.01 : 44;
  camera.position.lerp(
    new T.Vector3(look.x + (tactical ? 0 : Math.sin(wall * 0.06) * 1.2), height, look.z + depth),
    cameraSnap ? 1 : 1 - Math.exp(-raw * 3),
  );
  camera.lookAt(look);
  camera.zoom = T.MathUtils.lerp(
    camera.zoom,
    zoom * (focus >= 0 ? 1.35 : 1),
    cameraSnap ? 1 : 1 - Math.exp(-raw * 4),
  );
  camera.updateProjectionMatrix();
  renderer.info.reset();
  composer.render();
  if (renderStats && raw > 0 && !document.hidden && started) {
    frameSamples.push(raw);
    if (frameSamples.length > 120) frameSamples.shift();
    const fps = frameSamples.length / frameSamples.reduce((a, b) => a + b, 0);
    renderStats.textContent =
      Math.round(fps) +
      ' fps · ' +
      renderer.info.render.calls +
      ' draws · ' +
      renderer.info.render.triangles.toLocaleString() +
      ' tris · ' +
      fx.items.length +
      '/128 transient FX · ' +
      fx.projectiles.size +
      '/64 projectiles · ' +
      fx.destruction.stats.active +
      '/4 detonations (' +
      fx.destruction.stats.draws +
      ' draws) · ' +
      renderer.info.memory.geometries +
      ' geometries · ' +
      renderer.info.memory.textures +
      ' textures';
  }
  uiTime += raw;
  if (uiTime > 0.15) {
    updateHUD();
    uiTime = 0;
  }
  // Read-only diagnostics for verification; controls always use real UI.
  window.ashfallStatus = {
    ready: models.filter(Boolean).length === 4,
    started,
    paused,
    slow,
    review,
    flight: sim.flightEnabled,
    camera: tactical ? 'tactical' : 'cinematic',
    focus,
    time: sim.time,
    projectiles: sim.shots.length,
    effects: fx.items.length,
    particles: fx.pool.filter((p) => p && p.life > 0).length,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
    geometries: renderer.info.memory.geometries,
    textures: renderer.info.memory.textures,
    kills: sim.totalKills,
    audioContext: sound.ctx?.state || 'locked',
    audioEnabled: sound.enabled,
  };
}
scheduler = createRenderScheduler({ draw: frame, active: () => started && !paused, fps: 30 });
scheduler.setVisible(!document.hidden);
loadFleet().catch((e) => {
  $('loading').textContent = 'Loading failed';
  $('error').hidden = false;
  $('error').textContent = 'Unable to load the local fleet. Reload to try again.\\n' + e.message;
  console.error(e);
});
