import * as T from 'three';
const steel = new T.MeshStandardMaterial({ color: 0x474e51, metalness: 0.78, roughness: 0.36 });
const armor = new T.MeshStandardMaterial({ color: 0x575e62, metalness: 0.68, roughness: 0.48 });
const dark = new T.MeshStandardMaterial({ color: 0x11171b, metalness: 0.8, roughness: 0.42 });
const coil = new T.MeshStandardMaterial({
  color: 0x607982,
  emissive: 0x387f9b,
  emissiveIntensity: 0.7,
  metalness: 0.7,
  roughness: 0.3,
});

const atlas = new T.TextureLoader().load(
  new URL('../../assets/ship-atlas.png', import.meta.url).href,
);
atlas.colorSpace = T.SRGBColorSpace;
atlas.anisotropy = 8;
const fleetArmor = new T.MeshStandardMaterial({
  map: atlas,
  color: 0xb8c0c3,
  metalness: 0.6,
  roughness: 0.54,
});
function fleetPanel(g, p, size, tile = 1) {
  const [w, h, d] = size,
    c = Math.min(w, h) * 0.12,
    shape = new T.Shape();
  shape.moveTo(-w / 2 + c, -h / 2);
  shape.lineTo(w / 2 - c, -h / 2);
  shape.lineTo(w / 2, -h / 2 + c);
  shape.lineTo(w / 2, h / 2 - c);
  shape.lineTo(w / 2 - c, h / 2);
  shape.lineTo(-w / 2 + c, h / 2);
  shape.lineTo(-w / 2, h / 2 - c);
  shape.lineTo(-w / 2, -h / 2 + c);
  shape.closePath();
  const geo = new T.ExtrudeGeometry(shape, {
    depth: d,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.006,
    bevelSegments: 1,
    steps: 1,
  });
  geo.translate(0, 0, -d / 2);
  const pos = geo.attributes.position,
    normal = geo.attributes.normal,
    uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(normal.getX(i)),
      ny = Math.abs(normal.getY(i)),
      nz = Math.abs(normal.getZ(i));
    const u = nx > ny && nx > nz ? pos.getZ(i) / d + 0.5 : pos.getX(i) / w + 0.5;
    const v = ny > nz ? pos.getZ(i) / d + 0.5 : pos.getY(i) / h + 0.5;
    uv.setXY(
      i,
      ((tile % 4) + 0.025 + 0.95 * u) / 4,
      1 - (Math.floor(tile / 4) + 1 - (0.025 + 0.95 * v)) / 4,
    );
  }
  const mesh = new T.Mesh(geo, fleetArmor);
  mesh.position.set(...p);
  g.add(mesh);
  return mesh;
}

function box(g, x, y, z, w, h, d, mat = steel) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  g.add(m);
  return m;
}
function cylinder(g, x, y, z, r, length, mat = steel, axis = 'y', open = false) {
  const m = new T.Mesh(new T.CylinderGeometry(r, r, length, 12, 1, open), mat);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  g.add(m);
  return m;
}
export function createWeapon(kind, { barrels = 2 } = {}) {
  const g = new T.Group();
  g.name = 'SMALL_' + kind.toUpperCase();
  cylinder(g, 0, 0.05, 0, 0.29, 0.1, dark);
  cylinder(g, 0, 0.115, 0, 0.235, 0.08, armor);
  const yaw = new T.Group();
  yaw.name = 'Yaw_Pivot';
  yaw.position.y = 0.15;
  g.add(yaw);
  const pitch = new T.Group();
  pitch.name = 'Pitch_Pivot';
  pitch.position.y = 0.13;
  yaw.add(pitch);
  const muzzles = [],
    recoils = [];
  function muzzle(parent, x, y, z, id) {
    const o = new T.Object3D();
    o.name = id;
    o.position.set(x, y, z);
    parent.add(o);
    muzzles.push(o);
    return o;
  }
  if (kind === 'missile') {
    fleetPanel(pitch, [0, 0, 0.015], [0.65, 0.36, 0.7]);
    for (const side of [-1, 1]) {
      fleetPanel(pitch, [side * 0.325, -0.015, 0.04], [0.028, 0.2, 0.54], 2);
      fleetPanel(pitch, [side * 0.19, 0.187, 0.17], [0.09, 0.012, 0.16], 0);
    }
    for (let i = 0; i < 4; i++) box(pitch, 0, 0.19, -0.18 + i * 0.045, 0.18, 0.019, 0.013, dark);
    box(pitch, 0, 0, -0.344, 0.57, 0.3, 0.018, dark);
    fleetPanel(pitch, [0, 0.19, 0.19], [0.23, 0.015, 0.2], 2);
    for (let row = 0; row < 2; row++)
      for (let col = 0; col < 3; col++) {
        const x = (col - 1) * 0.18,
          y = (row - 0.5) * 0.15;
        cylinder(pitch, x, y, -0.375, 0.059, 0.08, steel, 'z', true);
        const lip = new T.Mesh(new T.RingGeometry(0.045, 0.061, 12), armor);
        lip.position.set(x, y, -0.416);
        lip.rotation.y = Math.PI;
        pitch.add(lip);
        // A real recess behind each open tube; the rocket nose begins at its forward rim.
        cylinder(pitch, x, y, -0.34, 0.044, 0.008, dark, 'z');
        muzzle(pitch, x, y, -0.416, 'MUZZLE_TUBE_' + (row * 3 + col + 1));
      }
  } else if (kind === 'pulse') {
    // Energy projection has short recessed apertures and radiators; no cannon-like barrels.
    fleetPanel(pitch, [0, 0, 0.025], [0.59, 0.28, 0.49], 1);
    for (const side of [-1, 1]) {
      const emitter = new T.Group();
      emitter.name = 'Emitter_' + (side < 0 ? 1 : 2);
      emitter.position.x = side * 0.16;
      pitch.add(emitter);
      fleetPanel(emitter, [0, 0, -0.22], [0.235, 0.19, 0.21], 2);
      box(emitter, 0, 0, -0.329, 0.174, 0.127, 0.006, dark);
      const lens = new T.Mesh(new T.PlaneGeometry(0.108, 0.066), coil);
      lens.rotation.y = Math.PI;
      lens.position.z = -0.334;
      emitter.add(lens);
      muzzle(emitter, 0, 0, -0.335, 'MUZZLE_EMITTER_' + (side < 0 ? 1 : 2));
      for (let j = 0; j < 6; j++)
        box(pitch, side * 0.3, 0.075, -0.08 + j * 0.05, 0.07, 0.085, 0.018, steel);
    }
    fleetPanel(pitch, [0, 0.15, 0.1], [0.13, 0.018, 0.14], 0);
  } else if (kind === 'web') {
    cylinder(pitch, 0, 0.14, 0, 0.07, 0.3, steel);
    const dish = new T.Mesh(new T.SphereGeometry(0.25, 12, 6, 0, Math.PI * 2, 0, 0.6), armor);
    dish.rotation.x = -Math.PI / 2;
    dish.position.set(0, 0.15, -0.12);
    pitch.add(dish);
    cylinder(pitch, 0, 0.15, -0.32, 0.025, 0.28, coil, 'z');
    muzzle(pitch, 0, 0.15, -0.46, 'MUZZLE_EMITTER_1');
  } else {
    barrels = Math.max(1, Math.min(8, Math.floor(barrels)));
    box(pitch, 0, -0.015, 0.03, Math.max(0.4, barrels * 0.21), 0.22, 0.44, armor);
    box(pitch, 0, 0.12, 0.1, 0.16, 0.035, 0.17, dark);
    for (let i = 0; i < barrels; i++) {
      const x = (i - (barrels - 1) / 2) * 0.24,
        recoil = new T.Group();
      recoil.name = 'Recoil_' + (i + 1);
      recoil.position.x = x;
      pitch.add(recoil);
      recoils.push(recoil);
      const length = kind === 'rail' ? 1.18 : kind === 'cannon' ? 0.77 : 0.54;
      cylinder(recoil, 0, 0, -0.25 - length / 2, 0.045, length, steel, 'z');
      cylinder(recoil, 0, 0, -0.25 - length, 0.065, 0.12, dark, 'z', true);
      const lip = new T.Mesh(new T.RingGeometry(0.03, 0.065, 12), steel);
      lip.position.z = -0.31 - length;
      lip.rotation.y = Math.PI;
      recoil.add(lip);
      if (kind === 'rail')
        for (let j = 0; j < 4; j++) box(recoil, 0, 0, -0.32 - j * 0.2, 0.13, 0.13, 0.06, coil);
      else if (kind === 'pulse') cylinder(recoil, 0, 0, -0.44, 0.075, 0.1, coil, 'z');
      muzzle(recoil, 0, 0, -0.31 - length, 'MUZZLE_BARREL_' + (i + 1));
    }
  }
  g.userData.muzzles = muzzles;
  g.userData.muzzle = muzzles[0];
  g.userData.yaw = yaw;
  g.userData.pitch = pitch;
  g.userData.recoils = recoils;
  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
}
