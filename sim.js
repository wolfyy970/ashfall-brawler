const TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
export const PILOTS=[
{id:0,name:'RUST',callsign:'Kestrel',hull:'interceptor',paint:'rust',color:'#b88c52',weapons:['pulse','pulse','missile'],role:'PULSE / ROCKETS',range:16,speed:3.7,shield:90,armor:140},
{id:1,name:'CINDER',callsign:'Marauder',hull:'brawler',paint:'oxblood',color:'#a16464',weapons:['cannon','cannon','web'],role:'AUTOCANNONS / STASIS',range:12,speed:2.6,shield:110,armor:210},
{id:2,name:'VESPER',callsign:'Kestrel',hull:'interceptor',paint:'slate',color:'#7e9bac',weapons:['rail','rail','missile'],role:'RAILGUNS / ROCKETS',range:24,speed:3.5,shield:85,armor:145},
{id:3,name:'MOSS',callsign:'Marauder',hull:'brawler',paint:'olive',color:'#949d70',weapons:['missile','missile','cannon'],role:'MISSILE BATTERIES',range:22,speed:2.5,shield:120,armor:195}
];
const WEAPONS={pulse:{rate:.86,range:33,damage:5},cannon:{rate:.27,range:23,damage:2.6},rail:{rate:2.35,range:43,damage:12},missile:{rate:3.6,range:46,damage:19},web:{rate:8,range:21,damage:0}};
export class Skirmish{
constructor(seed=718){this.seed=seed;this.reset(seed);}
rand(){this.seed=(Math.imul(this.seed,1664525)+1013904223)>>>0;return this.seed/4294967296;}
reset(seed=718){this.seed=seed;this.time=0;this.events=[];this.shots=[];this.serial=0;this.totalKills=0;this.totalShots=0;const positions=[[-20,-11],[15,12],[20,-12],[-17,13]];
this.ships=PILOTS.map((p,i)=>({...p,x:positions[i][0],z:positions[i][1],vx:0,vz:0,angle:Math.atan2(-positions[i][0],positions[i][1]),bank:0,shieldNow:p.shield,armorNow:p.armor,cap:100,target:(i+1)%4,cooldowns:p.weapons.map((_,j)=>2+i*.27+j*.16),targetClock:5+i,webUntil:0,hitTime:-20,deadUntil:0,alive:true,kills:0,phase:i*TAU/4,warp:1.8}));}
emit(e){this.events.push({...e,t:this.time});}
drain(){const e=this.events;this.events=[];return e;}
hit(victim,damage,owner,x,z){if(!victim.alive||victim.warp>0)return;
const shield= Math.min(victim.shieldNow,damage);victim.shieldNow-=shield;victim.armorNow-=damage-shield;victim.hitTime=this.time;
this.emit({type:'impact',ship:victim.id,x,z,shield:shield>0,damage});
if(victim.armorNow<=0){victim.armorNow=0;victim.alive=false;victim.deadUntil=this.time+7.5;this.totalKills++;this.ships[owner].kills++;this.emit({type:'destroy',ship:victim.id,owner,x:victim.x,z:victim.z});}}
step(dt){this.time+=dt;const t=this.time;
for(const s of this.ships){
if(!s.alive){if(t>=s.deadUntil){const a=this.rand()*TAU;s.x=Math.sin(a)*25;s.z=Math.cos(a)*17;s.vx=0;s.vz=0;s.shieldNow=s.shield;s.armorNow=s.armor;s.cap=100;s.alive=true;s.warp=1.6;s.hitTime=t;this.emit({type:'warp',ship:s.id,x:s.x,z:s.z});}continue;}
s.warp=Math.max(0,s.warp-dt);s.cap=Math.min(100,s.cap+7*dt);
if(t-s.hitTime>4)s.shieldNow=Math.min(s.shield,s.shieldNow+3.2*dt);
s.targetClock-=dt;
if(!this.ships[s.target].alive||s.targetClock<0){const options=this.ships.filter(o=>o.id!==s.id&&o.alive);options.sort((a,b)=>(Math.hypot(a.x-s.x,a.z-s.z)+this.rand()*5)-(Math.hypot(b.x-s.x,b.z-s.z)+this.rand()*5));if(options.length)s.target=options[0].id;s.targetClock=5+this.rand()*4;}
const enemy=this.ships[s.target];if(!enemy.alive)continue;
let dx=enemy.x-s.x,dz=enemy.z-s.z,dist=Math.max(.1,Math.hypot(dx,dz));let nx=dx/dist,nz=dz/dist;
const direction=s.id%2?1:-1, approach=clamp((dist-s.range)/9,-.95,1);
let mx=nx*approach+nz*.88*direction,mz=nz*approach-nx*.88*direction;
mx-=s.x*.016;mz-=s.z*.029;
for(const other of this.ships){if(other.id===s.id||!other.alive)continue;const ox=s.x-other.x,oz=s.z-other.z,d=Math.hypot(ox,oz);if(d<8.5&&d>.01){mx+=ox/d*(8.5-d)*.38;mz+=oz/d*(8.5-d)*.38;}}
if(Math.abs(s.x)>25)mx-=Math.sign(s.x)*(Math.abs(s.x)-25)*.8;
if(Math.abs(s.z)>17)mz-=Math.sign(s.z)*(Math.abs(s.z)-17)*.8;
const m=Math.max(1,Math.hypot(mx,mz)), speed=s.speed*(t<s.webUntil?.42:1);
s.vx+=(mx/m*speed-s.vx)*Math.min(1,dt*1.1);s.vz+=(mz/m*speed-s.vz)*Math.min(1,dt*1.1);
s.x+=s.vx*dt;s.z+=s.vz*dt;
const desired=Math.atan2(s.vx,-s.vz),turn=clamp(wrap(desired-s.angle),-dt*.75,dt*.75);
s.angle=wrap(s.angle+turn);s.bank+=(clamp(turn/dt,-.7,.7)-s.bank)*dt*3;
if(s.warp>0)continue;
for(let j=0;j<s.weapons.length;j++){s.cooldowns[j]-=dt;const kind=s.weapons[j],w=WEAPONS[kind];if(s.cooldowns[j]>0||dist>w.range||enemy.warp>0)continue;
if((kind==='pulse'||kind==='rail'||kind==='web')&&s.cap<(kind==='web'?20:7))continue;
s.cooldowns[j]=w.rate*(.9+this.rand()*.2);if(kind==='pulse'||kind==='rail'||kind==='web')s.cap-=kind==='web'?20:7;
const ev={type:'fire',weapon:kind,ship:s.id,target:enemy.id,mount:j,x:s.x,z:s.z,tx:enemy.x,tz:enemy.z,id:++this.serial};this.emit(ev);this.totalShots++;
if(kind==='web'){enemy.webUntil=t+3.4;this.emit({type:'webbed',ship:enemy.id,owner:s.id});}
else if(kind==='pulse'||kind==='rail'){this.hit(enemy,w.damage,s.id,enemy.x+(this.rand()-.5)*1.6,enemy.z+(this.rand()-.5)*1.6);}
else {const heading=Math.atan2(dx,dz)+(kind==='missile'?(j===0?-.5:.5):(this.rand()-.5)*.11);this.shots.push({id:ev.id,kind,owner:s.id,target:enemy.id,x:s.x+nx*1.8,z:s.z+nz*1.8,vx:Math.sin(heading)*(kind==='missile'?5:42),vz:Math.cos(heading)*(kind==='missile'?5:42),life:kind==='missile'?6:1.6,damage:w.damage,age:0});}
}}
for(let i=this.shots.length-1;i>=0;i--){const p=this.shots[i];p.life-=dt;p.age+=dt;const enemy=this.ships[p.target];
if(p.kind==='missile'&&enemy.alive){const dx=enemy.x-p.x,dz=enemy.z-p.z,d=Math.hypot(dx,dz)||1, speed=Math.min(20,6+p.age*6);p.vx+=(dx/d*speed-p.vx)*dt*2.4;p.vz+=(dz/d*speed-p.vz)*dt*2.4;}
const ax=p.x,az=p.z;p.x+=p.vx*dt;p.z+=p.vz*dt;
let collision=false;for(const s of this.ships){if(s.id===p.owner||!s.alive||s.warp>0)continue;const lx=p.x-ax,lz=p.z-az,den=lx*lx+lz*lz;const u=clamp(((s.x-ax)*lx+(s.z-az)*lz)/(den||1),0,1);if(Math.hypot(ax+u*lx-s.x,az+u*lz-s.z)<(s.hull==='brawler'?2.25:1.65)){this.hit(s,p.damage,p.owner,p.x,p.z);collision=true;break;}}
if(p.life<=0||collision){this.emit({type:'projectile-end',id:p.id,kind:p.kind,x:p.x,z:p.z,hit:collision});this.shots.splice(i,1);}}
}
}