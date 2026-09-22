/** No Three.js dependency. Converts aim/fire commands into rig poses and fire events. */
export class TurretController {
  constructor(view,spec,onFire=()=>{}) {
    this.view=view;this.spec=spec;this.onFire=onFire;this.serial=0;
    this.lastShot=-Infinity;
    this.recoilAt=spec.nodes.muzzles.map(()=>-Infinity);
  }
  aimAt(worldPoint) { this.view.aimAt(worldPoint); }
  fire(time) {
    if(time-this.lastShot < this.spec.shotInterval-1e-8) return null;
    const index=this.serial%this.recoilAt.length;
    // Capture the actual barrel endpoint before kickback.
    const muzzle=this.view.muzzle(index);
    const event={type:'weapon-fired',weaponId:this.spec.id,
      projectileId:++this.serial,muzzleIndex:index,time,...muzzle};
    this.lastShot=time;this.recoilAt[index]=time;
    this.onFire(event);
    return event;
  }
  update(time) {
    for(let i=0;i<this.recoilAt.length;i++) {
      const age=time-this.recoilAt[i];
      const k=Math.min(1,Math.max(0,age/this.spec.recoilDuration));
      const attack=Math.min(1,k/.12);
      this.view.setRecoil(i,this.spec.recoilM*attack*Math.pow(1-k,2));
    }
  }
  reset() {
    this.lastShot=-Infinity;this.serial=0;this.recoilAt.fill(-Infinity);
    this.recoilAt.forEach((_,i)=>this.view.setRecoil(i,0));
  }
}
