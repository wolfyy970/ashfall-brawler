import * as T from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeVertices} from 'three/addons/utils/BufferGeometryUtils.js';
import {createWreckageDetailView} from './runtime/views/wreckage-detail-view.js';
import {createYardAtmosphereView} from './runtime/views/yard-atmosphere-view.js';
export function environment(scene){
let seed=772;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296),dummy=new T.Object3D();
const loader=new T.TextureLoader();
const atmosphere=createYardAtmosphereView(scene);
const sky=loader.load('./assets/deep-space.png');sky.colorSpace=T.SRGBColorSpace;scene.background=sky;scene.backgroundIntensity=.92;
const ready=new GLTFLoader().loadAsync('./assets/derelict-drydock.glb').then(g=>{
g.scene.scale.setScalar(1/16.130346733461423);
const materials=new Set();g.scene.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);});
for(const m of materials){m.color.multiplyScalar(.30);m.envMapIntensity=.5;if(m.map)m.map.anisotropy=8;}
atmosphere.applyToObject(g.scene);
const left=new T.Group();left.position.set(-42,-14,-1);left.rotation.set(.08,.35,-.13);left.scale.setScalar(1.15);left.add(g.scene);scene.add(left);
const right=new T.Group();right.position.set(40,-25,-29);right.rotation.set(-.16,-2.4,.2);right.scale.setScalar(1.02);right.add(g.scene.clone(true));scene.add(right);
});
// Weld the untextured rock before recomputing normals. The default non-indexed
// icosahedron otherwise lights each triangle separately, exposing the mesh grid.
const rockSource=new T.IcosahedronGeometry(1,3);
rockSource.deleteAttribute('normal');rockSource.deleteAttribute('uv');
const rockGeo=mergeVertices(rockSource);rockSource.dispose();
const pos=rockGeo.attributes.position;
for(let i=0;i<pos.count;i++){const v=new T.Vector3().fromBufferAttribute(pos,i);const f=.86+.15*Math.sin(v.x*5+v.y*3)*Math.cos(v.z*5)+.065*Math.sin(v.y*16-v.z*10+v.x*7);v.multiplyScalar(f);pos.setXYZ(i,v.x,v.y,v.z);}rockGeo.computeVertexNormals();
const rockMat=new T.MeshStandardMaterial({color:0x363d40,roughness:.96,metalness:.05});
rockMat.onBeforeCompile=shader=>{
shader.vertexShader='varying vec3 rockPosition;\n'+shader.vertexShader;
shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nrockPosition=position;');
shader.fragmentShader='varying vec3 rockPosition;\nfloat rh(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}float rn(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(rh(i),rh(i+vec3(1,0,0)),f.x),mix(rh(i+vec3(0,1,0)),rh(i+vec3(1,1,0)),f.x),f.y),mix(mix(rh(i+vec3(0,0,1)),rh(i+vec3(1,0,1)),f.x),mix(rh(i+vec3(0,1,1)),rh(i+vec3(1,1,1)),f.x),f.y),f.z);}\n'+shader.fragmentShader;
shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat grit=rn(rockPosition*8.)*.5+rn(rockPosition*28.)*.3+rn(rockPosition*95.)*.2;float vein=smoothstep(.42,.53,rn(rockPosition*15.));diffuseColor.rgb*=mix(.09,.66,grit)*mix(.65,1.,vein);');
};
const rocks=new T.InstancedMesh(rockGeo,rockMat,110);
atmosphere.applyToMaterial(rockMat);
for(let i=0;i<110;i++){const a=rand()*Math.PI*2,r=16+rand()*53;dummy.position.set(Math.sin(a)*r,-8-rand()*36,Math.cos(a)*r);for(let attempt=0;attempt<14;attempt++){const projectedZ=dummy.position.z-.587*dummy.position.y;if([[-19,-14],[-13,7],[18,-12],[19,11]].every(([x,z])=>Math.hypot(dummy.position.x-x,projectedZ-z)>7))break;const a2=rand()*Math.PI*2,r2=22+rand()*50;dummy.position.set(Math.sin(a2)*r2,-9-rand()*35,Math.cos(a2)*r2);}dummy.rotation.set(rand()*6,rand()*6,rand()*6);const s=.13+Math.pow(rand(),2.4)*2.2;dummy.scale.set(s,s*(.55+rand()*.5),s*(.65+rand()*.6));dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);}scene.add(rocks);
// Floating industrial fragments connect the large wrecks with the small debris.
const steel=new T.MeshStandardMaterial({color:0x2a3032,metalness:.7,roughness:.82});
atmosphere.applyToMaterial(steel);
const chips=new T.InstancedMesh(new T.BoxGeometry(1,1,1),steel,52);
for(let i=0;i<52;i++){const side=i%2?1:-1;dummy.position.set(side*(29+rand()*28),-11-rand()*21,(rand()-.5)*70);dummy.rotation.set(rand()*6,rand()*6,rand()*6);dummy.scale.set(.12+rand()*.55,.04+rand()*.1,.24+rand()*.9);dummy.updateMatrix();chips.setMatrixAt(i,dummy.matrix);}scene.add(chips);
const wreckage=createWreckageDetailView(scene);
atmosphere.applyToObject(wreckage.root);
const stars=new T.BufferGeometry(),p=[],c=[];for(let i=0;i<450;i++){p.push((rand()-.5)*250,-80-rand()*90,(rand()-.5)*200);const q=.1+rand()*.5;c.push(q*.8,q*.9,q);}
stars.setAttribute('position',new T.Float32BufferAttribute(p,3));stars.setAttribute('color',new T.Float32BufferAttribute(c,3));scene.add(new T.Points(stars,new T.PointsMaterial({size:1,vertexColors:true,transparent:true,opacity:.48,sizeAttenuation:false,depthWrite:false})));
return {ready,update(dt){wreckage.update(dt);},dispose(){atmosphere.dispose();wreckage.dispose();}};
}
