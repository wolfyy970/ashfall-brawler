import * as T from 'three';
/** Renders a GLB rig. Aiming and recoil are visual poses; no hit/damage decisions. */
export class TurretView {
  constructor(asset, spec, {ownsResources=true}={}) {
    this.ownsResources=ownsResources;
    this.object = asset;
    this.spec = spec;
    const required = name => {
      const node = asset.getObjectByName(name);
      if (!node) throw new Error('Turret rig missing '+name);
      return node;
    };
    this.yaw = required(spec.nodes.yaw);
    this.pitch = required(spec.nodes.pitch);
    this.recoils = spec.nodes.recoil.map(required);
    this.muzzles = spec.nodes.muzzles.map(required);
    if(this.recoils.length!==this.muzzles.length||!this.muzzles.length)throw new Error('Each barrel needs one recoil and one muzzle node');
    this.rest = this.recoils.map(n => n.position.clone());
    this.aim = new T.Vector3();
    this.direction = new T.Vector3();
    this.orientation = new T.Quaternion();
    this.object.traverse(o => { if(o.isMesh) {o.castShadow=true; o.receiveShadow=true;} });
  }
  mount(socket, metresPerSocketUnit) {
    // Parenting retains the socket's full position and orientation.
    // The ship uses authored units; this weapon uses physical metres.
    this.object.scale.setScalar(this.spec.metresPerAssetUnit/metresPerSocketUnit);
    this.object.position.set(0,0,0);
    this.object.quaternion.identity();
    socket.add(this.object);
    this.object.updateWorldMatrix(true,true);
  }
  aimAt(point) {
    this.yaw.parent.updateWorldMatrix(true,false);
    this.aim.set(point.x,point.y,point.z);
    this.yaw.parent.worldToLocal(this.aim).sub(this.yaw.position);
    this.yaw.rotation.y = Math.atan2(-this.aim.x,-this.aim.z);
    this.pitch.parent.updateWorldMatrix(true,false);
    this.aim.set(point.x,point.y,point.z);
    this.pitch.parent.worldToLocal(this.aim).sub(this.pitch.position);
    this.pitch.rotation.x = T.MathUtils.clamp(
      Math.atan2(this.aim.y,Math.hypot(this.aim.x,this.aim.z)),
      this.spec.minElevation,this.spec.maxElevation);
  }
  setRecoil(index, metres) {
    this.recoils[index].position.copy(this.rest[index]);
    this.recoils[index].position.z += metres/this.spec.metresPerAssetUnit;
  }
  muzzle(index) {
    const node=this.muzzles[index];
    node.updateWorldMatrix(true,false);
    node.getWorldPosition(this.aim);
    node.getWorldQuaternion(this.orientation);
    this.direction.set(0,0,-1).applyQuaternion(this.orientation).normalize();
    return {position:{x:this.aim.x,y:this.aim.y,z:this.aim.z},
      direction:{x:this.direction.x,y:this.direction.y,z:this.direction.z}};
  }
  dispose() {
    this.object.removeFromParent();
    if(!this.ownsResources)return;
    const geometries=new Set(),materials=new Set(),textures=new Set();
    this.object.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});
    for(const m of materials)for(const value of Object.values(m))if(value?.isTexture)textures.add(value);
    for(const item of [...geometries,...materials,...textures])item.dispose();
  }
}
