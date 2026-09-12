import * as THREE from 'three';
import { CFG } from './config.js';

// 4 ด้านของเมือง: 0=เหนือ 1=ตะวันออก 2=ใต้ 3=ตะวันตก
// n = ทิศจากกลางเมืองออกไป (แนวฉากกำแพง), t = แนวขนานกำแพง
export const SIDE_VECS = [
  { n: new THREE.Vector3(0, 0, -1), t: new THREE.Vector3(1, 0, 0) }, // เหนือ
  { n: new THREE.Vector3(1, 0, 0), t: new THREE.Vector3(0, 0, 1) },  // ตะวันออก
  { n: new THREE.Vector3(0, 0, 1), t: new THREE.Vector3(1, 0, 0) },  // ใต้
  { n: new THREE.Vector3(-1, 0, 0), t: new THREE.Vector3(0, 0, 1) }, // ตะวันตก
];

export function worldPoint(side, tOff, distOut, y = 0) {
  const v = SIDE_VECS[side];
  return new THREE.Vector3()
    .addScaledVector(v.n, distOut)
    .addScaledVector(v.t, tOff)
    .setY(y);
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const distOutOf = (p) => Math.max(Math.abs(p.x), Math.abs(p.z));
export const isInsideCity = (p) => distOutOf(p) < CFG.wallHalf - 0.8;

// บังคับตำแหน่งให้อยู่บนยอดกำแพง (วงแหวนสี่เหลี่ยมหนา 8 หน่วย)
export function clampOnWall(pos) {
  const ax = Math.abs(pos.x), az = Math.abs(pos.z);
  if (ax >= az) {
    pos.x = Math.sign(pos.x) * clamp(ax, CFG.wallHalf + 0.8, CFG.wallHalf + CFG.wallThick - 0.8);
    pos.z = clamp(pos.z, -41, 41);
  } else {
    pos.z = Math.sign(pos.z) * clamp(az, CFG.wallHalf + 0.8, CFG.wallHalf + CFG.wallThick - 0.8);
    pos.x = clamp(pos.x, -41, 41);
  }
}

// หน่วยอยู่แนวกำแพงด้านไหน
export function sectionOf(pos) {
  const ax = Math.abs(pos.x), az = Math.abs(pos.z);
  if (ax >= az) return pos.x > 0 ? 1 : 3;
  return pos.z > 0 ? 2 : 0;
}

export const sectionCenter = (side) => worldPoint(side, 0, CFG.wallHalf + CFG.wallThick / 2, CFG.walkY);

// จุดบันไดภายในประจำด้าน (ไว้ลงจากกำแพง / กองสำรองขึ้นเสริม)
export function stairPoints(side) {
  return {
    base: worldPoint(side, 0, CFG.wallHalf - 1.4, 0),
    top: worldPoint(side, 0, CFG.wallHalf + 3.8, CFG.walkY),
  };
}

// จุดประตูเมืองฝั่งใต้
export const gateFrontPoint = () => worldPoint(2, 0, CFG.gate.frontPoint, 0);
export const gateInsidePoint = () => worldPoint(2, 0, CFG.gate.insidePoint, 0);

// เส้นทางเดิน/ขี่อ้อมกำแพงไปหน้าประตู (จากด้านไหนก็ได้)
export function gateRoute(side, pos) {
  if (side === 2) return [];
  let corners;
  if (side === 0) {
    corners = (pos && pos.x >= 0) ? [[42, -42], [42, 42]] : [[-42, -42], [-42, 42]];
  } else if (side === 1) {
    corners = [[42, 42]];
  } else {
    corners = [[-42, 42]];
  }
  return corners.map(([x, z]) => new THREE.Vector3(x, 0, z));
}

// ด้านที่ใกล้จุด p ที่สุด (ใช้ตีความคำสั่งที่อยู่ในเมืองตอนประตูยังปิด)
export function nearestSide(p) {
  let best = 0, bestD = -Infinity;
  for (let s = 0; s < 4; s++) {
    const d = SIDE_VECS[s].n.dot(p);
    if (d > bestD) { bestD = d; best = s; }
  }
  return best;
}

// จำแนกจุดคลิกขวา: สั่งโจมตีกำแพง / เข้าเมือง / เดินไปยืนที่ลาน
export function classifyOrderPoint(p) {
  if (isInsideCity(p)) return { type: 'city' };
  let best = 0, bestD = -Infinity;
  for (let s = 0; s < 4; s++) {
    const d = SIDE_VECS[s].n.dot(p);
    if (d > bestD) { bestD = d; best = s; }
  }
  const tOff = Math.abs(SIDE_VECS[best].t.dot(p));
  if (bestD > CFG.wallHalf + CFG.wallThick + 0.5 && bestD < 118 && tOff <= 52) {
    return { type: 'assault', side: best };
  }
  return { type: 'field' };
}

// จุดยืน/จุดหมายฝั่งนอกเมือง ต้องอยู่ห่างอย่างน้อย 50 (กันสั่งยืนติดกำแพงโดนธนูเปล่า ๆ)
export function clampFieldPoint(p) {
  const m = distOutOf(p);
  if (m >= 50) return p;
  return p.clone().setLength(Math.max(50, p.length()) / (m || 1) * m);
}
