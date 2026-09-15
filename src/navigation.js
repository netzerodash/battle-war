import * as THREE from 'three';
import { CFG } from './config.js';
import {
  SIDE_VECS, sectionOf, worldPoint, regionOf, RINGS, distOutOf,
  gateRoute, gateFrontPoint, gateInsidePoint, clampFieldPoint,
} from './world.js';

const SAFE_PERIMETER = CFG.wallHalf + CFG.archerRange + 8;

// มุมของสี่เหลี่ยมรัศมี c ระหว่างด้านที่ติดกัน a กับ b
const corner = (a, b, c = SAFE_PERIMETER) => {
  const x = (a === 1 || b === 1) ? c : (a === 3 || b === 3) ? -c : 0;
  const z = (a === 2 || b === 2) ? c : (a === 0 || b === 0) ? -c : 0;
  return new THREE.Vector3(x, 0, z);
};

function candidate(fromSide, toSide, step, threats) {
  const points = [];
  let side = fromSide;
  let cost = 0;
  while (side !== toSide) {
    const next = (side + step + 4) % 4;
    points.push(corner(side, next));
    cost += 1 + (threats[next] || 0) * 0.08;
    side = next;
  }
  return { points, cost };
}

// เดินอ้อมนอกระยะธนู เลือกฝั่งของเมืองที่ exposure ต่ำกว่า แล้วค่อยตั้งแถวเข้าหากำแพง
export function assaultRoute(from, targetSide, target, threats = [0, 0, 0, 0]) {
  const fromSide = sectionOf(from);
  if (fromSide === targetSide) return [target.clone()];
  const cw = candidate(fromSide, targetSide, 1, threats);
  const ccw = candidate(fromSide, targetSide, -1, threats);
  const chosen = cw.cost <= ccw.cost ? cw.points : ccw.points;
  const tangent = SIDE_VECS[targetSide].t.dot(target);
  const staging = worldPoint(targetSide, tangent, SAFE_PERIMETER, 0);
  return [...chosen, staging, target.clone()];
}

// เส้นตรงไม่ล้ำเข้าไปในสี่เหลี่ยมรัศมี limit เลย
function segmentStaysOutside(from, target, limit) {
  for (let i = 1; i < 24; i++) {
    const k = i / 24;
    const x = from.x + (target.x - from.x) * k;
    const z = from.z + (target.z - from.z) * k;
    if (Math.max(Math.abs(x), Math.abs(z)) < limit) return false;
  }
  return true;
}

export function routeLength(from, route) {
  let total = 0;
  let prev = from;
  for (const p of route) { total += prev.distanceTo(p); prev = p; }
  return total;
}

// เดินภายในวงแหวนเมือง: ถ้าเส้นตรงตัดกำแพงชั้น ring ให้อ้อมมุมกำแพงชั้นนั้นทางที่สั้นกว่า
export function aroundRing(from, target, ring) {
  const R = RINGS[ring];
  if (!R || segmentStaysOutside(from, target, R.half + R.thick + 1)) return [target.clone()];
  const c = R.half + R.thick + 3;
  const fromSide = sectionOf(from), toSide = sectionOf(target);
  const paths = [1, -1].map((step) => {
    const points = [];
    let side = fromSide;
    while (side !== toSide) {
      const next = (side + step + 4) % 4;
      points.push(corner(side, next, c));
      side = next;
    }
    return points;
  });
  const best = routeLength(from, [...paths[0], target]) <= routeLength(from, [...paths[1], target]) ? paths[0] : paths[1];
  return [...best, target.clone()];
}

// ก้าวถัดไปสำหรับหน่วยที่ไล่ล่าเอง (melee loop) — ไม่พุ่งชนกำแพงชั้นในที่ขวางอยู่
export function nextHop(from, target, region) {
  if (region < 1 || region >= RINGS.length) return target;
  return aroundRing(from, target, region)[0];
}

function withinRegion(from, target, region, threats) {
  if (region === 0) {
    if (target.distanceTo(gateFrontPoint(0)) < 0.01) return [...gateRoute(sectionOf(from), from), target.clone()];
    const safeTarget = clampFieldPoint(target.clone());
    if (segmentStaysOutside(from, safeTarget, CFG.wallHalf + CFG.wallThick + 1)) return [safeTarget];
    return assaultRoute(from, sectionOf(safeTarget), safeTarget, threats);
  }
  return aroundRing(from, target, region);
}

export const normalizeGates = (gates) => (Array.isArray(gates) ? gates : [!!gates, false, false]);

// เส้นทางข้ามชั้นเมือง: เดินในชั้นตัวเองไปหน้าประตู → ลอดประตู → ชั้นถัดไป
// ถ้าเจอประตูที่ยังปิด เส้นทางจบที่หน้าประตูนั้น และบอกไว้ใน route.blockedAt (เลขชั้นกำแพง)
export function routeBetween(from, rawTarget, threats = [0, 0, 0, 0], gatesOpen = []) {
  const gates = normalizeGates(gatesOpen);
  const target = rawTarget.clone();
  const goal = regionOf(target);
  const route = [];
  let cur = from.clone();
  let region = regionOf(from);
  while (region !== goal) {
    if (goal > region) {
      const front = gateFrontPoint(region), inside = gateInsidePoint(region);
      route.push(...withinRegion(cur, front, region, threats));
      if (!gates[region]) { route.blockedAt = region; return route; }
      route.push(inside);
      cur = inside;
      region++;
    } else {
      const ring = region - 1;
      const inside = gateInsidePoint(ring), front = gateFrontPoint(ring);
      route.push(...withinRegion(cur, inside, region, threats));
      if (!gates[ring]) { route.blockedAt = ring; return route; }
      route.push(front);
      cur = front;
      region--;
    }
  }
  route.push(...withinRegion(cur, target, goal, threats));
  return route;
}

// route กลางสำหรับการเดินทั่วไป (ชื่อเดิม) — รับได้ทั้ง boolean (ประตูนอก) หรืออาร์เรย์สถานะประตูทุกชั้น
export function fieldRoute(from, rawTarget, threats = [0, 0, 0, 0], gatesOpen = false) {
  return routeBetween(from, rawTarget, threats, gatesOpen);
}

export { SAFE_PERIMETER, distOutOf };
