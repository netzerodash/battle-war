import * as THREE from 'three';
import { CFG } from './config.js';
import { SIDE_VECS, sectionOf, worldPoint, isInsideCity, gateRoute, gateFrontPoint, gateInsidePoint, clampFieldPoint } from './world.js';

const SAFE_PERIMETER = CFG.wallHalf + CFG.archerRange + 8;

const corner = (a, b) => {
  const x = (a === 1 || b === 1) ? SAFE_PERIMETER : (a === 3 || b === 3) ? -SAFE_PERIMETER : 0;
  const z = (a === 2 || b === 2) ? SAFE_PERIMETER : (a === 0 || b === 0) ? -SAFE_PERIMETER : 0;
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

function segmentThreatensWall(from, target) {
  const outer = CFG.wallHalf + CFG.wallThick + 1;
  for (let i = 1; i < 24; i++) {
    const k = i / 24;
    const x = from.x + (target.x - from.x) * k;
    const z = from.z + (target.z - from.z) * k;
    if (Math.max(Math.abs(x), Math.abs(z)) < outer) return true;
  }
  return false;
}

// route กลางสำหรับการเดินภาคสนาม: ถ้าเส้นตรงตัดเมือง ให้เดินอ้อม safe perimeter
export function fieldRoute(from, rawTarget, threats = [0, 0, 0, 0], gateOpen = false) {
  const target = rawTarget.clone();
  const fromInside = isInsideCity(from);
  const targetInside = isInsideCity(target);
  if (fromInside && targetInside) return [target];
  if (fromInside && !targetInside) {
    if (!gateOpen) return [gateInsidePoint()];
    const outside = fieldRoute(gateFrontPoint(), target, threats, true);
    return [gateInsidePoint(), gateFrontPoint(), ...outside];
  }
  if (targetInside) {
    if (!gateOpen) return [gateFrontPoint()];
    return [...gateRoute(sectionOf(from), from), gateFrontPoint(), gateInsidePoint(), target];
  }
  const safeTarget = clampFieldPoint(target);
  if (!segmentThreatensWall(from, safeTarget)) return [safeTarget];
  return assaultRoute(from, sectionOf(safeTarget), safeTarget, threats);
}

export function routeLength(from, route) {
  let total = 0;
  let prev = from;
  for (const p of route) { total += prev.distanceTo(p); prev = p; }
  return total;
}

export { SAFE_PERIMETER };
