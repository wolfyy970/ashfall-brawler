import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {PILOTS,Skirmish} from './sim.js';
import {createWeapon,enginePlume} from './weapons.js';
import {environment} from './environment.js';
import {Effects} from './effects.js';
import {BattleAudio} from './audio.js';
import {ShieldView} from './runtime/views/shield-view.js';
const $=id=>document.getElementById(id);
const sim=new Skirmish(),sound=new BattleAudio(),models=[],feed=[];
let started=false,paused=false,slow=false,tactical=false,focus=-1,zoom=1,last=0,accumulator=0,wall=0,uiTime=0;
const scene=new T.Scene();scene.background=new T.Color(0x080e14);
const renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.16;renderer.info.autoReset=false;$('stage').appendChild(renderer.domElement);
renderer.domElement.setAttribute('aria-label','Four industrial spaceships exchanging fire over a ruined orbital drydock');
const camera=new T.OrthographicCamera(-40,40,30,-30,.1,650);camera.position.set(0,75,44);camera.lookAt(0,0,0);
const room=new RoomEnvironment(),pmrem=new T.PMREMGenerator(renderer),env=pmrem.fromScene(room,.04);scene.environment=env.texture;scene.environmentIntensity=.5;room.dispose();pmrem.dispose();
scene.add(new T.HemisphereLight(0x9eb8cc,0x141b20,.65));const key=new T.DirectionalLight(0xc7ddef,2.3);key.position.set(-20,60,-15);scene.add(key);const rim=new T.DirectionalLight(0xdcb68c,1.05);rim.position.set(28,15,20);scene.add(rim);
const composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));const bloom=new UnrealBloomPass(new T.Vector2(innerWidth,innerHeight),.55,.55,1.05);composer.addPass(bloom);composer.addPass(new OutputPass());
const yard=environment(scene),fx=new Effects(scene),loader=new GLTFLoader();
const targetCam=new T.Vector3(),look=new T.Vector3(),muzzlePos=new T.Vector3();
function resize(){const aspect=innerWidth/innerHeight,span=aspect<1?78:57;camera.left=-span*aspect/2;camera.right=span*aspect/2;camera.top=span/2;camera.bottom=-span/2;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);composer.setSize(innerWidth,innerHeight);fx.pmat.uniforms.pixel.value=innerHeight/span*renderer.getPixelRatio();}
addEventListener('resize',resize);resize();
const mounts=['HP_S01_PORT','HP_S02_STARBOARD','HP_S03_CENTRE'];
for(const p of PILOTS){const card=document.createElement('button');card.className='pilot';card.style.setProperty('--paint',p.color);card.id='pilot-'+p.id;card.setAttribute('aria-label','Follow '+p.name);card.setAttribute('aria-pressed','false');card.innerHTML='<strong>'+p.name+'</strong><span class="hull">'+p.callsign+'</span><span class="role">'+p.role+'</span>'+['shield','armor','cap'].map((k,i)=>'<div class="meter '+k+'"><label>'+['SHD','ARM','CAP'][i]+'</label><div class="track"><div class="fill"></div></div></div>').join('')+'<span class="state">FLIGHT READY</span>';card.onclick=()=>{focus=focus===p.id?-1:p.id;updateHUD();};$('roster').appendChild(card);}
function report(text){feed.unshift(text);feed.splice(4);$('feed').textContent='';for(const line of feed){const d=document.createElement('div');d.textContent=line;$('feed').appendChild(d);}}
async function loadFleet(){let loaded=0;await Promise.all(PILOTS.map(async p=>{
const gltf=await loader.loadAsync('./assets/'+p.hull+'-'+p.paint+'.glb');
const group=new T.Group();scene.add(group);gltf.scene.scale.setScalar(1/16.130346733461423);group.add(gltf.scene);
gltf.scene.traverse(o=>{if(o.isMesh){if(o.name.startsWith('CAP_')||/human|crew|mannequin/i.test(o.name))o.visible=false;for(const m of Array.isArray(o.material)?o.material:[o.material]){for(const k of ['map','normalMap','roughnessMap','metalnessMap'])if(m[k])m[k].anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());if(/engine|exhaust|nozzle.*glow/i.test(m.name)){m.emissive?.set(0x57baff);m.emissiveIntensity=3;}}}});
group.updateMatrixWorld(true);
const weapons=p.weapons.map((kind,i)=>{const hp=gltf.scene.getObjectByName(mounts[i]);const v=hp?group.worldToLocal(hp.getWorldPosition(new T.Vector3())):new T.Vector3(i===0?-1.65:i===1?1.65:0,.6,i===2?1:-.4);const gun=createWeapon(kind);gun.position.copy(v);gun.position.y+=.015;group.add(gun);return gun;});
const exhaust=[];const fxNodes=[];gltf.scene.traverse(o=>{if(o.name.startsWith('FX_')&&/engine|exhaust/i.test(o.name))fxNodes.push(o);});
const enginePositions=fxNodes.length?fxNodes.slice(0,2).map(o=>group.worldToLocal(o.getWorldPosition(new T.Vector3()))):[new T.Vector3(p.hull==='brawler'?-1.29:-1.03,0,3.49),new T.Vector3(p.hull==='brawler'?1.29:1.03,0,3.49)];
for(const pos of enginePositions){const plume=enginePlume();plume.position.copy(pos);group.add(plume);exhaust.push(plume);}
const shield=new ShieldView({parent:group});models[p.id]={group,weapons,exhaust,shield};loaded++;$('loading').textContent=loaded+' / 4 ships prepared';}));
await yard.ready;$('begin').disabled=false;$('begin').textContent='Enter the wreckfield';$('loading').textContent='FLIGHT SYSTEMS READY';}
function updateHUD(){const s=Math.floor(sim.time);$('clock').innerHTML=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')+' <span>SIM TIME</span>';
for(const p of sim.ships){const card=$('pilot-'+p.id);card.classList.toggle('selected',focus===p.id);card.classList.toggle('dead',!p.alive);card.setAttribute('aria-pressed',String(focus===p.id));for(const [k,value] of [['shield',p.shieldNow/p.shield],['armor',p.armorNow/p.armor],['cap',p.cap/100]])card.querySelector('.'+k+' .fill').style.width=Math.max(0,Math.min(1,value))*100+'%';card.querySelector('.state').textContent=!p.alive?'REDEPLOY '+Math.ceil(p.deadUntil-sim.time)+'s':p.warp>0?'WARP ARRIVAL':sim.time<p.webUntil?'WEBBED · THRUST 42%':p.kills+' KILLS · '+(focus===p.id?'TRACKING':'IN FLIGHT');}
$('engagement').textContent=(focus<0?'ALL VS ALL':'FOLLOWING '+PILOTS[focus].name)+' / '+sim.totalKills+' KILLS / '+sim.totalShots+' ROUNDS FIRED';}
function events(){for(const e of sim.drain()){const m=models[e.ship];if(e.type==='fire'&&m){const gun=m.weapons[e.mount];gun.updateWorldMatrix(true,true);gun.userData.muzzle.getWorldPosition(muzzlePos);const a=muzzlePos.clone(),b=new T.Vector3(e.tx,.55,e.tz);
if(e.weapon==='pulse'||e.weapon==='rail')fx.beam(a,b,e.weapon==='rail'?0xa5ddff:0xffd395,e.weapon==='rail'?.22:.13,e.weapon==='rail'?.018:.027);
if(e.weapon==='web')fx.web(a,b);else fx.burst(a,false,false);sound.play(e.weapon,e.x);
}else if(e.type==='impact'){fx.burst(new T.Vector3(e.x,.6,e.z),false,e.shield);sound.play('impact',e.x);}
else if(e.type==='destroy'){fx.burst(new T.Vector3(e.x,.2,e.z),true);sound.play('destroy',e.x);report(PILOTS[e.owner].name+' destroyed '+PILOTS[e.ship].name);}
else if(e.type==='warp'){fx.ring(new T.Vector3(e.x,0,e.z),0x68baff,1.2,5);report(PILOTS[e.ship].name+' returned to grid');}
else if(e.type==='webbed')report(PILOTS[e.owner].name+' webbed '+PILOTS[e.ship].name);}}
function pause(){if(!started)return;paused=!paused;$('pause').textContent=paused?'▶':'Ⅱ';$('pause').setAttribute('aria-label',paused?'Resume':'Pause');sound.mute(paused||$('sound').getAttribute('aria-pressed')!=='true');}
function reset(){sim.reset();fx.clear();for(const model of models)model?.shield.clear();feed.length=0;$('feed').textContent='';accumulator=0;focus=-1;updateHUD();}
function cam(){tactical=!tactical;$('camera').textContent=tactical?'Cinematic':'Tactical';}
$('begin').onclick=async()=>{started=true;document.body.classList.add('started');reset();try{await sound.unlock();$('sound').textContent='Sound on';$('sound').setAttribute('aria-pressed','true');}catch{report('Audio unavailable · visual demo continues');}};
$('pause').onclick=pause;$('reset').onclick=reset;$('camera').onclick=cam;$('slow').onclick=()=>{slow=!slow;$('slow').setAttribute('aria-pressed',String(slow));};
$('sound').onclick=async()=>{const enable=$('sound').getAttribute('aria-pressed')!=='true';if(enable)await sound.unlock();sound.mute(!enable||paused);$('sound').setAttribute('aria-pressed',String(enable));$('sound').textContent=enable?'Sound on':'Sound off';};
addEventListener('keydown',e=>{if(e.target instanceof HTMLButtonElement&&e.code==='Space')return;if(e.code==='Space'){e.preventDefault();pause();}if(e.code==='KeyR')reset();if(e.code==='KeyC')cam();if(e.code==='KeyH')document.body.classList.toggle('clean');});
renderer.domElement.addEventListener('wheel',e=>{e.preventDefault();zoom=T.MathUtils.clamp(zoom*Math.exp(-e.deltaY*.0007),.7,1.6);},{passive:false});
document.addEventListener('visibilitychange',()=>{last=0;accumulator=0;if(document.hidden)sound.mute(true);else sound.mute(paused||$('sound').getAttribute('aria-pressed')!=='true');});
renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();paused=true;$('error').hidden=false;$('error').textContent='Graphics context interrupted. Reload the page to restart the local demo.';});
function frame(ms){const raw=last?Math.min(.1,(ms-last)/1000):0;last=ms;wall+=raw;const dt=started&&!paused&&!document.hidden?raw*(slow?.5:1):0;accumulator+=dt;
let steps=0;while(accumulator>=1/60&&steps<6){sim.step(1/60);events();accumulator-=1/60;steps++;}if(steps===6)accumulator=0;
for(const s of sim.ships){const m=models[s.id];if(!m)continue;m.group.visible=s.alive;m.group.position.set(s.x,Math.sin(sim.time*.8+s.phase)*.06,s.z);m.group.rotation.set(0,-s.angle,-s.bank*.065);const enemy=sim.ships[s.target];for(const gun of m.weapons){const angle=Math.atan2(enemy.x-s.x,-(enemy.z-s.z));gun.rotation.y=-angle+s.angle;}
const speed=Math.hypot(s.vx,s.vz);for(const plume of m.exhaust){plume.scale.set(1,.85,.65+speed*.23);plume.userData.mat.uniforms.time.value=sim.time;plume.userData.mat.uniforms.power.value=s.warp>0?1.7:1;}
m.shield.update({time:sim.time,strength:s.alive?Math.max(0,1-(sim.time-s.hitTime)*2.6)*(s.shieldNow>0?1:.1):0});}
fx.update(dt,sim);yard.update(sim.time);
if(focus>=0&&sim.ships[focus].alive)targetCam.set(sim.ships[focus].x,0,sim.ships[focus].z);else targetCam.set(0,0,0);
look.lerp(targetCam,1-Math.exp(-raw*2));const height=tactical?85:75,depth=tactical?.01:44;camera.position.lerp(new T.Vector3(look.x+(tactical?0:Math.sin(wall*.06)*1.2),height,look.z+depth),1-Math.exp(-raw*3));camera.lookAt(look);camera.zoom=T.MathUtils.lerp(camera.zoom,zoom*(focus>=0?1.35:1),1-Math.exp(-raw*4));camera.updateProjectionMatrix();
renderer.info.reset();composer.render();uiTime+=raw;if(uiTime>.15){updateHUD();uiTime=0;}
// Read-only diagnostics for verification; controls always use real UI.
window.ashfallStatus={ready:models.filter(Boolean).length===4,started,paused,slow,camera:tactical?'tactical':'cinematic',focus,time:sim.time,projectiles:sim.shots.length,effects:fx.items.length,particles:fx.pool.filter(p=>p&&p.life>0).length,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,kills:sim.totalKills,audioContext:sound.ctx?.state||'locked',audioEnabled:sound.enabled};
}
renderer.setAnimationLoop(frame);
loadFleet().catch(e=>{$('loading').textContent='Loading failed';$('error').hidden=false;$('error').textContent='Unable to load the local fleet. Reload to try again.\\n'+e.message;console.error(e);});
