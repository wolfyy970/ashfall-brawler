import * as T from '../../vendor/three.module.js';

const MAX_EXPLOSIONS = 4;
const CARDS_PER_EXPLOSION = 13;
const DEBRIS_PER_EXPLOSION = 7;
const Z = new T.Vector3(0, 0, 1);

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const finite = (value, fallback) => (Number.isFinite(value) ? value : fallback);
const vec = (value, fallback) =>
  new T.Vector3(
    finite(value?.x, fallback.x),
    finite(value?.y, fallback.y),
    finite(value?.z, fallback.z),
  );

function rng(seed) {
  let state = finite(seed, 1) | 0 || 1;
  return () => {
    state = Math.imul(state ^ (state >>> 16), 0x21f0aaad);
    state = Math.imul(state ^ (state >>> 15), 0x735a2d97);
    return ((state ^= state >>> 15) >>> 0) / 4294967296;
  };
}

function setAlpha(mesh, index, value) {
  mesh.geometry.getAttribute('instanceAlpha').setX(index, value);
}

function cardMaterial() {
  return new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: T.NormalBlending,
    vertexColors: true,
    toneMapped: false,
    vertexShader: `
      attribute float instanceAlpha;
      attribute float instanceSeed;
      attribute float instancePhase;
      attribute float instanceVapor;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vSeed;
      varying float vPhase;
      varying float vVapor;
      void main() {
        vUv = uv;
        vColor = instanceColor;
        vAlpha = instanceAlpha;
        vSeed = instanceSeed;
        vPhase = instancePhase;
        vVapor = instanceVapor;
        vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float sx = length(instanceMatrix[0].xyz);
        float sy = length(instanceMatrix[1].xyz);
        center.xy += position.xy * vec2(sx, sy);
        gl_Position = projectionMatrix * center;
      }`,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vSeed;
      varying float vPhase;
      varying float vVapor;
      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float valueNoise(vec2 p) {
        vec2 cell = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float a = hash21(cell);
        float b = hash21(cell + vec2(1.0, 0.0));
        float c = hash21(cell + vec2(0.0, 1.0));
        float d = hash21(cell + vec2(1.0, 1.0));
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      void main() {
        vec2 q = clamp(vUv, 0.0, 1.0) * 2.0 - 1.0;
        float d = length(q);
        vec2 drift = vec2(vSeed * 13.7 + vPhase * 0.08, vSeed * 7.3 - vPhase * 0.04);
        float n1 = valueNoise(q * 2.15 + drift);
        float n2 = valueNoise(q * 4.35 - drift * 0.73);
        float n3 = valueNoise(q * 8.65 + drift * 1.31);
        float density = n1 * 0.57 + n2 * 0.29 + n3 * 0.14;
        float boundary = 0.73 + (density - 0.5) * (0.15 + vPhase * 0.04);
        float edge = 1.0 - smoothstep(boundary - 0.24, boundary, d);
        float d2 = dot(q, q);
        float hot = 1.0 - smoothstep(0.0, 0.42, d2);
        float body = mix(smoothstep(0.31, 0.57, density), 0.22 + density * 0.66, vVapor);
        float ridgeNoise = valueNoise(q * 6.7 + drift * 0.41);
        float ridge = smoothstep(0.91, 0.975, 1.0 - abs(ridgeNoise * 2.0 - 1.0));
        ridge *= (1.0 - smoothstep(0.28, 0.78, d)) * (1.0 - vVapor);
        vec3 color = vColor * (0.54 + hot * 1.42 + density * 0.28)
          + vec3(1.6, 0.48, 0.06) * ridge;
        gl_FragColor = vec4(color, edge * max(body, ridge * 0.72) * vAlpha);
      }`,
  });
}

function arcMaterial() {
  return new T.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: T.AdditiveBlending,
    vertexColors: true,
    toneMapped: false,
    vertexShader: `
      attribute float instanceAlpha;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vUv = uv; vColor = instanceColor; vAlpha = instanceAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        float segment = step(0.72, fract(vUv.x * 2.0 + 0.13));
        float filament = 1.0 - smoothstep(0.56, 0.98, abs(vUv.y * 2.0 - 1.0));
        gl_FragColor = vec4(vColor, vAlpha * segment * filament);
      }`,
  });
}

/** A bounded, pooled presentation of structural ship failure. */
export class DestructionView {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.cursor = 0;
    this.slots = Array.from({ length: MAX_EXPLOSIONS }, () => ({ active: false }));
    this.matrix = new T.Matrix4();
    this.quaternion = new T.Quaternion();
    this.scale = new T.Vector3();
    this.scratchPosition = new T.Vector3();
    this.scratchColor = new T.Color();
    this.scratchEuler = new T.Euler();

    const cardGeometry = new T.PlaneGeometry(2, 2);
    cardGeometry.setAttribute(
      'instanceAlpha',
      new T.InstancedBufferAttribute(new Float32Array(MAX_EXPLOSIONS * CARDS_PER_EXPLOSION), 1),
    );
    cardGeometry.setAttribute(
      'instanceSeed',
      new T.InstancedBufferAttribute(new Float32Array(MAX_EXPLOSIONS * CARDS_PER_EXPLOSION), 1),
    );
    for (const key of ['instancePhase', 'instanceVapor'])
      cardGeometry.setAttribute(
        key,
        new T.InstancedBufferAttribute(new Float32Array(MAX_EXPLOSIONS * CARDS_PER_EXPLOSION), 1),
      );
    this.cards = new T.InstancedMesh(
      cardGeometry,
      cardMaterial(),
      MAX_EXPLOSIONS * CARDS_PER_EXPLOSION,
    );

    const arcGeometry = new T.TorusGeometry(1, 0.018, 3, 40);
    arcGeometry.setAttribute(
      'instanceAlpha',
      new T.InstancedBufferAttribute(new Float32Array(MAX_EXPLOSIONS), 1),
    );
    this.arcs = new T.InstancedMesh(arcGeometry, arcMaterial(), MAX_EXPLOSIONS);

    const debrisGeometry = new T.TetrahedronGeometry(0.5, 0);
    const debrisMaterial = new T.MeshBasicMaterial({ vertexColors: true, color: 0xffffff });
    this.debris = new T.InstancedMesh(
      debrisGeometry,
      debrisMaterial,
      MAX_EXPLOSIONS * DEBRIS_PER_EXPLOSION,
    );
    for (const mesh of [this.cards, this.arcs, this.debris]) {
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      mesh.frustumCulled = false;
      scene.add(mesh);
    }
    this.clear();
  }

  explode(event = {}) {
    const index = this.cursor++ % MAX_EXPLOSIONS;
    const random = rng(event.seed);
    const radius = clamp(finite(event.radius, 1.2), 0.15, 50);
    const length = clamp(finite(event.length, radius * 3.5), radius * 1.25, radius * 12);
    const point = vec(event.point, new T.Vector3());
    const forward = vec(event.forward, Z).normalize();
    if (forward.lengthSq() < 0.5) forward.copy(Z);
    const velocity = vec(event.velocity, new T.Vector3());
    const mix = event.damageMix ?? {};
    const thermal = clamp(finite(mix.thermal, 0.25), 0, 1);
    const explosive = clamp(finite(mix.explosive, 0.25), 0, 1);
    const em = clamp(finite(mix.em, 0.25), 0, 1);
    const lifetime = 1.45 + radius * 0.035 + explosive * 0.28;
    const slot = {
      active: true,
      index,
      start: finite(event.t, this.time),
      radius,
      length,
      lifetime,
      point,
      forward,
      velocity,
      thermal,
      explosive,
      em,
      cards: [],
      debris: [],
    };
    const side = new T.Vector3(random() - 0.5, random() - 0.5, random() - 0.5);
    side.addScaledVector(forward, -side.dot(forward)).normalize();
    if (side.lengthSq() < 0.5) side.set(1, 0, 0);
    for (let i = 0; i < CARDS_PER_EXPLOSION; i++) {
      const axial = (random() - 0.5) * length * (i < 3 ? 0.14 : 0.72);
      const lateral = (random() - 0.5) * radius * (i < 3 ? 0.3 : 1.15);
      slot.cards.push({
        offset: forward.clone().multiplyScalar(axial).addScaledVector(side, lateral),
        delay: i < 2 ? 0 : i < 5 ? 0.09 + random() * 0.24 : random() * 0.18,
        life: i < 2 ? 0.25 : i < 8 ? 0.72 + random() * 0.32 : lifetime,
        size: radius * (i < 2 ? 0.72 : i < 8 ? 0.42 + random() * 0.48 : 0.58 + random() * 0.42),
        aspect: 0.82 + random() * 0.4,
        vapor: i >= 8,
        seed: random(),
      });
    }
    for (let i = 0; i < DEBRIS_PER_EXPLOSION; i++) {
      const outward = new T.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
      slot.debris.push({
        offset: forward.clone().multiplyScalar((random() - 0.5) * length * 0.42),
        velocity: outward
          .multiplyScalar(radius * (0.8 + random() * 1.7))
          .addScaledVector(forward, (random() - 0.36) * radius * 2.2),
        spin: new T.Vector3(random() * 5, random() * 7, random() * 6),
        size: radius * (0.055 + random() * 0.09),
      });
    }
    this.slots[index] = slot;
    this.update(this.time);
    return index;
  }

  update(time) {
    this.time = finite(time, this.time);
    if (!this.slots.some((slot) => slot.active)) return;
    let activeCount = 0;
    for (let s = 0; s < MAX_EXPLOSIONS; s++) {
      const slot = this.slots[s];
      const age = slot.active ? this.time - slot.start : Infinity;
      if (slot.active && age > slot.lifetime) slot.active = false;
      const active = slot.active && age >= 0;
      if (slot.active) activeCount++;
      for (let i = 0; i < CARDS_PER_EXPLOSION; i++) {
        const at = s * CARDS_PER_EXPLOSION + i;
        const card = slot.cards?.[i];
        const localAge = active && card ? age - card.delay : -1;
        const k = localAge >= 0 ? clamp(localAge / card.life, 0, 1) : 1;
        let alpha =
          localAge >= 0 && localAge < card.life ? (1 - k) * (card.vapor ? 0.34 : 0.88) : 0;
        if (!card) alpha = 0;
        const position = this.scratchPosition.set(0, 0, 0);
        if (active && card) {
          position
            .copy(slot.point)
            .addScaledVector(slot.velocity, Math.max(age, 0))
            .add(card.offset);
          if (card.vapor) position.addScaledVector(slot.forward, localAge * slot.radius * 0.34);
        }
        const size = card ? card.size * (card.vapor ? 0.72 + k * 0.72 : 0.38 + k * 0.82) : 0;
        this.matrix.compose(
          position,
          this.quaternion.identity(),
          active
            ? this.scale.set(size * card.aspect, size / card.aspect, size)
            : this.scale.set(0, 0, 0),
        );
        this.cards.setMatrixAt(at, this.matrix);
        if (card?.vapor) this.scratchColor.setRGB(0.12 + slot.thermal * 0.05, 0.095, 0.075);
        else if (localAge < 0.075) this.scratchColor.setRGB(3.2, 2.8, 2.25);
        else this.scratchColor.setRGB(2.05, 0.38 + (slot.thermal ?? 0) * 0.38, 0.065);
        this.cards.setColorAt(at, this.scratchColor);
        setAlpha(this.cards, at, alpha);
        this.cards.geometry.getAttribute('instanceSeed').setX(at, card?.seed ?? 0);
        this.cards.geometry.getAttribute('instancePhase').setX(at, card ? k : 0);
        this.cards.geometry.getAttribute('instanceVapor').setX(at, card?.vapor ? 1 : 0);
      }

      const arcAlpha =
        active && age < 0.3 ? Math.sin((age / 0.3) * Math.PI) * (0.22 + slot.em * 0.28) : 0;
      const arcRadius = slot.radius * (0.48 + clamp(age / 0.3, 0, 1) * 1.65);
      this.quaternion.setFromUnitVectors(Z, slot.forward ?? Z);
      this.matrix.compose(
        slot.point ?? this.scratchPosition.set(0, 0, 0),
        this.quaternion,
        this.scale.setScalar(active ? arcRadius : 0),
      );
      this.arcs.setMatrixAt(s, this.matrix);
      this.arcs.setColorAt(s, this.scratchColor.setRGB(0.58, 0.77 + (slot.em ?? 0) * 0.35, 1.35));
      setAlpha(this.arcs, s, arcAlpha);

      for (let i = 0; i < DEBRIS_PER_EXPLOSION; i++) {
        const at = s * DEBRIS_PER_EXPLOSION + i;
        const bit = slot.debris?.[i];
        const visible = active && age > 0.07 && bit;
        const p = this.scratchPosition.set(0, 0, 0);
        if (visible)
          p.copy(slot.point)
            .add(bit.offset)
            .addScaledVector(slot.velocity, age)
            .addScaledVector(bit.velocity, Math.max(age - 0.07, 0));
        if (visible)
          this.quaternion.setFromEuler(
            this.scratchEuler.set(bit.spin.x * age, bit.spin.y * age, bit.spin.z * age),
          );
        else this.quaternion.identity();
        const size = visible ? bit.size * clamp((slot.lifetime - age) * 2, 0, 1) : 0;
        this.matrix.compose(p, this.quaternion, this.scale.set(size * 0.45, size, size * 0.22));
        this.debris.setMatrixAt(at, this.matrix);
        const hot = i % 3 === 0 && age < 0.55;
        this.debris.setColorAt(
          at,
          this.scratchColor.setRGB(hot ? 2.4 : 0.18, hot ? 0.72 : 0.16, hot ? 0.14 : 0.14),
        );
      }
    }
    for (const mesh of [this.cards, this.arcs, this.debris]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const mesh of [this.cards, this.arcs])
      mesh.geometry.getAttribute('instanceAlpha').needsUpdate = true;
    for (const key of ['instanceSeed', 'instancePhase', 'instanceVapor'])
      this.cards.geometry.getAttribute(key).needsUpdate = true;
    const visible = activeCount > 0;
    for (const mesh of [this.cards, this.arcs, this.debris]) mesh.visible = visible;
  }

  get stats() {
    return {
      active: this.slots.filter((slot) => slot.active).length,
      capacity: MAX_EXPLOSIONS,
      draws: this.cards.visible ? 3 : 0,
      cards: MAX_EXPLOSIONS * CARDS_PER_EXPLOSION,
      debris: MAX_EXPLOSIONS * DEBRIS_PER_EXPLOSION,
    };
  }

  clear() {
    this.time = 0;
    this.cursor = 0;
    this.slots = Array.from({ length: MAX_EXPLOSIONS }, () => ({ active: false }));
    this.matrix.compose(
      this.scratchPosition.set(0, 0, 0),
      this.quaternion.identity(),
      this.scale.set(0, 0, 0),
    );
    for (let i = 0; i < this.cards.count; i++) {
      this.cards.setMatrixAt(i, this.matrix);
      setAlpha(this.cards, i, 0);
      this.cards.geometry.getAttribute('instanceSeed').setX(i, 0);
      this.cards.geometry.getAttribute('instancePhase').setX(i, 0);
      this.cards.geometry.getAttribute('instanceVapor').setX(i, 0);
    }
    for (let i = 0; i < this.arcs.count; i++) {
      this.arcs.setMatrixAt(i, this.matrix);
      setAlpha(this.arcs, i, 0);
    }
    for (let i = 0; i < this.debris.count; i++) this.debris.setMatrixAt(i, this.matrix);
    for (const mesh of [this.cards, this.arcs, this.debris]) {
      mesh.visible = false;
      mesh.instanceMatrix.needsUpdate = true;
    }
    for (const mesh of [this.cards, this.arcs])
      mesh.geometry.getAttribute('instanceAlpha').needsUpdate = true;
    for (const key of ['instanceSeed', 'instancePhase', 'instanceVapor'])
      this.cards.geometry.getAttribute(key).needsUpdate = true;
  }

  dispose() {
    this.clear();
    for (const mesh of [this.cards, this.arcs, this.debris]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
}
