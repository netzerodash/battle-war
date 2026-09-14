export const ORDER_KIND = Object.freeze({
  MOVE: 'move',
  ASSAULT_WALL: 'assault-wall',
  ENTER_GATE: 'enter-gate',
  HOLD: 'hold',
  ESCORT: 'escort',
  RETREAT: 'retreat',
});

export const ORDER_PHASE = Object.freeze({
  REGROUP: 'regroup',
  TRANSIT: 'transit',
  APPROACH: 'approach',
  DEPLOY: 'deploy',
  ENGAGE: 'engage',
  COMPLETE: 'complete',
});

export const FORMATIONS = Object.freeze(['line', 'column', 'shield-front', 'loose']);
export const STANCES = Object.freeze(['hold', 'aggressive', 'avoid-arrows']);

export const ORDER_LABELS = Object.freeze({
  [ORDER_KIND.MOVE]: 'เคลื่อนทัพ',
  [ORDER_KIND.ASSAULT_WALL]: 'บุกกำแพง',
  [ORDER_KIND.ENTER_GATE]: 'เข้าประตูเมือง',
  [ORDER_KIND.HOLD]: 'ตรึงแนว/ล่อกำลัง',
  [ORDER_KIND.ESCORT]: 'คุ้มกัน',
  [ORDER_KIND.RETREAT]: 'ถอนกำลัง',
});

export const PHASE_LABELS = Object.freeze({
  [ORDER_PHASE.REGROUP]: 'รวมขบวน',
  [ORDER_PHASE.TRANSIT]: 'เดินทาง',
  [ORDER_PHASE.APPROACH]: 'เข้าประชิด',
  [ORDER_PHASE.DEPLOY]: 'จัดแนว',
  [ORDER_PHASE.ENGAGE]: 'ปะทะ',
  [ORDER_PHASE.COMPLETE]: 'ถึงที่หมาย',
});

export function normalizeFormation(value) {
  return FORMATIONS.includes(value) ? value : 'line';
}

export function normalizeStance(value) {
  return STANCES.includes(value) ? value : 'aggressive';
}

export function createOrder({ kind, targetPoint = null, targetSide = null, route = [], formation = 'line', stance = 'aggressive', issuedAt = 0 }) {
  if (!Object.values(ORDER_KIND).includes(kind)) throw new Error(`Unknown order kind: ${kind}`);
  return {
    kind,
    phase: route.length > 1 ? ORDER_PHASE.TRANSIT : ORDER_PHASE.APPROACH,
    targetSide,
    targetPoint: targetPoint?.clone ? targetPoint.clone() : targetPoint,
    route: route.map((p) => p.clone ? p.clone() : p),
    routeIndex: 0,
    formation: normalizeFormation(formation),
    stance: normalizeStance(stance),
    issuedAt,
    stuckFor: 0,
    replanCount: 0,
    waitingReason: '',
  };
}

export function orderKindFromContext(cls, gateOpen) {
  if (cls.type === 'assault') return ORDER_KIND.ASSAULT_WALL;
  if (cls.type === 'city') return gateOpen ? ORDER_KIND.ENTER_GATE : ORDER_KIND.ASSAULT_WALL;
  return ORDER_KIND.HOLD;
}

