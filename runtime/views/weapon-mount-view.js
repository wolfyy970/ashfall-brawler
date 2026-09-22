import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createWeapon } from './prototype-turret-view.js';
import { mergeRigGeometry } from './rig-geometry.js';
import { METRES_PER_WORLD_UNIT } from '../model/weapon-profiles.js';
const navalAssets = new Map();
const dto = (p) => ({ x: p.x, y: p.y, z: p.z });
/** Renderer-side rig. Supplies immutable rest geometry; consumes model poses and fire events. */
export class WeaponMountView {
  constructor(root, { yaw, pitch, muzzles, recoils = [] }) {
    this.root = root;
    this.yaw = yaw;
    this.pitch = pitch;
    this.muzzles = muzzles;
    this.recoils = recoils;
    if (!muzzles.length) throw new Error('No physical muzzle nodes');
    this.rest = recoils.map((o) => o.position.clone());
    this.recoilAt = recoils.map(() => -Infinity);
    this.kick = recoils.map(() => 0);
    this.scratch = new T.Vector3();
    this.root.userData.weaponView = this;
  }
  definition(displayScale = 1) {
    this.root.updateWorldMatrix(true, true);
    const local = (o) => dto(this.root.worldToLocal(o.getWorldPosition(new T.Vector3())));
    const q = this.root.quaternion;
    this.recoilScale = this.recoils.map(
      (o) => o.getWorldScale(new T.Vector3()).x / this.root.getWorldScale(new T.Vector3()).x,
    );
    return {
      position: dto(this.root.position),
      quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
      displayScale,
      yawOrigin: local(this.yaw),
      pitchOrigin: local(this.pitch),
      minElevation: -0.14,
      maxElevation: 0.7,
      muzzles: this.muzzles.map((o) => ({ id: o.name, position: local(o) })),
    };
  }
  applyPose(pose) {
    if (!pose) return;
    this.yaw.rotation.y = pose.yaw;
    this.pitch.rotation.x = pose.pitch;
  }
  fire(event) {
    const i = event.muzzleIndex;
    if (!this.recoils[i]) return;
    this.recoilAt[i] = event.t;
    this.kick[i] = (event.profile.launch.recoil ?? 0) / (this.recoilScale[i] || 1);
  }
  update(time) {
    for (let i = 0; i < this.recoils.length; i++) {
      const age = Math.max(0, time - this.recoilAt[i]),
        k = Math.min(1, age / 0.24);
      this.recoils[i].position.copy(this.rest[i]);
      this.recoils[i].position.z += this.kick[i] * Math.min(1, k / 0.1) * (1 - k) * (1 - k);
    }
  }
  muzzlePosition(i) {
    this.root.updateWorldMatrix(true, true);
    return this.muzzles[i].getWorldPosition(this.scratch);
  }
  reset() {
    this.recoilAt.fill(-Infinity);
    this.kick.fill(0);
    this.update(0);
  }
}
export async function createEquippedWeapon(kind, options = {}) {
  let root, parts;
  if (kind === 'cannon' || kind === 'rail') {
    const count = options.barrels ?? (kind === 'rail' ? 2 : 4);
    if (![2, 4].includes(count)) throw new Error('Authored naval rigs support two or four barrels');
    if (!navalAssets.has(count))
      navalAssets.set(
        count,
        new GLTFLoader().loadAsync(
          new URL(
            '../../assets/naval-small-' + count + '.glb',
            import.meta.url,
          ).href,
        ),
      );
    const asset = (await navalAssets.get(count)).scene.clone(true);
    asset.scale.setScalar(1 / METRES_PER_WORLD_UNIT);
    root = new T.Group();
    root.name = 'SMALL_NAVAL_' + count + '_' + kind.toUpperCase();
    root.add(asset);
    parts = {
      yaw: asset.getObjectByName('Yaw_Pivot'),
      pitch: asset.getObjectByName('Pitch_Pivot'),
      muzzles: Array.from({ length: count }, (_, i) => asset.getObjectByName('MUZZLE_' + (i + 1))),
      recoils: Array.from({ length: count }, (_, i) => asset.getObjectByName('Recoil_' + (i + 1))),
    };
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
  } else {
    root = createWeapon(kind, options);
    mergeRigGeometry(root);
    parts = root.userData;
  }
  const view = new WeaponMountView(root, parts);
  root.userData.muzzles = parts.muzzles;
  root.userData.muzzle = parts.muzzles[0];
  return view;
}
