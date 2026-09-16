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

// ---------- เมืองสามชั้น ----------
export const RINGS = CFG.rings;
// พื้นที่ภาคพื้น: 0 = ทุ่งนอกเมือง, 1 = เมืองชั้นนอก, 2 = เมืองชั้นใน, 3 = ลานวังต้องห้าม
export const GROUND_ZONES = Object.freeze(['field', 'city', 'inner', 'palace']);
export const zoneRegion = (zone) => GROUND_ZONES.indexOf(zone);
export const isGroundZone = (zone) => GROUND_ZONES.includes(zone);
// อยู่ภายในกำแพงเมืองชั้นใดชั้นหนึ่ง (ใช้แทนเงื่อนไข zone === 'city' เดิม)
export const isInsideZone = (zone) => zoneRegion(zone) >= 1;

// ตัดสินพื้นที่จากตำแหน่งจริง — เส้นแบ่งคือแนวกลางเนื้อกำแพงแต่ละชั้น (ตรงกลางช่องประตู)
export function regionOf(p) {
  const m = distOutOf(p);
  for (let k = 0; k < RINGS.length; k++) if (m >= RINGS[k].half + RINGS[k].thick / 2) return k;
  return RINGS.length;
}

// ประตูทุกชั้นเรียงบนแกนใต้ (x = 0) แบบแกนกลางวังต้องห้าม
export const gateHalfWidth = (ring) => (ring === 0 ? 4.8 : CFG.innerGates.halfWidth);
export function gateFrontPoint(ring = 0) {
  const R = RINGS[ring];
  return worldPoint(2, 0, ring === 0 ? CFG.gate.frontPoint : R.half + R.thick + 3.5, 0);
}
export function gateInsidePoint(ring = 0) {
  const R = RINGS[ring];
  return worldPoint(2, 0, ring === 0 ? CFG.gate.insidePoint : R.half - 2.5, 0);
}

// อยู่ในช่องทางลอดประตูชั้น ring (เผื่อขอบไว้เล็กน้อยให้ก้าวสุดท้ายยังถือว่าอยู่ในช่อง)
export function inGateLane(pos, ring) {
  const R = RINGS[ring];
  return pos.z > 0 && Math.abs(pos.x) <= gateHalfWidth(ring)
    && pos.z >= R.half - 2 && pos.z <= R.half + R.thick + 2;
}

function keepOutsideSquare(pos, limit) {
  if (distOutOf(pos) >= limit) return;
  if (Math.abs(pos.x) >= Math.abs(pos.z)) pos.x = (pos.x >= 0 ? 1 : -1) * limit;
  else pos.z = (pos.z >= 0 ? 1 : -1) * limit;
}

function keepInsideSquare(pos, limit) {
  pos.x = clamp(pos.x, -limit, limit);
  pos.z = clamp(pos.z, -limit, limit);
}

// บังคับหน่วยภาคพื้นให้อยู่ในพื้นที่ของตัวเอง — ข้ามกำแพงได้เฉพาะลอดช่องประตูที่เปิดอยู่
// gatesOpen[k] = ประตูกำแพงชั้น k เปิดหรือยัง
export function constrainToRegion(pos, region, gatesOpen = []) {
  if (region >= 1) {
    const R = RINGS[region - 1];
    if (gatesOpen[region - 1] && inGateLane(pos, region - 1)) pos.z = Math.min(pos.z, R.half + R.thick + 1.2);
    else keepInsideSquare(pos, R.half - 0.8);
  }
  if (region < RINGS.length) {
    const R = RINGS[region];
    if (gatesOpen[region] && inGateLane(pos, region)) pos.z = Math.max(pos.z, R.half - 1.2);
    else keepOutsideSquare(pos, R.half + R.thick + 0.8);
  }
  return pos;
}

export function constrainFieldOutsideWall(pos, gateOpen = false) {
  const inner = CFG.wallHalf - 0.8;
  const m = distOutOf(pos);
  if (m <= inner) return pos; // คนที่อยู่ลึกในเมืองแล้วไม่ถูกผลักออก (โซนจะถูกปรับตามตำแหน่งภายหลัง)
  return constrainToRegion(pos, 0, [gateOpen]);
}

// บังคับตำแหน่งให้อยู่บนยอดกำแพงชั้นนอก (วงแหวนสี่เหลี่ยมหนา wallThick)
export function clampOnWall(pos) {
  const ax = Math.abs(pos.x), az = Math.abs(pos.z);
  const along = CFG.wallHalf + 1;
  if (ax >= az) {
    pos.x = Math.sign(pos.x) * clamp(ax, CFG.wallHalf + 0.8, CFG.wallHalf + CFG.wallThick - 0.8);
    pos.z = clamp(pos.z, -along, along);
  } else {
    pos.z = Math.sign(pos.z) * clamp(az, CFG.wallHalf + 0.8, CFG.wallHalf + CFG.wallThick - 0.8);
    pos.x = clamp(pos.x, -along, along);
  }
}

// โซน "สันกำแพง" ของแต่ละชั้น: index = ชั้นกำแพง (0 = กำแพงนอกใช้ชื่อเดิม 'wall')
export const WALL_ZONES = Object.freeze(['wall', 'wall2', 'wall3']);
export const wallZoneOf = (ring) => WALL_ZONES[ring] || null;
export const ringOfWallZone = (zone) => WALL_ZONES.indexOf(zone);
export const isWallZone = (zone) => WALL_ZONES.includes(zone);

// จำกัดตำแหน่งให้อยู่บนสันกำแพงชั้นใน (ชั้น 1 ขึ้นไป) — เทียบเท่า clampOnWall ของกำแพงนอก
export function clampOnInnerWall(pos, ring) {
  const R = RINGS[ring];
  if (!R) return;
  const ax = Math.abs(pos.x), az = Math.abs(pos.z);
  const along = R.half + 1;
  if (ax >= az) {
    pos.x = Math.sign(pos.x || 1) * clamp(ax, R.half + 0.8, R.half + R.thick - 0.8);
    pos.z = clamp(pos.z, -along, along);
  } else {
    pos.z = Math.sign(pos.z || 1) * clamp(az, R.half + 0.8, R.half + R.thick - 0.8);
    pos.x = clamp(pos.x, -along, along);
  }
  pos.y = R.h + 0.45;
}

// หน่วยอยู่แนวกำแพงด้านไหน
export function sectionOf(pos) {
  const ax = Math.abs(pos.x), az = Math.abs(pos.z);
  if (ax >= az) return pos.x > 0 ? 1 : 3;
  return pos.z > 0 ? 2 : 0;
}

export const sectionCenter = (side) => worldPoint(side, 0, CFG.wallHalf + CFG.wallThick / 2, CFG.walkY);

// จุดบันไดภายในประจำด้าน (ไว้ลงจากกำแพง / กองสำรองขึ้นเสริม)
// ทางขึ้นกำแพงแบบม้าเดิน (马道): ช่วงลาดทอดเลียบหน้าในของกำแพงทั้งเส้น ไม่แทงเข้าเนื้อกำแพง
// แล้วมีชานพักเชื่อมจากหัวบันไดข้ามช่องเว้นใบกำแพงด้านใน ขึ้นสู่ทางเดินบนกำแพง
export function stairPoints(side) {
  return {
    base: worldPoint(side, -17, CFG.wallHalf - 2.1, 0),
    top: worldPoint(side, 17, CFG.wallHalf - 2.1, CFG.walkY),
    landing: worldPoint(side, 19.5, CFG.wallHalf + 1.3, CFG.walkY),
  };
}

function wallTurns() {
  const a = CFG.wallHalf + 1, b = CFG.wallHalf + 4;
  return {
    '0-1': [[a, -b], [b, -a]],
    '1-2': [[b, a], [a, b]],
    '2-3': [[-a, b], [-b, a]],
    '3-0': [[-b, -a], [-a, -b]],
  };
}

function wallTurn(from, to) {
  const turns = wallTurns();
  const forward = to === (from + 1) % 4;
  const pair = turns[`${from}-${to}`] || turns[`${to}-${from}`];
  const ordered = forward ? pair : [...pair].reverse();
  return ordered.map(([x, z]) => new THREE.Vector3(x, CFG.walkY, z));
}

// เส้นทางบนกำแพงเดินตามวงแหวนผ่านมุม ไม่ตัดทแยงผ่านลานเมือง
export function wallRoute(from, to) {
  if (from === to) return [sectionCenter(to)];
  const clockwise = (to - from + 4) % 4;
  const step = clockwise <= 2 ? 1 : -1;
  const out = [];
  let side = from;
  while (side !== to) {
    const next = (side + step + 4) % 4;
    out.push(...wallTurn(side, next));
    side = next;
  }
  out.push(sectionCenter(to));
  return out;
}

// เส้นทางสั้นที่สุดอ้อมวงกำแพงนอกไปหน้าประตูใต้
// side เป็นเพียงข้อมูลย้อนหลังของคำสั่งเดิม; ต้องดูตำแหน่งจริงเสมอ เพราะกองทัพอาจย้ายข้ามด้านแล้ว
export function gateRoute(side, pos) {
  const start = pos || worldPoint(side, 0, CFG.wallHalf + CFG.wallThick + 4, 0);
  const currentSide = sectionOf(start);
  if (currentSide === 2) return [];

  const c = CFG.wallHalf + CFG.wallThick + 4;
  const routes = currentSide === 0
    ? [
      [new THREE.Vector3(-c, 0, -c), new THREE.Vector3(-c, 0, c)],
      [new THREE.Vector3(c, 0, -c), new THREE.Vector3(c, 0, c)],
    ]
    : currentSide === 1
      ? [[new THREE.Vector3(c, 0, c)]]
      : [[new THREE.Vector3(-c, 0, c)]];
  const gate = gateFrontPoint();
  const length = (route) => {
    let total = 0;
    let previous = start;
    for (const point of [...route, gate]) {
      total += previous.distanceTo(point);
      previous = point;
    }
    return total;
  };
  return routes.reduce((best, route) => length(route) < length(best) ? route : best);
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

// จุดบนพื้นอยู่ใต้ตัวกำแพงชั้นในหรือไม่ (ไม่นับช่องประตู) — ใช้แปลงคลิกเป็นคำสั่งพาดบันไดข้าม
export function innerWallAt(p) {
  const m = distOutOf(p);
  for (let ring = 1; ring < RINGS.length; ring++) {
    const R = RINGS[ring];
    if (m < R.half - 0.6 || m > R.half + R.thick + 0.6) continue;
    if (p.z > 0 && Math.abs(p.x) <= gateHalfWidth(ring) + 0.5) return null;
    return { ring, side: sectionOf(p) };
  }
  return null;
}

// จำแนกจุดคลิกขวา: สั่งโจมตีกำแพง / เข้าเมือง / พาดบันไดข้ามกำแพงชั้นใน / เดินไปยืนที่ลาน
export function classifyOrderPoint(p) {
  const wall = innerWallAt(p);
  if (wall) return { type: 'escalade', ring: wall.ring, side: wall.side };
  if (isInsideCity(p)) return { type: 'city' };
  let best = 0, bestD = -Infinity;
  for (let s = 0; s < 4; s++) {
    const d = SIDE_VECS[s].n.dot(p);
    if (d > bestD) { bestD = d; best = s; }
  }
  const tOff = Math.abs(SIDE_VECS[best].t.dot(p));
  if (bestD > CFG.wallHalf + CFG.wallThick + 0.5 && bestD < CFG.wallHalf + 78 && tOff <= CFG.wallHalf + 12) {
    return { type: 'assault', side: best };
  }
  return { type: 'field' };
}

// จุดยืน/จุดหมายฝั่งนอกเมือง ต้องห่างกำแพงพอสมควร (กันสั่งยืนติดกำแพงโดนธนูเปล่า ๆ)
export function clampFieldPoint(p) {
  const minDist = CFG.wallHalf + 10;
  const m = distOutOf(p);
  if (m >= minDist) return p;
  return p.clone().setLength(Math.max(minDist, p.length()) / (m || 1) * m);
}
