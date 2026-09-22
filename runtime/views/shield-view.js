import * as T from '../../vendor/three.module.js';

export const SHIELD_IMPACT_CAPACITY = 8;

const WEAPON_PROFILE = Object.freeze({
  cannon: { type: 0, strength: 0.78 },
  pulse: { type: 1, strength: 0.68 },
  rail: { type: 2, strength: 1.0 },
  missile: { type: 3, strength: 1.15 },
});

export class ImpactSlotRing {
  constructor(capacity = SHIELD_IMPACT_CAPACITY) {
    this.capacity = capacity;
    this.cursor = 0;
  }

  take() {
    const slot = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    return slot;
  }

  clear() {
    this.cursor = 0;
  }
}

export class ShieldView {
  constructor({ parent = null, radii = { x: 5.2, y: 4.2, z: 5.9 } } = {}) {
    this.time = 0;
    this.strength = 0;
    this.slots = new ImpactSlotRing();
    const directions = Array.from({ length: SHIELD_IMPACT_CAPACITY }, () => new T.Vector3(0, 1, 0));
    const starts = new Float32Array(SHIELD_IMPACT_CAPACITY).fill(-1e6);
    const powers = new Float32Array(SHIELD_IMPACT_CAPACITY);
    const types = new Int32Array(SHIELD_IMPACT_CAPACITY);

    this.material = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      uniforms: {
        shieldStrength: { value: 0 },
        clock: { value: 0 },
        shieldBasis: { value: new T.Matrix3() },
        frameDelta: { value: 0 },
        impactDir: { value: directions },
        impactStart: { value: starts },
        impactPower: { value: powers },
        impactType: { value: types },
        impactShape: {
          value: Array.from(
            { length: SHIELD_IMPACT_CAPACITY },
            () => new T.Vector4(0.09, 2.2, 1.25, 0),
          ),
        },
        impactMix: {
          value: Array.from({ length: SHIELD_IMPACT_CAPACITY }, () => new T.Vector4(0, 0, 1, 0)),
        },
        impactCollapse: { value: new Float32Array(SHIELD_IMPACT_CAPACITY) },
        impactInstant: { value: new Float32Array(SHIELD_IMPACT_CAPACITY) },
      },
      vertexShader: `
        varying vec3 surfaceDirection;
        varying vec3 viewNormal;
        varying vec3 viewDirection;
        void main() {
          surfaceDirection = normalize(position);
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          viewNormal = normalize(normalMatrix * normal);
          viewDirection = normalize(-viewPosition.xyz);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        #define IMPACT_CAPACITY 8
        uniform float shieldStrength;
        uniform float clock;
        uniform mat3 shieldBasis;
        uniform float frameDelta;
        uniform vec3 impactDir[IMPACT_CAPACITY];
        uniform float impactStart[IMPACT_CAPACITY];
        uniform float impactPower[IMPACT_CAPACITY];
        uniform int impactType[IMPACT_CAPACITY];
        uniform vec4 impactShape[IMPACT_CAPACITY];
        uniform vec4 impactMix[IMPACT_CAPACITY];
        uniform float impactCollapse[IMPACT_CAPACITY];
        uniform float impactInstant[IMPACT_CAPACITY];
        varying vec3 surfaceDirection;
        varying vec3 viewNormal;
        varying vec3 viewDirection;

        void main() {
          float facing = clamp(1.0 - abs(dot(normalize(viewNormal), normalize(viewDirection))), 0.0, 1.0);
          float base = (pow(facing, 4.5) * .16 + pow(facing, 16.0) * .17 + .007) * shieldStrength;
          vec3 color = vec3(.055, .22, .47) * base;
          float collapse = 0.0;
          float radius = (length(shieldBasis[0]) + length(shieldBasis[1]) + length(shieldBasis[2])) / 3.0;

          for (int i = 0; i < IMPACT_CAPACITY; i++) {
            float age = clock - impactStart[i];
            vec4 shape = impactShape[i];
            if (age < 0.0 || age > shape.y || impactPower[i] <= 0.0) continue;
            vec4 channels = impactMix[i];
            float phase = age / max(shape.y, .12);
            float envelope = 1.0 - smoothstep(.55, 1.0, phase);
            float angle = acos(clamp(dot(normalize(surfaceDirection), normalize(impactDir[i])), -1.0, 1.0));
            float dwell = impactType[i] == 1 ? .12 : 0.0;
            float decay = channels.z * 8.0 + channels.w * 2.4 + channels.y * 3.1 + channels.x * 4.8;
            float coreDistance = angle / shape.x;
            float core = exp(-coreDistance * coreDistance) * exp(-max(0.0, age - dwell) * decay);
            float distanceFromContact = length(shieldBasis * (normalize(surfaceDirection) - normalize(impactDir[i])));
            float width = radius / (25.0 - channels.w * 10.0);
            // Swept exposure prevents a fast, correct-speed wave skipping between 30fps frames.
            // Its leading edge is always speed * age; trailing exposure never delays that edge.
            float front = age * shape.z;
            float back = max(0.0, age - frameDelta) * shape.z;
            float sweptDistance = max(back - distanceFromContact, max(distanceFromContact - front, 0.0));
            float ringDistance = sweptDistance / max(width,.001);
            float ring = exp(-ringDistance * ringDistance) * exp(-age * 2.2);
            if (impactInstant[i] > .5) { float q = (angle - shape.x * 1.5) * 25.0; ring = exp(-q * q) * exp(-age * 8.0); }
            else if (shape.z <= 0.0) ring = 0.0;
            // Analytic distortion and afterglow share this shell: no noise textures or extra meshes.
            float disturbance = sin(angle * 92.0 - age * 21.0) * sin(dot(surfaceDirection, vec3(19., 31., 23.)) + age * 13.0);
            float flicker = 1.0 + disturbance * shape.w * (.25 + channels.x * .45);
            float heatDistance = angle / (shape.x * 1.9);
            float heat = channels.y * exp(-heatDistance * heatDistance) * exp(-age * 2.4) * .22;
            vec3 weaponColor = impactType[i] == 1 ? vec3(1.4, .62, .18)
              : impactType[i] == 2 ? vec3(.42, 1.0, 1.8)
              : impactType[i] == 3 ? vec3(.35, .72, 1.35)
              : vec3(1.55, 1.05, .52);
            color += (weaponColor * core * .78 + vec3(.10,.40,.92) * ring * .13 * flicker + vec3(.85,.29,.08) * heat) * impactPower[i] * max(shieldStrength, .14) * envelope;
            collapse = max(collapse, impactCollapse[i] * smoothstep(0.0, .18, age));
          }
          gl_FragColor = vec4(color * (1.0 - collapse * .85), 1.0);
        }
      `,
    });
    this.mesh = new T.Mesh(new T.SphereGeometry(1, 64, 32), this.material);
    this.mesh.scale.set(radii.x, radii.y, radii.z);
    if (parent) parent.add(this.mesh);
  }

  setStrength(value) {
    this.strength = Math.max(0, Number(value) || 0);
    this.material.uniforms.shieldStrength.value = this.strength;
  }

  setTime(seconds) {
    this.time = Number(seconds) || 0;
    this.material.uniforms.clock.value = this.time;
  }

  update({ time = this.time, strength = this.strength } = {}) {
    if (time > this.time) this.material.uniforms.frameDelta.value = Math.min(0.1, time - this.time);
    this.mesh.updateWorldMatrix(true, false);
    this.material.uniforms.shieldBasis.value.setFromMatrix4(this.mesh.matrixWorld);
    this.setTime(time);
    this.setStrength(strength);
  }

  impact(localUnitDir, event = {}) {
    const profile = WEAPON_PROFILE[event.weapon] ?? WEAPON_PROFILE.cannon;
    const slot = this.slots.take();
    this.material.uniforms.impactDir.value[slot]
      .set(localUnitDir.x, localUnitDir.y, localUnitDir.z)
      .normalize();
    this.material.uniforms.impactStart.value[slot] = event.time ?? this.time;
    this.material.uniforms.impactPower.value[slot] = Math.max(
      0,
      event.strength ?? profile.strength,
    );
    this.material.uniforms.impactType.value[slot] = profile.type;
    const response = event.response;
    this.material.uniforms.impactPower.value[slot] =
      response?.power ?? this.material.uniforms.impactPower.value[slot];
    this.material.uniforms.impactShape.value[slot].set(
      response?.coreWidth ?? (profile.type === 3 ? 0.17 : 0.09),
      response?.duration ?? 2.2,
      response?.propagationSpeed ?? 0,
      response?.instability ?? 0,
    );
    const mix =
      event.damageMix ??
      (profile.type === 1
        ? { em: 0.62, thermal: 0.38, kinetic: 0, explosive: 0 }
        : profile.type === 3
          ? { em: 0, thermal: 0.1, kinetic: 0.2, explosive: 0.7 }
          : { em: 0, thermal: 0, kinetic: 1, explosive: 0 });
    this.material.uniforms.impactMix.value[slot].set(
      mix.em,
      mix.thermal,
      mix.kinetic,
      mix.explosive,
    );
    this.material.uniforms.impactCollapse.value[slot] = response?.collapse ?? 0;
    this.material.uniforms.impactInstant.value[slot] = response?.instantaneous ? 1 : 0;
    return slot;
  }

  clear() {
    this.slots.clear();
    this.material.uniforms.impactStart.value.fill(-1e6);
    this.material.uniforms.impactPower.value.fill(0);
    this.material.uniforms.impactCollapse.value.fill(0);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
