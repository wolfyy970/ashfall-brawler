import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const CATEGORIES = ['plate', 'deck', 'rib', 'pipe', 'light'];
const COLS = 8, ROWS = 4, PAD = .006;

function atlasUV(source, tile) {
  const geometry = source.index ? source.toNonIndexed() : source;
  geometry.computeBoundingBox();
  const p = geometry.attributes.position, n = geometry.attributes.normal,
    uv = new Float32Array(p.count * 2), min = geometry.boundingBox.min,
    size = geometry.boundingBox.getSize(new T.Vector3()), axes = ['x', 'y', 'z'];
  for (let i = 0; i < p.count; i++) {
    const normal = {x:Math.abs(n.getX(i)),y:Math.abs(n.getY(i)),z:Math.abs(n.getZ(i))};
    const dominant = axes.reduce((best, axis) => normal[axis] > normal[best] ? axis : best, 'x');
    const [a,b] = dominant === 'x' ? ['z','y'] : dominant === 'y' ? ['x','z'] : ['x','y'];
    const value = {x:p.getX(i),y:p.getY(i),z:p.getZ(i)};
    const u = (value[a]-min[a])/(size[a]||1), v = (value[b]-min[b])/(size[b]||1);
    uv[i*2] = tile/COLS+PAD+u*(1/COLS-PAD*2);
    uv[i*2+1] = 1-PAD-v*(1/ROWS-PAD*2);
  }
  geometry.setAttribute('uv',new T.BufferAttribute(uv,2));
  return geometry;
}

function transformed(source,position,rotation,parent,tile=1){
  const geometry=atlasUV(source,tile),local=new T.Matrix4().compose(new T.Vector3(...position),
    new T.Quaternion().setFromEuler(new T.Euler(...rotation)),new T.Vector3(1,1,1));
  geometry.applyMatrix4(new T.Matrix4().multiplyMatrices(parent,local));return geometry;
}
const box=(size,p,r,m,tile)=>transformed(new T.BoxGeometry(...size),p,r,m,tile);
const tube=(radius,length,p,r,m,sides=8)=>transformed(
  new T.CylinderGeometry(radius,radius*.93,length,sides,1,false),p,r,m,1);

function tornPanel(width,height,position,rotation,parent,cut,tile=0){
  const points=[[-width/2,-height/2+cut*.11],[width*.38,-height/2],
    [width/2,-height*.18],[width*(.18+cut*.025),height*.02],
    [width/2,height*.35],[width*.16,height/2],
    [-width*.42,height*(.38-cut*.025)],[-width/2,height*.08]].map(p=>new T.Vector2(...p));
  const s=new T.Shape();
  // Rolled corners and a narrow edge face match the larger Blender shell pieces.
  points.forEach((point,i)=>{
    const previous=points[(i+points.length-1)%points.length],next=points[(i+1)%points.length];
    const radius=Math.min(.18,point.distanceTo(previous)*.24,point.distanceTo(next)*.24);
    const start=point.clone().add(previous.clone().sub(point).normalize().multiplyScalar(radius));
    const end=point.clone().add(next.clone().sub(point).normalize().multiplyScalar(radius));
    if(i===0)s.moveTo(start.x,start.y);else s.lineTo(start.x,start.y);
    s.quadraticCurveTo(point.x,point.y,end.x,end.y);
  });s.closePath();
  return transformed(new T.ExtrudeGeometry(s,{depth:.13,bevelEnabled:true,
    bevelThickness:.025,bevelSize:.025,bevelSegments:1,curveSegments:3}),
    position,rotation,parent,tile);
}

function addFragment(parts,spec,index){
  const matrix=new T.Matrix4().compose(new T.Vector3(...spec.position),
    new T.Quaternion().setFromEuler(new T.Euler(...spec.rotation)),new T.Vector3(...spec.scale));
  const width=7.2+index*.45;
  // Small separated shell remnants expose the broken deck volume.
  parts.plate.push(tornPanel(width*.36,3.1,[-width*.31,1.6,1.18],[0,0,-.09],matrix,index+1,0));
  parts.plate.push(tornPanel(width*.3,2.35,[width*.34,-1.75,1.05],[0,0,.13],matrix,index+2,1));
  parts.plate.push(tornPanel(width*.22,1.7,[width*.08,2.55,-1.08],[0,Math.PI,.25],matrix,index+3,1));
  for(let level=0;level<4;level++){
    const y=-2.55+level*1.65,left=-width*.48+level*.15,
      deckWidth=width*(.72-level*.045),deckDepth=3.25-level*.22;
    parts.deck.push(box([deckWidth,.13,deckDepth],[left+deckWidth/2,y,-.2+level*.08],
      [0,.04*(level-1),.025*(level%2?1:-1)],matrix,level%2));
    for(const x of [left,left+deckWidth])parts.rib.push(tube(.105,4.55,[x,y+.48,-.1],[Math.PI/2,0,0],matrix));
    // Tubes run along X; bundle spacing is perpendicular in Y/Z.
    for(let pipe=0;pipe<3;pipe++)parts.pipe.push(tube(.065,deckWidth*.68,
      [left+deckWidth*.49,y+.22+pipe*.16,-1.38+pipe*.11],[0,0,Math.PI/2],matrix,7));
  }
  for(const side of [-1,1]){
    parts.rib.push(tube(.13,6.1,[side*width*.29,0,-1.67],[.08,0,side*.7],matrix));
    parts.rib.push(tube(.11,4.8,[side*width*.22,-.1,1.42],[.24,0,side*.68],matrix));
  }
  for(let i=0;i<4;i++)parts.light.push(box([.24,.075,.055],[-1.35+i*.75,-.85,-1.83],[0,0,0],matrix,0));
}

/** Static architectural wreckage, merged into five draw calls. */
export function createWreckageDetailView(scene){
  const parts=Object.fromEntries(CATEGORIES.map(key=>[key,[]]));
  [
    {position:[-32,-8,20],rotation:[.46,-.82,-.38],scale:[1.02,1.02,1.02]},
    {position:[34,-16,17],rotation:[-.34,2.48,.51],scale:[.88,.88,.88]},
    {position:[-35,-21,-33],rotation:[.68,1.02,-.3],scale:[1.14,1.14,1.14]},
    {position:[31,-12,-38],rotation:[-.52,-2.62,.4],scale:[.96,.96,.96]},
  ].forEach((spec,index)=>addFragment(parts,spec,index));
  const atlas=new T.TextureLoader().load('./assets/wreck-metal.png');
  atlas.colorSpace=T.SRGBColorSpace;atlas.anisotropy=8;
  const materials={
    plate:new T.MeshStandardMaterial({map:atlas,color:0x777777,metalness:.76,roughness:.78}),
    deck:new T.MeshStandardMaterial({map:atlas,color:0x515151,metalness:.64,roughness:.84}),
    rib:new T.MeshStandardMaterial({color:0x15191a,metalness:.84,roughness:.7}),
    pipe:new T.MeshStandardMaterial({color:0x40362e,metalness:.72,roughness:.72}),
    light:new T.MeshStandardMaterial({color:0x492715,emissive:0xff6818,emissiveIntensity:2.1,
      metalness:.2,roughness:.5,toneMapped:false}),
  };
  const root=new T.Group();root.name='architectural-wreckage-detail';
  const meshes=CATEGORIES.map(key=>{const geometry=mergeGeometries(parts[key],false);
    for(const input of parts[key])input.dispose();geometry.computeBoundingSphere();
    const mesh=new T.Mesh(geometry,materials[key]);mesh.name='wreckage-'+key;root.add(mesh);return mesh;});
  scene.add(root);
  return {root,update(){},dispose(){scene.remove(root);for(const mesh of meshes)mesh.geometry.dispose();
    for(const material of Object.values(materials))material.dispose();atlas.dispose();}};
}
