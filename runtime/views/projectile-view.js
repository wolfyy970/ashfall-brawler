import * as T from '../../vendor/three.module.js';
import { weaponProfile } from '../model/weapon-profiles.js';
const UP = new T.Vector3(0, 1, 0),
  HISTORY = 96;
function exhaustGeometry() {
  const g = new T.BufferGeometry();
  g.setAttribute(
    'position',
    new T.Float32BufferAttribute(
      [
        -0.5, 0, 0, 0.5, 0, 0, -0.5, -1, 0, 0.5, -1, 0, 0, 0, -0.5, 0, 0, 0.5, 0, -1, -0.5, 0, -1,
        0.5,
      ],
      3,
    ),
  );
  g.setAttribute(
    'uv',
    new T.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 1], 2),
  );
  g.setIndex([0, 2, 1, 2, 3, 1, 4, 6, 5, 6, 7, 5]);
  return g;
}
function finGeometry() {
  const vs = [];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2,
      c = Math.cos(a),
      s = Math.sin(a);
    vs.push(0.42 * c, -0.46, 0.42 * s, 1.25 * c, -0.48, 1.25 * s, 0.44 * c, -0.13, 0.44 * s);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(vs, 3));
  g.computeVertexNormals();
  return g;
}
/** GPU batches and fixed history slots. Consumes authoritative snapshots; never steers projectiles. */
export class ProjectileView {
  constructor(scene, { capacity = 64 } = {}) {
    this.scene = scene;
    this.capacity = capacity;
    this.active = new Map();
    this.time = 0;
    this.slots = Array.from({ length: capacity }, (_, slot) => ({
      slot,
      id: null,
      alive: false,
      used: false,
      history: new Float32Array(HISTORY * 3),
      head: 0,
      count: 0,
      lastSample: -Infinity,
      endedAt: -Infinity,
      position: new T.Vector3(),
      velocity: new T.Vector3(),
      direction: new T.Vector3(0, 0, -1),
    }));
    this.pose = new T.Object3D();
    this.center = new T.Vector3();
    this.nozzle = new T.Vector3();
    this.color = new T.Color();
    this.cannon = this.batch(
      new T.CylinderGeometry(0.5, 0.5, 1, 6),
      new T.MeshBasicMaterial({ color: new T.Color(4.2, 2.1, 0.58) }),
    );
    this.body = this.batch(
      new T.LatheGeometry(
        [
          new T.Vector2(0.3, -0.5),
          new T.Vector2(0.5, -0.43),
          new T.Vector2(0.5, 0.2),
          new T.Vector2(0.18, 0.45),
          new T.Vector2(0, 0.5),
        ],
        12,
      ),
      new T.MeshStandardMaterial({ color: 0xb1b8b4, metalness: 0.63, roughness: 0.42 }),
    );
    this.fins = this.batch(
      finGeometry(),
      new T.MeshStandardMaterial({
        color: 0x535c60,
        metalness: 0.7,
        roughness: 0.44,
        side: T.DoubleSide,
      }),
    );
    this.exhaust = this.batch(
      exhaustGeometry(),
      new T.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
        vertexShader:
          'varying vec2 v;void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);}',
        fragmentShader:
          'varying vec2 v;void main(){float x=abs(v.x-.5);float t=clamp(v.y,0.,1.);float jq=x/(.07+.08*t);float cq=x/.035;float jet=exp(-jq*jq)*exp(-t*4.)*pow(max(0.,1.-t),1.5);float core=exp(-cq*cq)*exp(-t*10.);gl_FragColor=vec4(vec3(1.3,.53,.13)*jet+vec3(3.5,3.2,2.6)*core,1.);}',
      }),
    );
    const n = capacity * HISTORY * 2;
    this.positions = new Float32Array(n * 3);
    this.uvs = new Float32Array(n * 2);
    this.alphas = new Float32Array(n);
    const ix = [];
    for (let s = 0; s < capacity; s++)
      for (let i = 0; i < HISTORY - 1; i++) {
        const j = (s * HISTORY + i) * 2;
        ix.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
      }
    const g = new T.BufferGeometry();
    g.setAttribute(
      'position',
      new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage),
    );
    g.setAttribute('uv', new T.BufferAttribute(this.uvs, 2).setUsage(T.DynamicDrawUsage));
    g.setAttribute('opacity', new T.BufferAttribute(this.alphas, 1).setUsage(T.DynamicDrawUsage));
    g.setIndex(ix);
    const m = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      vertexShader:
        'attribute float opacity;varying vec2 v;varying float a;void main(){v=uv;a=opacity;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:
        'varying vec2 v;varying float a;void main(){float q=(v.x-.5)*4.;float edge=exp(-q*q);gl_FragColor=vec4(.27,.29,.30,a*edge*smoothstep(0.,.12,v.y));}',
    });
    this.trails = new T.Mesh(g, m);
    this.trails.frustumCulled = false;
    scene.add(this.trails);
    g.setDrawRange(0, 0);
  }
  batch(geometry, material) {
    const mesh = new T.InstancedMesh(geometry, material, this.capacity);
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.scene.add(mesh);
    return mesh;
  }
  allocate(id, kind, profile) {
    if (this.active.has(id)) return this.active.get(id);
    let s = this.slots.find((s) => !s.used);
    if (!s) s = this.slots.filter((s) => !s.alive).sort((a, b) => a.endedAt - b.endedAt)[0];
    if (!s) return null;
    Object.assign(s, {
      id,
      kind,
      profile,
      alive: true,
      used: true,
      head: 0,
      count: 0,
      lastSample: -Infinity,
      endedAt: -Infinity,
    });
    this.active.set(id, s);
    return s;
  }
  begin(event) {
    const p = event.profile ?? weaponProfile(event.weapon);
    if (p.mode !== 'projectile') return;
    const s = this.allocate(event.id, event.weapon, p);
    if (!s) return;
    s.origin = { ...event.origin };
    s.position.set(event.origin.x, event.origin.y, event.origin.z);
    s.direction.set(event.direction.x, event.direction.y, event.direction.z).normalize();
    s.velocity.copy(s.direction).multiplyScalar(p.speed);
    s.age = 0;
    s.phase = event.weapon === 'missile' ? 'ejection' : 'flight';
    s.bornAt = event.t ?? this.time;
  }
  sample(s, force = false) {
    if (
      s.kind !== 'missile' ||
      s.phase === 'ejection' ||
      (!force && this.time - s.lastSample < 0.025)
    )
      return;
    this.nozzle.copy(s.position).addScaledVector(s.direction, -s.profile.length);
    s.history.set([this.nozzle.x, this.nozzle.y, this.nozzle.z], s.head * 3);
    s.head = (s.head + 1) % HISTORY;
    s.count = Math.min(HISTORY, s.count + 1);
    s.lastSample = this.time;
  }
  end(event) {
    const s = this.active.get(event.id);
    if (!s) return;
    this.time = event.t ?? this.time;
    const p = event.point ?? event;
    s.position.set(p.x, p.y ?? 0.5, p.z);
    this.sample(s, true);
    s.alive = false;
    s.endedAt = this.time;
    this.active.delete(event.id);
  }
  matrix(batch, index, position, direction, scale) {
    this.pose.position.copy(position);
    this.pose.quaternion.setFromUnitVectors(UP, direction);
    this.pose.scale.set(scale.x, scale.y, scale.z);
    this.pose.updateMatrix();
    batch.setMatrixAt(index, this.pose.matrix);
  }
  sync(projectiles, time) {
    this.time = time;
    const seen = new Set();
    for (const p of projectiles) {
      seen.add(p.id);
      let s = this.active.get(p.id);
      if (!s) {
        s = this.allocate(p.id, p.kind, p.profile ?? weaponProfile(p.kind));
        if (!s) continue;
        s.origin = p.origin ?? { x: p.x, y: p.y ?? 0.5, z: p.z };
        s.bornAt = p.bornAt ?? time;
      }
      s.position.set(p.x, p.y ?? 0.5, p.z);
      s.velocity.set(p.vx, p.vy ?? 0, p.vz);
      if (s.velocity.lengthSq() > 1e-10) s.direction.copy(s.velocity).normalize();
      s.age = p.age ?? time - s.bornAt;
      s.ignitionAt = p.ignitionAt ?? s.profile.ignitionDelay ?? 0;
      s.guidanceAt = p.guidanceAt ?? s.profile.guidanceDelay ?? 0;
      s.phase = p.phase ?? 'flight';
      this.sample(s);
    }
    for (const [id, s] of this.active)
      if (!seen.has(id)) {
        s.alive = false;
        s.endedAt = time;
        this.active.delete(id);
      }
    let bullets = 0,
      missiles = 0,
      plumes = 0,
      fins = 0,
      lastTrail = -1;
    this.alphas.fill(0);
    for (const s of this.slots) {
      if (!s.used) continue;
      const p = s.profile;
      const fade = s.alive
        ? 1
        : Math.max(0, 1 - (time - s.endedAt) / (p.flight.trailLifetime ?? 1.5));
      if (!s.alive && (!fade || s.kind !== 'missile')) {
        s.used = false;
        continue;
      }
      if (s.alive) {
        const travelled = Math.hypot(
          s.position.x - s.origin.x,
          s.position.y - s.origin.y,
          s.position.z - s.origin.z,
        );
        const length = s.kind === 'cannon' ? Math.min(p.length, travelled) : p.length;
        this.center.copy(s.position).addScaledVector(s.direction, -length / 2);
        this.matrix(
          s.kind === 'missile' ? this.body : this.cannon,
          s.kind === 'missile' ? missiles++ : bullets++,
          this.center,
          s.direction,
          { x: p.diameter, y: Math.max(0.001, length), z: p.diameter },
        );
        if (s.kind !== 'missile') {
          this.color.set(p.flight.color).multiplyScalar(3);
          this.cannon.setColorAt(bullets - 1, this.color);
        }
        if (s.kind === 'missile' && s.phase !== 'ejection') {
          const deployment = 0.4 + 0.6 * T.MathUtils.clamp((s.age - s.guidanceAt) / 0.12, 0, 1);
          this.matrix(this.fins, fins++, this.center, s.direction, {
            x: p.diameter * deployment,
            y: length,
            z: p.diameter * deployment,
          });
          this.nozzle.copy(s.position).addScaledVector(s.direction, -length);
          const ignition = T.MathUtils.clamp((s.age - s.ignitionAt) / 0.1, 0, 1);
          this.matrix(this.exhaust, plumes++, this.nozzle, s.direction, {
            x: p.diameter * (1 + 2 * ignition),
            y: (p.flight.exhaustLength ?? 0.58) * (0.2 + 0.8 * ignition),
            z: p.diameter * (1 + 2 * ignition),
          });
        }
      }
      if (s.count < 2 || s.kind !== 'missile') continue;
      lastTrail = Math.max(lastTrail, s.slot);
      for (let i = 0; i < HISTORY; i++) {
        const j = Math.min(i, s.count - 1),
          h = (s.head - s.count + j + HISTORY) % HISTORY,
          h0 = (h - 1 + HISTORY) % HISTORY,
          h1 = (h + 1) % HISTORY;
        const before = j > 0 ? h0 : h,
          after = j < s.count - 1 ? h1 : h;
        const dx = s.history[after * 3] - s.history[before * 3],
          dz = s.history[after * 3 + 2] - s.history[before * 3 + 2],
          d = Math.hypot(dx, dz) || 1;
        const u = j / (s.count - 1),
          w = (p.flight.trailWidth ?? 0.045) * (1 + 1.1 * (1 - u));
        const x = s.history[h * 3],
          y = s.history[h * 3 + 1],
          z = s.history[h * 3 + 2],
          vertex = (s.slot * HISTORY + i) * 2;
        this.positions.set(
          [x - (dz / d) * w, y, z + (dx / d) * w, x + (dz / d) * w, y, z - (dx / d) * w],
          vertex * 3,
        );
        this.uvs.set([0, u, 1, u], vertex * 2);
        const alpha = i < s.count ? 0.3 * fade * (0.45 + 0.55 * u) : 0;
        this.alphas[vertex] = this.alphas[vertex + 1] = alpha;
      }
    }
    for (const [batch, count] of [
      [this.cannon, bullets],
      [this.body, missiles],
      [this.fins, fins],
      [this.exhaust, plumes],
    ]) {
      batch.count = count;
      batch.instanceMatrix.needsUpdate = true;
      if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
    }
    for (const attribute of Object.values(this.trails.geometry.attributes))
      attribute.needsUpdate = true;
    this.trails.geometry.setDrawRange(0, (lastTrail + 1) * (HISTORY - 1) * 6);
  }
  clear() {
    this.active.clear();
    this.time = 0;
    for (const s of this.slots) {
      s.used = false;
      s.alive = false;
      s.count = 0;
    }
    for (const batch of [this.cannon, this.body, this.fins, this.exhaust]) {
      batch.count = 0;
      batch.instanceMatrix.needsUpdate = true;
    }
    this.trails.geometry.setDrawRange(0, 0);
    this.alphas.fill(0);
    this.trails.geometry.attributes.opacity.needsUpdate = true;
  }
  dispose() {
    this.clear();
    for (const mesh of [this.cannon, this.body, this.fins, this.exhaust, this.trails]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
