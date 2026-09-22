import * as T from '../../vendor/three.module.js';
import { setShipRootMatrixFromPose } from './ship-surface-query.js';

/** Bounded surface contact study. One instanced draw; no physics or per-hit lights. */
export class HullImpactView {
  constructor(scene, capacity = 32) {
    this.cursor = 0;
    this.capacity = capacity;
    this.geometry = new T.PlaneGeometry(1, 1);
    this.timing = new T.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.channels = new T.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.geometry.setAttribute('contactTiming', this.timing);
    this.geometry.setAttribute('contactChannels', this.channels);
    this.material = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      uniforms: { clock: { value: 0 } },
      vertexShader: `
        attribute vec4 contactTiming; attribute vec4 contactChannels;
        varying vec2 vUv; varying vec4 timing; varying vec4 channels;
        void main() { vUv=uv; timing=contactTiming; channels=contactChannels;
          gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.); }
      `,
      fragmentShader: `
        uniform float clock; varying vec2 vUv; varying vec4 timing; varying vec4 channels;
        void main() {
          float age=clock-timing.x;
          if(age<0. || age>timing.y || timing.z<=0.) discard;
          vec2 p=(vUv-.5)*2.; float r=length(p);
          float edge=1.-smoothstep(.55,1.,r);
          if(edge<.001) discard;
          float phase=age/timing.y;
          float mechanical=channels.z+channels.w;
          float crater=exp(-r*r*18.);
          float lipDistance=(r-.32)*10.;
          float lip=exp(-lipDistance*lipDistance)*mechanical;
          float thermal=exp(-r*r*4.)*(channels.y+channels.x*.35);
          float heat=exp(-age*(7.-channels.y*4.))*(thermal+lip*.9);
          vec3 color=mix(vec3(.045,.038,.032),vec3(.008,.011,.014),crater*mechanical);
          color+=vec3(3.0,.77,.13)*heat*timing.z;
          float fade=1.-smoothstep(.6,1.,phase);
          gl_FragColor=vec4(color,edge*fade*(.45+.4*timing.z));
        }
      `,
    });
    this.mesh = new T.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.transform = new T.Object3D();
    this.normal = new T.Vector3();
    this.forward = new T.Vector3(0, 0, 1);
    this.hulls = new Map();
    this.anchors = Array.from({ length: capacity }, () => null);
    this.inverseHull = new T.Matrix4();
    this.worldMatrix = new T.Matrix4();
    scene.add(this.mesh);
    this.clear();
  }
  registerHull(shipId, root, getPose) {
    if (root) this.hulls.set(shipId, { root, getPose, scale: root.scale.clone() });
    else this.hulls.delete(shipId);
  }
  resolveHullMatrix(hull, target) {
    if (hull.getPose) {
      const pose = hull.getPose();
      if (!pose || pose.alive === false) return null;
      return setShipRootMatrixFromPose(target, pose, hull.scale);
    }
    if (!hull.root.visible) return null;
    hull.root.updateWorldMatrix(true, false);
    return target.copy(hull.root.matrixWorld);
  }
  impact(event) {
    const r = event.response;
    if (!r || event.shield || event.damage <= 0) return;
    const slot = this.cursor++ % this.capacity;
    const c = event.receiving.damageMix;
    this.normal.set(event.normal.x, event.normal.y, event.normal.z).normalize();
    this.transform.position
      .set(event.point.x, event.point.y, event.point.z)
      .addScaledVector(this.normal, 0.002);
    this.transform.quaternion.setFromUnitVectors(this.forward, this.normal);
    this.transform.scale.setScalar(
      Math.min(0.75, (event.profile?.impact.size ?? 1) * 0.24 * r.flashScale),
    );
    this.transform.updateMatrix();
    const shipId = event.ship ?? event.shipId ?? event.targetId;
    const hull = this.hulls.get(shipId);
    if (hull) {
      const hullMatrix = this.resolveHullMatrix(hull, this.worldMatrix);
      if (!hullMatrix) {
        this.anchors[slot] = null;
        this.timing.setXYZW(slot, -1e6, 0, 0, 0);
        return;
      }
      this.inverseHull.copy(hullMatrix).invert();
      this.anchors[slot] = {
        hull,
        localMatrix: this.inverseHull.clone().multiply(this.transform.matrix),
      };
      this.mesh.setMatrixAt(slot, hullMatrix.clone().multiply(this.anchors[slot].localMatrix));
    } else {
      this.anchors[slot] = null;
      this.mesh.setMatrixAt(slot, this.transform.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.timing.setXYZW(
      slot,
      event.t ?? this.material.uniforms.clock.value,
      Math.min(2.2, r.duration * 1.6),
      r.power,
      0,
    );
    this.channels.setXYZW(slot, c.em, c.thermal, c.kinetic, c.explosive);
    this.timing.needsUpdate = this.channels.needsUpdate = true;
    this.mesh.visible = true;
  }
  update(time) {
    this.material.uniforms.clock.value = time;
    this.mesh.visible = false;
    let moved = false;
    for (let i = 0; i < this.capacity; i++) {
      const age = time - this.timing.getX(i);
      if (age >= 0 && age < this.timing.getY(i)) {
        this.mesh.visible = true;
        const anchor = this.anchors[i];
        if (anchor) {
          const hullMatrix = this.resolveHullMatrix(anchor.hull, this.worldMatrix);
          if (hullMatrix) hullMatrix.multiply(anchor.localMatrix);
          else this.worldMatrix.makeScale(0, 0, 0);
          this.mesh.setMatrixAt(i, this.worldMatrix);
          moved = true;
        }
      }
    }
    if (moved) this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() {
    this.cursor = 0;
    for (let i = 0; i < this.capacity; i++) {
      this.timing.setXYZW(i, -1e6, 0, 0, 0);
      this.anchors[i] = null;
    }
    this.timing.needsUpdate = true;
    this.mesh.visible = false;
  }
  dispose() {
    this.hulls.clear();
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
