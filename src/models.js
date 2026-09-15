import * as THREE from 'three';
import * as BGU from 'three/addons/utils/BufferGeometryUtils.js';

export const soldierMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

function colorize(geom, hex) {
  const c = new THREE.Color(hex);
  const n = geom.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geom;
}
const bx = (w, h, d, x, y, z, hex, rx = 0, ry = 0, rz = 0) => colorize(new THREE.BoxGeometry(w, h, d).rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z), hex);
const cy = (rt, rb, h, seg, x, y, z, hex, rx = 0, ry = 0, rz = 0) => colorize(new THREE.CylinderGeometry(rt, rb, h, seg).rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z), hex);
const cn = (r, h, seg, x, y, z, hex) => colorize(new THREE.ConeGeometry(r, h, seg).translate(x, y, z), hex);
const tor = (r, t, arc, x, y, z, hex, ry = 0) => colorize(new THREE.TorusGeometry(r, t, 4, 10, arc).rotateY(ry).translate(x, y, z), hex);

const SKIN = 0xd8a37a;
const RED = 0x7e2020, RED_D = 0x4d1414, IRON = 0x454e57, IRON_D = 0x2e3438, HELM = 0x6a737b, GOLD = 0xd9a441;
// สีประจำฝ่ายเมือง: เสื้อเกราะน้ำเงิน (ตัดกับทัพเราสีแดง และไม่กลืนกับกำแพงหิน/ลานหินสีเทา)
const DEF_BLUE = 0x2f5fa8, DEF_BLUE_D = 0x1d3c70, DEF_BLUE_L = 0x4f86d8, GUARD_NAVY = 0x22326e;

// สีธงประจำกอง — แยกประเภทให้อ่านออกบนจอ
export const BANNER_COLOR = { spear: 0xb03030, shield: 0xc08a3e, archer: 0x4a7a3a, ram: 0x6b4a2a, cav: 0xe8c14a };

function bannerParts(p, x, z, h, fw, fh, hex) {
  p.push(cy(0.03, 0.03, h, 5, x, 1.0 + h / 2, z, 0x5a4026));
  p.push(bx(fw, fh, 0.03, x + fw / 2 + 0.03, 1.0 + h - fh / 2, z, hex));
  p.push(bx(fw, 0.09, 0.04, x + fw / 2 + 0.03, 1.0 + h, z, 0xd9a441));
  p.push(cy(0.05, 0.05, 0.12, 6, x, 1.0 + h + 0.06, z, 0xd9a441));
}

// ทหารทั้งตัวหลอมเป็น geometry เดียว (1 draw call ต่อคน)
function buildSoldier(type) {
  const p = [];
  const humanoid = (armor, skirt, shoulder, helmet, conical, crest) => {
    p.push(bx(0.15, 0.52, 0.15, -0.1, 0.26, 0, 0x2b241e));
    p.push(bx(0.15, 0.52, 0.15, 0.1, 0.26, 0, 0x2b241e));
    p.push(bx(0.44, 0.52, 0.28, 0, 0.79, 0, armor));
    p.push(bx(0.46, 0.16, 0.3, 0, 0.55, 0, skirt));
    p.push(bx(0.16, 0.12, 0.28, -0.3, 1.03, 0, shoulder));
    p.push(bx(0.16, 0.12, 0.28, 0.3, 1.03, 0, shoulder));
    p.push(bx(0.22, 0.22, 0.2, 0, 1.24, 0, SKIN));
    if (conical) p.push(cn(0.17, 0.22, 6, 0, 1.42, 0, helmet));
    else {
      p.push(bx(0.26, 0.13, 0.24, 0, 1.37, 0, helmet));
      if (crest) p.push(bx(0.05, 0.1, 0.28, 0, 1.48, 0, 0xb03030));
    }
  };

  switch (type) {
    case 'atk': // พลหอก
      humanoid(RED, 0x33261c, RED_D, 0x3a3f45, false, true);
      p.push(cy(0.022, 0.022, 2.05, 5, 0.3, 1.05, 0.14, 0x6b4a2a));
      p.push(cn(0.05, 0.2, 5, 0.3, 2.15, 0.14, 0x9aa3ad));
      p.push(cy(0.3, 0.3, 0.05, 10, -0.38, 0.85, 0.1, 0x5f4326, 0, 0, Math.PI / 2));
      p.push(cy(0.07, 0.07, 0.08, 6, -0.43, 0.85, 0.1, 0x8a8f96, 0, 0, Math.PI / 2));
      break;
    case 'atkBanner': // ธงกองหอก (แดง)
      humanoid(RED, 0x33261c, RED_D, 0x3a3f45, false, true);
      bannerParts(p, 0.34, 0.05, 3.1, 0.95, 0.7, BANNER_COLOR.spear);
      break;
    case 'shield': // พลโล่ — โล่ใหญ่ติดตัว
      humanoid(0x6b5a3a, 0x4a3c22, 0x55482c, 0x4a4436, false, false);
      p.push(bx(0.95, 1.35, 0.09, 0, 0.95, 0.42, 0x6b4a2a));
      p.push(bx(0.95, 0.14, 0.11, 0, 1.5, 0.42, 0xc08a3e));
      p.push(cy(0.16, 0.16, 0.06, 8, 0, 0.95, 0.47, 0xc08a3e, Math.PI / 2));
      break;
    case 'shieldBanner':
      humanoid(0x6b5a3a, 0x4a3c22, 0x55482c, 0x4a4436, false, false);
      p.push(bx(0.95, 1.35, 0.09, 0, 0.95, 0.42, 0x6b4a2a));
      p.push(bx(0.95, 0.14, 0.11, 0, 1.5, 0.42, 0xc08a3e));
      bannerParts(p, -0.42, 0.05, 3.0, 0.85, 0.62, BANNER_COLOR.shield);
      break;
    case 'atkArch': // นักธนูฝ่ายบุก
      humanoid(0x3f5d3a, 0x2b3d24, 0x33502f, 0x3a3f45, false, false);
      p.push(tor(0.32, 0.02, Math.PI * 0.85, 0.3, 1.0, 0.1, 0x4a2f1c, Math.PI / 2));
      p.push(bx(0.09, 0.34, 0.09, -0.2, 1.0, -0.16, 0x6b4a2a));
      break;
    case 'atkArchBanner':
      humanoid(0x3f5d3a, 0x2b3d24, 0x33502f, 0x3a3f45, false, false);
      p.push(tor(0.32, 0.02, Math.PI * 0.85, 0.3, 1.0, 0.1, 0x4a2f1c, Math.PI / 2));
      bannerParts(p, -0.38, 0.05, 3.0, 0.85, 0.62, BANNER_COLOR.archer);
      break;
    case 'crew': // พลรถทุบ
      humanoid(0x4a3a28, 0x33261c, 0x3a2f20, 0x3a3f45, false, false);
      p.push(bx(0.5, 0.5, 0.07, 0, 0.9, 0.38, 0x5f4326));
      break;
    case 'crewBanner':
      humanoid(0x4a3a28, 0x33261c, 0x3a2f20, 0x3a3f45, false, false);
      bannerParts(p, 0.3, 0.05, 2.8, 0.8, 0.6, BANNER_COLOR.ram);
      break;
    case 'def': // หอกฝ่ายเมือง
      humanoid(DEF_BLUE, DEF_BLUE_D, DEF_BLUE_L, HELM, true, false);
      p.push(cn(0.06, 0.2, 5, 0, 1.63, 0, DEF_BLUE_L));
      p.push(cy(0.022, 0.022, 2.05, 5, 0.3, 1.05, 0.14, 0x4a3826));
      p.push(cn(0.05, 0.2, 5, 0.3, 2.15, 0.14, 0x8a8f96));
      break;
    case 'carrier': // พลขนหิน — หอกฝ่ายเมืองพร้อมเป้หิน
      humanoid(0x5a6a88, DEF_BLUE_D, DEF_BLUE_L, HELM, true, false);
      p.push(bx(0.42, 0.38, 0.3, 0, 1.5, -0.18, 0x7d7d7d));
      p.push(bx(0.3, 0.24, 0.24, 0, 0.95, 0.3, 0x7d7d7d));
      break;
    case 'archer': // นักธนูฝ่ายเมือง
      humanoid(DEF_BLUE, DEF_BLUE_D, DEF_BLUE_L, HELM, true, false);
      p.push(cn(0.06, 0.2, 5, 0, 1.63, 0, DEF_BLUE_L));
      p.push(tor(0.32, 0.02, Math.PI * 0.85, 0.3, 1.0, 0.1, 0x4a2f1c, Math.PI / 2));
      p.push(bx(0.09, 0.34, 0.09, -0.2, 1.0, -0.16, 0x6b4a2a));
      break;
    case 'cav': // ทหารม้าฝ่ายบุก
      p.push(bx(0.55, 0.55, 1.5, 0, 0.95, 0, 0x4a3428));
      p.push(bx(0.24, 0.55, 0.3, 0, 1.28, 0.78, 0x4a3428, -0.5));
      p.push(bx(0.2, 0.26, 0.55, 0, 1.6, 1.08, 0x3a2a20));
      p.push(bx(0.05, 0.12, 0.05, -0.07, 1.78, 1.0, 0x3a2a20));
      p.push(bx(0.05, 0.12, 0.05, 0.07, 1.78, 1.0, 0x3a2a20));
      p.push(bx(0.1, 0.5, 0.12, 0, 1.05, -0.82, 0x3a2a20, 0.5));
      for (const [lx, lz] of [[-0.2, 0.55], [0.2, 0.55], [-0.2, -0.55], [0.2, -0.55]]) {
        p.push(bx(0.14, 0.75, 0.16, lx, 0.375, lz, 0x3a2a20));
      }
      p.push(bx(0.5, 0.1, 0.6, 0, 1.27, 0.05, 0x6b3423));
      p.push(bx(0.4, 0.5, 0.26, 0, 1.62, 0.0, RED));
      p.push(bx(0.2, 0.2, 0.2, 0, 2.0, 0, SKIN));
      p.push(bx(0.24, 0.12, 0.24, 0, 2.12, 0, 0x3a3f45));
      p.push(bx(0.05, 0.09, 0.26, 0, 2.2, 0, 0xb03030));
      p.push(cy(0.02, 0.02, 2.2, 5, 0.32, 1.7, 0.12, 0x6b4a2a));
      p.push(cn(0.045, 0.18, 5, 0.32, 2.85, 0.12, 0x9aa3ad));
      break;
    case 'cavBanner':
      p.push(bx(0.55, 0.55, 1.5, 0, 0.95, 0, 0x4a3428));
      p.push(bx(0.24, 0.55, 0.3, 0, 1.28, 0.78, 0x4a3428, -0.5));
      p.push(bx(0.2, 0.26, 0.55, 0, 1.6, 1.08, 0x3a2a20));
      for (const [lx, lz] of [[-0.2, 0.55], [0.2, 0.55], [-0.2, -0.55], [0.2, -0.55]]) {
        p.push(bx(0.14, 0.75, 0.16, lx, 0.375, lz, 0x3a2a20));
      }
      p.push(bx(0.5, 0.1, 0.6, 0, 1.27, 0.05, 0x6b3423));
      p.push(bx(0.4, 0.5, 0.26, 0, 1.62, 0.0, RED));
      p.push(bx(0.2, 0.2, 0.2, 0, 2.0, 0, SKIN));
      p.push(bx(0.24, 0.12, 0.24, 0, 2.12, 0, 0x3a3f45));
      bannerParts(p, -0.34, -0.15, 2.9, 0.85, 0.6, BANNER_COLOR.cav);
      break;
    case 'guardShield': // องครักษ์โล่ชั้นใน — เกราะเหล็กขลิบทอง โล่ใหญ่สีแดง
      humanoid(GUARD_NAVY, IRON_D, GOLD, HELM, false, false);
      p.push(bx(0.26, 0.08, 0.26, 0, 1.45, 0, GOLD));
      p.push(bx(1.0, 1.4, 0.1, 0, 0.95, 0.42, DEF_BLUE_D));
      p.push(bx(1.0, 0.12, 0.12, 0, 1.6, 0.42, GOLD));
      p.push(cy(0.18, 0.18, 0.07, 8, 0, 0.95, 0.48, GOLD, Math.PI / 2));
      break;
    case 'guardSpear': // องครักษ์ง้าวชั้นใน — ง้าวยาว พู่แดง
      humanoid(GUARD_NAVY, IRON_D, GOLD, HELM, true, false);
      p.push(cy(0.028, 0.028, 2.6, 5, 0.3, 1.3, 0.14, 0x3a2a1c));
      p.push(bx(0.05, 0.36, 0.2, 0.3, 2.62, 0.2, 0x9aa3ad));
      p.push(cn(0.07, 0.14, 6, 0.3, 2.4, 0.14, DEF_BLUE_L));
      break;
    case 'guardArcher': // พลธนูบนกำแพงชั้นใน — หมวกทอง
      humanoid(GUARD_NAVY, IRON_D, GOLD, GOLD, true, false);
      p.push(tor(0.34, 0.022, Math.PI * 0.85, 0.3, 1.0, 0.1, 0x4a2f1c, Math.PI / 2));
      p.push(bx(0.09, 0.34, 0.09, -0.2, 1.0, -0.16, 0x6b4a2a));
      break;
    case 'guardCav': { // ม้าองครักษ์วัง — เกราะม้าแดง คนขี่ขลิบทอง
      p.push(bx(0.6, 0.6, 1.55, 0, 0.95, 0, DEF_BLUE_D));
      p.push(bx(0.26, 0.58, 0.32, 0, 1.28, 0.8, DEF_BLUE_D, -0.5));
      p.push(bx(0.22, 0.28, 0.58, 0, 1.6, 1.1, 0x2e2e33));
      for (const [lx, lz] of [[-0.2, 0.55], [0.2, 0.55], [-0.2, -0.55], [0.2, -0.55]]) {
        p.push(bx(0.15, 0.75, 0.17, lx, 0.375, lz, 0x2e2e33));
      }
      p.push(bx(0.52, 0.1, 0.62, 0, 1.27, 0.05, GOLD));
      p.push(bx(0.42, 0.52, 0.28, 0, 1.63, 0.0, GUARD_NAVY));
      p.push(bx(0.44, 0.08, 0.3, 0, 1.9, 0.0, GOLD));
      p.push(bx(0.2, 0.2, 0.2, 0, 2.0, 0, SKIN));
      p.push(cn(0.17, 0.24, 6, 0, 2.2, 0, GOLD));
      p.push(cy(0.024, 0.024, 2.5, 5, 0.32, 1.8, 0.12, 0x3a2a1c));
      p.push(bx(0.05, 0.34, 0.2, 0.32, 3.1, 0.18, 0x9aa3ad));
      break;
    }
    case 'cavD': { // ม้าซองของฝ่ายเมือง — คนขี่เกราะเหล็ก
      p.push(bx(0.55, 0.55, 1.5, 0, 0.95, 0, 0x3a3a40));
      p.push(bx(0.24, 0.55, 0.3, 0, 1.28, 0.78, 0x3a3a40, -0.5));
      p.push(bx(0.2, 0.26, 0.55, 0, 1.6, 1.08, 0x2e2e33));
      for (const [lx, lz] of [[-0.2, 0.55], [0.2, 0.55], [-0.2, -0.55], [0.2, -0.55]]) {
        p.push(bx(0.14, 0.75, 0.16, lx, 0.375, lz, 0x2e2e33));
      }
      p.push(bx(0.5, 0.1, 0.6, 0, 1.27, 0.05, 0x6b3423));
      p.push(bx(0.4, 0.5, 0.26, 0, 1.62, 0.0, DEF_BLUE));
      p.push(bx(0.2, 0.2, 0.2, 0, 2.0, 0, SKIN));
      p.push(cn(0.16, 0.2, 6, 0, 2.18, 0, HELM));
      p.push(cy(0.02, 0.02, 2.2, 5, 0.32, 1.7, 0.12, 0x4a3826));
      p.push(cn(0.045, 0.18, 5, 0.32, 2.85, 0.12, 0x8a8f96));
      break;
    }
  }
  return BGU.mergeGeometries(p, false);
}

const GEO = {};
export function soldierGeo(type) {
  if (!GEO[type]) GEO[type] = buildSoldier(type);
  return GEO[type];
}

export function makeSoldierMesh(type) {
  const mesh = new THREE.Mesh(soldierGeo(type), soldierMat);
  mesh.castShadow = true;
  return mesh;
}

// ---------- รถทุบประตู (battering ram) ----------
export function makeRamMesh() {
  const p = [];
  // โครงคาน + ล้อ
  p.push(bx(2.2, 0.18, 4.4, 0, 1.15, 0, 0x6b4a2a));
  for (const [px, pz] of [[-1.0, -1.5], [1.0, -1.5], [-1.0, 1.5], [1.0, 1.5]]) {
    p.push(bx(0.16, 1.1, 0.16, px, 0.55, pz, 0x5a4026));
    p.push(cy(0.45, 0.45, 0.14, 8, px, 0.45, pz + 0.35, 0x4a3420, 0, 0, Math.PI / 2));
  }
  // หลังคาคลุมเพลาะ (กันธนู แต่กันหินไม่ได้)
  p.push(bx(2.4, 0.16, 4.8, 0, 2.0, 0, 0x7a5230));
  p.push(bx(0.18, 0.75, 4.8, -1.15, 1.6, 0, 0x5a4026));
  p.push(bx(0.18, 0.75, 4.8, 1.15, 1.6, 0, 0x5a4026));
  // ทวนไม้ยักษ์
  p.push(cy(0.34, 0.34, 4.2, 6, 0, 1.5, -0.3, 0x4a3420, Math.PI / 2));
  p.push(cy(0.4, 0.4, 0.5, 6, 0, 1.5, 2.0, 0x8a8f96, Math.PI / 2));
  p.push(cy(0.3, 0.3, 0.6, 6, 0, 1.9, -0.4, 0x8a6238, 0, 0, 0));
  const mesh = new THREE.Mesh(BGU.mergeGeometries(p, false), soldierMat);
  mesh.castShadow = true;
  return mesh;
}

// ---------- บันได ----------
export function makeLadder(len) {
  const p = [];
  p.push(cy(0.055, 0.055, len, 5, -0.28, len / 2, 0, 0x7a5230));
  p.push(cy(0.055, 0.055, len, 5, 0.28, len / 2, 0, 0x7a5230));
  for (let y = 0.6; y < len - 0.4; y += 0.95) {
    p.push(cy(0.032, 0.032, 0.6, 5, 0, y, 0, 0x8a6238, 0, 0, Math.PI / 2));
  }
  const mesh = new THREE.Mesh(BGU.mergeGeometries(p, false), soldierMat);
  mesh.castShadow = true;
  return mesh;
}

export const rockGeo = new THREE.DodecahedronGeometry(0.42);
export const rockMat = new THREE.MeshLambertMaterial({ color: 0x7d7d7d, flatShading: true });

export const arrowGeo = BGU.mergeGeometries([
  colorize(new THREE.CylinderGeometry(0.014, 0.014, 0.72, 4).rotateX(Math.PI / 2), 0x4a3826),
  colorize(new THREE.ConeGeometry(0.035, 0.12, 4).rotateX(Math.PI / 2).translate(0, 0, 0.4), 0x9aa3ad),
]);
export const arrowMat = soldierMat;

export const sparkGeo = new THREE.IcosahedronGeometry(0.13);

// วงเลือกกองร้อย
export const ringGeo = new THREE.RingGeometry(2.5, 3.1, 28);
export const ringGeoBig = new THREE.RingGeometry(3.4, 4.1, 28);
export const ringMatSel = new THREE.MeshBasicMaterial({ color: 0xe8c14a, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
export const ringMatHover = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
