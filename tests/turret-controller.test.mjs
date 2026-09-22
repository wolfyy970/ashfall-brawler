import test from 'node:test';
import assert from 'node:assert/strict';
import {TurretController} from '../runtime/controllers/turret-controller.js';
import {SMALL_AC200} from '../runtime/model/weapon-specs.js';
test('alternating physical muzzles, cadence and independent recoil survive reset',()=>{
 const offsets=[0,0],events=[];
 const view={aimAt(){},setRecoil(i,m){offsets[i]=m;},
  muzzle(i){return {position:{x:i?1.18:-1.18,y:2.13,z:-9.75},direction:{x:0,y:0,z:-1}};}};
 const gun=new TurretController(view,SMALL_AC200,e=>events.push(e));
 assert.equal(gun.fire(1).muzzleIndex,0);
 assert.equal(gun.fire(1.05),null);
 gun.update(1.03);assert.ok(offsets[0]>0);assert.equal(offsets[1],0);
 assert.equal(gun.fire(1.18).muzzleIndex,1);
 gun.update(1.20);assert.ok(offsets[0]>0&&offsets[1]>offsets[0]);
 assert.equal(events.length,2);assert.equal(events[1].position.x,1.18);
 gun.update(1.5);assert.deepEqual(offsets,[0,0]);
 gun.reset();assert.equal(gun.fire(0).muzzleIndex,0);
});
