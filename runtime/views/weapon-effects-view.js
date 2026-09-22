import * as T from 'three';
import { ProjectileView } from './projectile-view.js';
import { HullImpactView } from './hull-impact-view.js';
import { DestructionView } from './destruction-view.js';
const Y = new T.Vector3(0, 1, 0),
  tmp = new T.Vector3();
export class WeaponEffectsView {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.maxItems = 128;
    this.maxProjectiles = 64;
    this.projectileView = new ProjectileView(scene);
    this.hullImpacts = new HullImpactView(scene);
    this.destruction = new DestructionView(scene);
    this.projectiles = this.projectileView.active;
    this.clock = 0;
    this.pool = [];
    this.capacity = 1600;
    this.cursor = 0;
    this.pos = new Float32Array(this.capacity * 3);
    this.colors = new Float32Array(this.capacity * 3);
    this.sizes = new Float32Array(this.capacity);
    this.alpha = new Float32Array(this.capacity);
    this.g = new T.BufferGeometry();
    this.g.setAttribute(
      'position',
      new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage),
    );
    this.g.setAttribute('color', new T.BufferAttribute(this.colors, 3));
    this.g.setAttribute('size', new T.BufferAttribute(this.sizes, 1));
    this.g.setAttribute('alpha', new T.BufferAttribute(this.alpha, 1));
    this.pmat = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      vertexColors: true,
      uniforms: { pixel: { value: 15 } },
      vertexShader:
        'attribute float size;attribute float alpha;varying vec3 c;varying float a;uniform float pixel;void main(){c=color;a=alpha;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_PointSize=size*pixel;}',
      fragmentShader:
        'varying vec3 c;varying float a;void main(){float d=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(c,a*exp(-d*d*5.)*(1.-smoothstep(.7,1.,d)));}',
    });
    this.points = new T.Points(this.g, this.pmat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.cylinder = new T.CylinderGeometry(1, 1, 1, 5);
    const positions = [],
      uvs = [];
    for (let plane = 0; plane < 3; plane++) {
      const angle = (plane * Math.PI) / 3;
      for (const [x, y] of [
        [-1, 0],
        [1, 0],
        [1, 1],
        [-1, 0],
        [1, 1],
        [-1, 1],
      ]) {
        positions.push(x * Math.cos(angle), y, x * Math.sin(angle));
        uvs.push((x + 1) / 2, y);
      }
    }
    this.muzzleGeometry = new T.BufferGeometry();
    this.muzzleGeometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    this.muzzleGeometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  }

  registerHull(shipId, root, getPose) {
    this.hullImpacts.registerHull(shipId, root, getPose);
  }

  glint(p, cold = false, size = 1.5, life = 0.19) {
    if (this.items.length >= this.maxItems) return;
    if (!this.glintMaps) {
      this.glintMaps = [false, true].map((c) => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 128;
        const ctx = canvas.getContext('2d');
        ctx.translate(64, 64);
        const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 61);
        glow.addColorStop(0, 'rgba(255,255,255,1)');
        glow.addColorStop(0.045, 'rgba(255,255,255,1)');
        glow.addColorStop(0.12, c ? 'rgba(130,203,255,.7)' : 'rgba(255,188,101,.75)');
        glow.addColorStop(0.35, c ? 'rgba(68,141,220,.14)' : 'rgba(195,101,30,.14)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(-64, -64, 128, 128);
        ctx.rotate(0.32);
        for (let i = 0; i < 4; i++) {
          ctx.rotate(Math.PI / 2);
          const g = ctx.createLinearGradient(0, 0, 0, 48);
          g.addColorStop(0, 'rgba(255,255,255,1)');
          g.addColorStop(0.15, 'rgba(255,244,222,.8)');
          g.addColorStop(1, 'rgba(255,240,208,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(-2.4, 0);
          ctx.lineTo(0, i % 2 ? 35 : 50);
          ctx.lineTo(2.4, 0);
          ctx.closePath();
          ctx.fill();
        }
        const tex = new T.CanvasTexture(canvas);
        tex.colorSpace = T.SRGBColorSpace;
        return tex;
      });
    }
    const mat = new T.SpriteMaterial({
      map: this.glintMaps[cold ? 1 : 0],
      color: new T.Color(3.2, 3.0, 2.7),
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
    });
    const sprite = new T.Sprite(mat);
    sprite.position.copy(p);
    sprite.scale.setScalar(size);
    this.scene.add(sprite);
    this.items.push({ object: sprite, life, max: life, kind: 'glint', size });
  }

  launch(event) {
    const p = event.profile,
      origin = new T.Vector3(event.origin.x, event.origin.y, event.origin.z);
    const dir = new T.Vector3(event.direction.x, event.direction.y, event.direction.z);
    if (p.mode === 'projectile') this.projectileView.begin(event);
    if (p.launch.size > 0)
      this.glint(origin, event.weapon === 'rail', p.launch.size, p.launch.duration);
    if (event.weapon === 'cannon') {
      this.muzzleFlash(origin, dir, p.launch);
    } else if (event.weapon === 'missile') {
      for (let i = 0; i < 3; i++)
        this.particle(
          origin,
          dir.clone().multiplyScalar(-0.6 - i * 0.2),
          0xd7b893,
          0.055 + i * 0.025,
          0.13 + i * 0.04,
        );
    }
  }
  muzzleFlash(origin, direction, launch) {
    if (this.items.length >= this.maxItems) return;
    const material = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      blending: T.AdditiveBlending,
      uniforms: { fade: { value: 1 } },
      vertexShader:
        'varying vec2 v; void main(){v=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:
        'varying vec2 v;uniform float fade;void main(){float t=v.y;float width=(.28+.72*sin(t*3.14159))*pow(1.-t,.6);float cross=abs(v.x*2.-1.)/max(width,.001);float a=exp(-cross*cross*5.)*pow(1.-t,1.7)*(1.-smoothstep(.65,1.,cross))*fade;vec3 c=mix(vec3(2.6,1.05,.25),vec3(4.,3.7,2.6),exp(-cross*cross*18.)*(1.-t));gl_FragColor=vec4(c,a);}',
    });
    const mesh = new T.Mesh(this.muzzleGeometry, material);
    mesh.position.copy(origin);
    mesh.quaternion.setFromUnitVectors(Y, direction);
    mesh.scale.set(
      (launch.flashRadius ?? 0.006) * 4,
      launch.flashLength ?? 0.14,
      (launch.flashRadius ?? 0.006) * 4,
    );
    this.scene.add(mesh);
    const life = launch.duration * 0.65;
    this.items.push({ object: mesh, life, max: life, kind: 'muzzle' });
  }
  finishProjectile(event) {
    this.projectileView.end(event);
  }
  destroy(event) {
    this.destruction.explode(event);
  }
  impact(event) {
    const p = event.profile?.impact ?? { size: 1.4, duration: 0.25, particles: 7 };
    const response = event.response;
    if (response && response.power <= 0) return;
    const channels = event.receiving?.damageMix;
    const point = new T.Vector3(event.point.x, event.point.y, event.point.z);
    this.glint(
      point,
      Boolean(event.shield),
      p.size * (response?.flashScale ?? 1),
      Math.min(0.5, response?.duration ?? p.duration),
    );
    this.hullImpacts.impact(event);
    const normal = new T.Vector3(event.normal.x, event.normal.y, event.normal.z);
    const incoming = new T.Vector3(event.incomingDir.x, event.incomingDir.y, event.incomingDir.z);
    const reflected = incoming.reflect(normal).normalize();
    // Thermal/EM contacts shed little solid-looking debris; kinetic/explosive hits eject more.
    const count = response
      ? Math.min(
          32,
          Math.round(
            response.particleCount *
              (channels ? 0.12 + channels.kinetic * 0.85 + channels.explosive * 0.7 : 1),
          ),
        )
      : p.particles;
    for (let i = 0; i < count; i++) {
      const velocity = new T.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .multiplyScalar(event.kind === 'missile' ? 1.4 : 0.7)
        .addScaledVector(reflected, event.kind === 'missile' ? 0.9 : 1.7);
      if (velocity.dot(normal) < 0) velocity.reflect(normal);
      this.particle(
        point,
        velocity,
        event.shield ? (i % 3 ? 0x79bafa : 0xffd7a1) : 0xffbe70,
        event.kind === 'missile' ? 0.1 : 0.045,
        0.2 + Math.random() * 0.4,
      );
    }
  }
  particle(p, v, color, size, life) {
    const i = this.cursor++ % this.capacity;
    const c = new T.Color(color);
    this.pool[i] = { p: p.clone(), v: v.clone(), size, life, max: life };
    this.colors.set([c.r, c.g, c.b], i * 3);
  }
  burst(p, big = false, blue = false) {
    for (let j = 0; j < (big ? 100 : 7); j++) {
      const v = new T.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.5, Math.random() - 0.5)
        .normalize()
        .multiplyScalar((big ? 6 : 1.8) * Math.random());
      this.particle(
        p,
        v,
        blue ? 0x8ccaff : j % 3 ? 0xffa24b : 0xffedc1,
        (big ? 0.3 : 0.07) + Math.random() * 0.13,
        (big ? 1.8 : 0.55) + Math.random() * 0.5,
      );
    }
    if (big) this.ring(p, 0xffaa58, 2.2, 9);
  }
  beam(a, b, color, life = 0.16, width = 0.025) {
    if (this.items.length >= this.maxItems) return;
    const group = new T.Group(),
      outer = new T.Mesh(
        this.cylinder,
        new T.MeshBasicMaterial({
          color: new T.Color(color).multiplyScalar(0.8),
          transparent: true,
          opacity: 0.18,
          blending: T.AdditiveBlending,
          depthWrite: false,
        }),
      ),
      inner = new T.Mesh(
        this.cylinder,
        new T.MeshBasicMaterial({
          color: new T.Color(color).multiplyScalar(1.25),
          transparent: true,
          depthWrite: false,
        }),
      );
    const len = a.distanceTo(b);
    group.position.copy(a).add(b).multiplyScalar(0.5);
    group.quaternion.setFromUnitVectors(Y, tmp.copy(b).sub(a).normalize());
    outer.scale.set(width * 4, len, width * 4);
    inner.scale.set(width, len, width);
    group.add(outer, inner);
    this.scene.add(group);
    this.items.push({ object: group, life, max: life, kind: 'beam' });
  }
  ring(p, color, life = 1, radius = 4) {
    if (this.items.length >= this.maxItems) return;
    const mesh = new T.Mesh(
      new T.RingGeometry(0.94, 1, 64),
      new T.MeshBasicMaterial({
        color: new T.Color(color).multiplyScalar(2),
        transparent: true,
        opacity: 0.6,
        side: T.DoubleSide,
        depthWrite: false,
        blending: T.AdditiveBlending,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(p);
    this.scene.add(mesh);
    this.items.push({ object: mesh, life, max: life, kind: 'ring', radius });
  }
  web(a, b) {
    if (this.items.length >= this.maxItems) return;
    const pts = [];
    for (let j = 0; j < 40; j++) {
      const u = j / 39;
      pts.push(
        a
          .clone()
          .lerp(b, u)
          .add(new T.Vector3(Math.sin(u * 35) * 0.18, Math.sin(u * 22) * 0.2, 0)),
      );
    }
    const line = new T.Line(
      new T.BufferGeometry().setFromPoints(pts),
      new T.LineBasicMaterial({
        color: 0x9675bf,
        transparent: true,
        opacity: 0.55,
        blending: T.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.scene.add(line);
    this.items.push({ object: line, life: 0.7, max: 0.7, kind: 'line' });
    this.ring(b, 0x806ca1, 1.1, 3.8);
  }
  update(dt, sim) {
    this.hullImpacts.update(sim.time);
    this.destruction.update(sim.time);
    for (let i = 0; i < this.capacity; i++) {
      const p = this.pool[i];
      if (!p || p.life <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      p.life -= dt;
      p.p.addScaledVector(p.v, dt);
      this.pos.set(p.p.toArray(), i * 3);
      this.alpha[i] = Math.max(0, p.life / p.max);
      this.sizes[i] = p.size;
    }
    for (const key of ['position', 'color', 'size', 'alpha'])
      this.g.attributes[key].needsUpdate = true;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const e = this.items[i];
      e.life -= dt;
      const k = Math.max(0, e.life / e.max);
      e.object.traverse((o) => {
        if (o.material) {
          o.material.opacity =
            e.kind === 'glint' ? Math.pow(k, 1.4) : (e.kind === 'beam' ? 0.42 : 0.55) * k;
          if (e.kind === 'muzzle') o.material.uniforms.fade.value = k;
          if (e.kind === 'trail') o.material.uniforms.opacity.value = 0.32 * k;
        }
      });
      if (e.kind === 'glint') e.object.scale.setScalar(e.size * (0.6 + 0.4 * k));
      if (e.kind === 'ring') e.object.scale.setScalar((1 - k) * e.radius + 0.3);
      if (e.life <= 0) {
        this.scene.remove(e.object);
        e.object.traverse((o) => {
          if (o.material) o.material.dispose();
          if (
            o.geometry &&
            !o.isSprite &&
            o.geometry !== this.cylinder &&
            o.geometry !== this.muzzleGeometry
          )
            o.geometry.dispose();
        });
        this.items.splice(i, 1);
      }
    }
    this.clock = sim.time ?? this.clock + dt;
    this.projectileView.sync(sim.shots, this.clock);
  }

  clear() {
    this.hullImpacts.clear();
    this.destruction.clear();
    this.clock = 0;
    for (const e of this.items) {
      this.scene.remove(e.object);
      e.object.traverse((o) => {
        o.material?.dispose();
        if (
          o.geometry &&
          !o.isSprite &&
          o.geometry !== this.cylinder &&
          o.geometry !== this.muzzleGeometry
        )
          o.geometry.dispose();
      });
    }
    this.items = [];
    this.projectileView.clear();
    this.pool = [];
    this.alpha.fill(0);
    this.g.attributes.alpha.needsUpdate = true;
  }
  dispose() {
    this.hullImpacts.dispose();
    this.destruction.dispose();
    this.clear();
    this.projectileView.dispose();
    this.points.removeFromParent();
    this.g.dispose();
    this.pmat.dispose();
    this.cylinder.dispose();
    this.muzzleGeometry.dispose();
    for (const texture of this.glintMaps ?? []) texture.dispose();
  }
}
