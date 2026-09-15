import * as THREE from 'three';
import { CFG, mulberry32 } from './config.js';
import {
  SIDE_VECS, worldPoint, sectionOf, clampOnWall, sectionCenter, nearestSide, clamp,
  stairPoints, gateInsidePoint, clampFieldPoint, wallRoute, constrainFieldOutsideWall,
  RINGS, GROUND_ZONES, isInsideZone, zoneRegion, constrainToRegion, gateFrontPoint, inGateLane, distOutOf,
} from './world.js';
import { Company } from './company.js';
import { DefenseSide, ReserveForce, Garrison } from './defense.js';
import { Soldier } from './soldier.js';
import { rockGeo, rockMat, arrowGeo, arrowMat, sparkGeo, ringGeo, ringGeoBig, ringMatSel, ringMatHover } from './models.js';
import { openGateDoors } from './city.js';
import { sfx } from './audio.js';
import { formationDestinations, compactDestinations } from './formation.js';
import { createOrder, ORDER_KIND } from './orders.js';
import { battleOutcome, palaceProgressStep } from './rules.js';
import { SpatialHash } from './spatial-hash.js';
import { EngagementRegistry } from './engagement.js';
import { assaultRoute, fieldRoute, nextHop } from './navigation.js';
import { chooseTacticalTarget } from './tactical-ai.js';
import { DefenderMarkers, DefenderGroupLabels, markerScaleForDistance } from './markers.js';

const SPARK_MATS = {
  red: new THREE.MeshBasicMaterial({ color: 0xc03028 }),
  dust: new THREE.MeshBasicMaterial({ color: 0x9a917f }),
  wood: new THREE.MeshBasicMaterial({ color: 0x7a5230 }),
  blue: new THREE.MeshBasicMaterial({ color: 0x3d7ac0 }),
  gold: new THREE.MeshBasicMaterial({ color: 0xf0b83e }),
  gray: new THREE.MeshBasicMaterial({ color: 0xcfcabc }),
};
const HP_BACK_MAT = new THREE.SpriteMaterial({ color: 0x24130f, opacity: 0.82, transparent: true, depthTest: false, depthWrite: false });
const HP_FRONT_MAT = new THREE.SpriteMaterial({ color: 0x55c96b, depthTest: false, depthWrite: false });

const ORDER_VISUALS = Object.freeze({
  attack: Object.freeze({ kind: 'attack', icon: '⚔', color: 0xe65a45, background: '#6f201c' }),
  move: Object.freeze({ kind: 'move', icon: '👣', color: 0x63f2e5, background: '#06383a', iconColor: '#ffffff' }),
});
const ORDER_ICON_TEXTURES = new Map();

export function orderVisual(type) {
  // เข้าเมืองคือการบุกไล่ล่า ต้องเห็นเป็นคำสั่งโจมตี ไม่ใช่รอยเท้าเดินทัพ
  return type === 'assault' || type === 'city' || type === 'escalade' ? ORDER_VISUALS.attack : ORDER_VISUALS.move;
}

function orderIconTexture(visual) {
  if (ORDER_ICON_TEXTURES.has(visual.kind)) return ORDER_ICON_TEXTURES.get(visual.kind);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.beginPath();
  ctx.arc(64, 64, 55, 0, Math.PI * 2);
  ctx.fillStyle = visual.background;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = `#${visual.color.toString(16).padStart(6, '0')}`;
  ctx.stroke();
  if (visual.kind === 'move') {
    // วาดรอยเท้าเองเพื่อไม่ให้ระบบปฏิบัติการเปลี่ยนเป็น emoji สีน้ำตาลที่กลืนกับพื้น
    const drawFoot = (x, y, rotation) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      ctx.beginPath();
      ctx.ellipse(0, 7, 8, 16, 0, 0, Math.PI * 2);
      ctx.ellipse(-5, -10, 3.8, 5, -0.25, 0, Math.PI * 2);
      ctx.ellipse(0, -13, 3.5, 4.5, 0, 0, Math.PI * 2);
      ctx.ellipse(5, -11, 3.2, 4, 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    ctx.fillStyle = visual.iconColor;
    ctx.shadowColor = '#63f2e5';
    ctx.shadowBlur = 10;
    drawFoot(45, 78, -0.35);
    drawFoot(79, 49, -0.35);
    ctx.shadowBlur = 0;
  } else {
    ctx.font = 'bold 62px "Apple Color Emoji", "Noto Sans Thai", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff4d6';
    ctx.fillText(visual.icon, 64, 67);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  ORDER_ICON_TEXTURES.set(visual.kind, texture);
  return texture;
}

function makeOrderIcon(visual, opacity = 1) {
  const material = new THREE.SpriteMaterial({
    map: orderIconTexture(visual), transparent: true, opacity, depthTest: false, depthWrite: false,
  });
  const icon = new THREE.Sprite(material);
  icon.scale.set(7.5, 7.5, 1);
  icon.renderOrder = 20;
  return icon;
}

const _q = new THREE.Quaternion();
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
// สถานะที่กองร้อยกำลังพาทหารเดินตามคำสั่งอยู่ — melee loop ต้องไม่ลากทหารแย่งกับกอง
const COMPANY_MOVE_STATES = new Set(['march', 'ride', 'cityMarch', 'escalade']);
const PALACE_RED = new THREE.Color(0xb03030);
const PALACE_BLUE = new THREE.Color(0x3d7ac0);

// ลานรวมพลในเมืองชั้นนอก: กึ่งกลางระหว่างประตูนอกกับประตูเมืองชั้นใน บนแกนใต้
export function cityRallyPoint() {
  return worldPoint(2, 0, (CFG.rings[1].half + CFG.rings[1].thick + CFG.wallHalf) / 2, 0);
}

// คำสั่งเข้าเมือง: ทุกกองมุ่งจุดที่คลิกจุดเดียว จัดเป็นก้อนชิดรอบจุดนั้น และไม่หลุดออกนอกกำแพงเมือง
export function cityOrderDestinations(companies, point) {
  const limit = CFG.wallHalf - 4;
  const center = new THREE.Vector3(clamp(point.x, -limit, limit), 0, clamp(point.z, -limit, limit));
  return compactDestinations(companies, center, 5)
    .map((p) => p.set(clamp(p.x, -limit, limit), 0, clamp(p.z, -limit, limit)));
}

// บันไดภายในประจำด้าน — เลนขึ้น/เลนลง คุมระยะห่าง
class StairChannel {
  constructor(side) {
    this.side = side;
    // เส้นทาง: โคนบันได → หัวบันได (เลียบกำแพง) → ชานพักบนทางเดินกำแพง
    const { base, top, landing } = stairPoints(side);
    this.base = base;
    this.top = landing;
    this.segs = [[base, top], [top, landing]].map(([a, b]) => {
      const flat = b.clone().sub(a).setY(0).normalize();
      return { a, b, len: a.distanceTo(b), lateral: new THREE.Vector3(flat.z, 0, -flat.x) };
    });
    this.len = this.segs.reduce((n, seg) => n + seg.len, 0);
    this.up = [];
    this.down = [];
  }
  pointAt(dist, out) {
    let rem = Math.max(0, Math.min(this.len, dist));
    for (let i = 0; i < this.segs.length; i++) {
      const seg = this.segs[i];
      if (rem <= seg.len || i === this.segs.length - 1) {
        out.lerpVectors(seg.a, seg.b, Math.min(1, rem / seg.len));
        return seg;
      }
      rem -= seg.len;
    }
    return this.segs[0];
  }
  // วางทหารตามเลนขึ้น (+) / เลนลง (−) ของช่วงที่อยู่ แล้วหันหน้าไปทางที่เดิน
  place(s, dir, dt) {
    const seg = this.pointAt(s.stair.s, _t1);
    s.pos.copy(_t1).addScaledVector(seg.lateral, dir * 0.95);
    this.pointAt(s.stair.s + dir * 1.5, _t2);
    s.facePoint(_t2, dt);
  }
  requestUp(s) {
    if (s.stair) return false;
    s.stair = { s: 0 }; s.state = 'stairUp'; s.zone = 'stair'; this.up.push(s);
    return true;
  }
  requestDown(s) {
    if (s.stair) return false;
    s.stair = { s: this.len }; s.state = 'stairDown'; s.zone = 'stair'; this.down.push(s);
    return true;
  }
  downCount() { return this.down.length; }
  update(dt, onUp, onDown) {
    this._move(this.up, 1, dt, onUp);
    this._move(this.down, -1, dt, onDown);
  }
  _move(list, dir, dt, onArrive) {
    for (let i = list.length - 1; i >= 0; i--) {
      if (!list[i].alive || !list[i].stair) list.splice(i, 1);
    }
    list.sort((a, b) => (dir > 0 ? b.stair.s - a.stair.s : a.stair.s - b.stair.s));
    let prevS = null;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (!s.alive) { s.stair = null; continue; }
      let arrived = false;
      if (dir > 0) {
        const cap = prevS === null ? this.len : prevS - CFG.rockLogi.spacing;
        s.stair.s = Math.min(cap, s.stair.s + CFG.rockLogi.stairSpeed * dt);
        this.place(s, 1, dt);
        prevS = s.stair.s;
        if (s.stair.s >= this.len - 0.02) { arrived = true; prevS = this.len; }
      } else {
        const cap = prevS === null ? 0 : prevS + CFG.rockLogi.spacing;
        s.stair.s = Math.max(cap, s.stair.s - CFG.rockLogi.stairSpeed * dt);
        this.place(s, -1, dt);
        prevS = s.stair.s;
        if (s.stair.s <= 0.02) { arrived = true; prevS = 0; }
      }
      if (arrived) { onArrive(s); s.stair = null; }
    }
    for (let i = list.length - 1; i >= 0; i--) {
      if (!list[i].alive || !list[i].stair) list.splice(i, 1);
    }
  }
}

export class Battle {
  constructor(mission, scene, cityRefs, onEvent) {
    this.mission = mission;
    this.citySides = cityRefs.sides;
    this.doorL = cityRefs.doorL;
    this.doorR = cityRefs.doorR;
    this.gateDoors = cityRefs.gates || [];
    this.palaceFlag = cityRefs.palaceFlag || null;
    this.onEvent = onEvent;
    this.rng = mulberry32(mission.seed ^ 0x51ab);
    this.group = new THREE.Group();
    scene.add(this.group);

    this.time = 0;
    this.ended = false;
    this.result = null;
    this.nextLadderId = 0;
    this.slotCounter = [0, 0, 0, 0];
    this.archerSlotCounter = [0, 0, 0, 0];
    this.companies = [];
    this.defenses = [];
    this.reserves = null;
    this.wallFighters = [[], [], [], []].map(() => new Set());
    this.wallDefenderCounts = [0, 0, 0, 0]; // ทหารเมืองบนยอดกำแพงแต่ละช่วง (นับตามตำแหน่งจริง ไม่ว่ามาจากด้านไหน)
    this.stairAssaultEnRoute = [0, 0, 0, 0];
    this.cityAttackers = new Set();
    this.gateOpeners = new Set();
    this.selection = new Set();
    this.hover = null;
    this.stairs = [0, 1, 2, 3].map((s) => new StairChannel(s));
    this.captured = [false, false, false, false];
    this.capT = [0, 0, 0, 0];
    this.captureDirective = [null, null, null, null];
    this.captureDecisionAt = [0, 0, 0, 0];
    this.feintHeat = [0, 0, 0, 0];
    this.gate = { open: false, progress: 0, anim: 0, started: false, breach: 0 };
    // ประตูเมืองชั้นใน (ชั้น 1) และประตูวัง (ชั้น 2)
    this.innerGates = RINGS.slice(1).map((_, i) => {
      const ring = i + 1;
      const hp = CFG.innerGates.hp[ring];
      return { ring, open: false, hp, hpMax: hp, progress: 0, anim: 0, started: false, hackT: 0 };
    });
    this.palace = { progress: 0, atk: 0, def: 0 };
    this.rocks = [];
    this.arrows = [];
    this.sparks = [];
    this.fallingLadders = [];
    this.markers = [];
    this._ground = [];
    this.sally = { active: false, cooldown: 25, horses: [], t: 0, target: null };
    this.shake = 0; // ความแรงจอสั่น (decay เอง)
    this.wallSupportLimit = 28;
    this.commandFormation = 'line';
    this.commandStance = 'aggressive';
    this.movementGrid = new SpatialHash(CFG.movement.spatialCell);
    this._nearby = [];
    this.engagements = new EngagementRegistry();
    this.metrics = { wallViolations: 0, overlapPairs: 0, chokeOverlapPairs: 0, stuckCompanies: 0, maxAttackersPerTarget: 0, sampleT: 0 };
    this.orderPreview = null;
    this.orderPreviewKey = '';
    this.lastCombatPos = null;
    this.lastCombatAt = -Infinity;
    this.stats = { kills: 0, losses: 0, rocksUsed: 0, attackersAlive: 0, deployedTotal: 0, defendersTotal: 0, defendersInitial: 0, capturedCount: 0 };

    // ทัพโจมตี: ด้านละ 44 กอง (หอก24 โล่12 ธนู8) + รถทุบเฉพาะด้านใต้ + กองม้า
    for (let side = 0; side < 4; side++) {
      CFG.army.composition.forEach((ctype, i) => {
        const col = (i % 8) - 3.5, row = Math.floor(i / 8);
        const anchor = worldPoint(side, col * 9, CFG.spawnDist + row * 10, 0);
        this.companies.push(new Company(i, side, ctype, anchor, this));
      });
    }
    const infantryDepth = CFG.spawnDist + Math.ceil(CFG.army.composition.length / 8) * 10;
    const ramDepth = infantryDepth + 12;
    for (let i = 0; i < CFG.army.ramCompanies; i++) {
      const anchor = worldPoint(2, (i - (CFG.army.ramCompanies - 1) / 2) * 12, ramDepth, 0);
      this.companies.push(new Company(i, 2, 'ram', anchor, this));
    }
    for (let i = 0; i < CFG.army.cavalryCompanies; i++) {
      const col = i % 8, row = Math.floor(i / 8);
      const anchor = worldPoint(2, (col - 3.5) * 13, ramDepth + 18 + row * 15, 0);
      this.companies.push(new Company(i, 2, 'cav', anchor, this));
    }
    this.stats.deployedTotal = this.companies.reduce((a, c) => a + c.soldiers.length, 0);

    mission.sides.forEach((cfg, side) => this.defenses.push(new DefenseSide(side, cfg, this)));
    this.reserves = new ReserveForce(this);
    this.garrison = new Garrison(this);
    this.stats.defendersInitial = this.defenses.reduce((a, d) => a + d.aliveCount(), 0)
      + this.reserves.aliveCount() + this.garrison.aliveCount();
    this.stats.defendersTotal = this.stats.defendersInitial;

    for (const c of this.companies) {
      const ring = new THREE.Mesh(c.ctype === 'cav' || c.ctype === 'ram' ? ringGeoBig : ringGeo, ringMatSel);
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      this.group.add(ring);
      c.selRing = ring;
      const hpBack = new THREE.Sprite(HP_BACK_MAT);
      const hpFront = new THREE.Sprite(HP_FRONT_MAT);
      hpBack.scale.set(4.4, 0.42, 1);
      hpFront.scale.set(4, 0.24, 1);
      hpBack.visible = hpFront.visible = false;
      this.group.add(hpBack, hpFront);
      c.healthBar = { back: hpBack, front: hpFront };
    }
    // ตัวช่วยมองเห็นทหารเมือง: วงสีใต้เท้า + ป้ายจำนวนต่อกลุ่ม (อัปเดตจาก main ทุกเฟรม แม้หยุดเกม)
    this.defMarkers = new DefenderMarkers(this.group);
    this.defLabels = new DefenderGroupLabels(this.group);
    this.defGroupT = 0;
    this.defGroups = [];
    this.hoverRing = new THREE.Mesh(ringGeo, ringMatHover);
    this.hoverRing.rotation.x = -Math.PI / 2;
    this.hoverRing.visible = false;
    this.group.add(this.hoverRing);
  }

  // ---------- คำสั่งจากแม่ทัพ ----------
  assignPlantSlot(side, kind = 'ladder') {
    if (kind === 'archer') {
      const i = this.archerSlotCounter[side]++;
      const span = CFG.wallHalf - 5;
      return -span + ((i % 8) + 0.5) * ((span * 2) / 8);
    }
    const i = this.slotCounter[side]++;
    const span = CFG.wallHalf - 9;
    return -span + ((i % 40) + 0.5) * ((span * 2) / 40);
  }

  laddersOf(side) {
    return this.companies.filter((c) => c.side === side && c.ladder).map((c) => c.ladder);
  }

  groundAttackers() { return this._ground; }

  wallThreats() {
    return this.defenses.map((d) =>
      d.archers.filter((s) => s.alive && s.zone === 'wall').length
      + d.aliveMelee() * 0.15
      + d.rock.pile * 0.08);
  }

  invadersInCity() {
    let n = 0;
    for (const s of this.cityAttackers) if (s.alive) n++;
    return n;
  }

  nearestInvader(pos, radius) {
    let best = null, bestD = radius;
    for (const s of this.cityAttackers) {
      if (!s.alive || s.zone !== 'city') continue; // กองสำรองอยู่เมืองชั้นนอก ไล่ได้เฉพาะผู้บุกในชั้นเดียวกัน
      const d = pos.distanceTo(s.pos);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best;
  }

  // หน่วยบนยอดกำแพงฝ่ายเมืองทั้งหมด (เป้าธนูฝ่ายโจมตี)
  wallDefenders() {
    const out = [];
    for (const d of this.defenses) {
      for (const s of d.melee) if (s.alive && s.zone === 'wall') out.push(s);
      for (const s of d.archers) if (s.alive && s.zone === 'wall') out.push(s);
      for (const c of d.carriers) if (c.s.alive && c.s.zone === 'wall') out.push(c.s);
    }
    return out;
  }

  attackerArcherTargets() {
    const out = this.wallDefenders();
    if (this.gate.open) {
      for (const d of this.defenses) {
        for (const s of d.melee) if (s.alive && s.zone === 'city') out.push(s);
        for (const s of d.archers) if (s.alive && s.zone === 'city') out.push(s);
        for (const carrier of d.carriers) if (carrier.s.alive && carrier.s.zone === 'city') out.push(carrier.s);
      }
      for (const sq of this.reserves.squads) {
        for (const s of sq.soldiers) if (s.alive && s.zone === 'city') out.push(s);
      }
    }
    for (const s of this.sally.horses) if (s.alive && s.zone === 'field') out.push(s);
    return out;
  }

  ramUnderGate() {
    return this.companies.find((c) => c.ramMesh && c.state === 'battering' && c.aliveSoldiers.length > 0) || null;
  }

  assignArcherRamFallback() {
    if (this.gate.open) return false;
    if (this.companies.some((c) => c.aliveSoldiers.length > 0
      && ((c.ctype === 'ram' && c.ramMesh && c.ramHp > 0) || c.gateCrew))) return false;
    const abandoned = this.companies.find((c) => {
      if (!c.ramMesh || c.ramHp <= 0 || c.aliveSoldiers.length > 0) return false;
      if (c.ramClaimedBy?.aliveSoldiers?.length > 0) return false;
      c.ramClaimedBy = null;
      return true;
    });
    if (!abandoned) return false;
    const archer = this.companies
      .filter((c) => c.ctype === 'archer' && !c.gateCrew && c.aliveSoldiers.length > 0)
      .sort((a, b) => a.anchor.distanceToSquared(abandoned.anchor) - b.anchor.distanceToSquared(abandoned.anchor))[0];
    return archer ? archer.takeOverRam(abandoned) : false;
  }

  rearmArchersAfterCapture(side) {
    let soldiers = 0;
    for (const company of this.companies) {
      if (company.ctype !== 'archer' || company.side !== side || company.aliveSoldiers.length === 0) continue;
      const n = company.aliveSoldiers.length;
      if (!company.rearmAsSpear()) continue;
      soldiers += n;
      if (!company.gateCrew) {
        company.mode = 'hold';
        company.state = 'hold';
        company.orderAssault(side, { formation: 'column', stance: 'aggressive' });
      }
    }
    if (soldiers > 0) this.onEvent('archer_rearmed', { side, n: soldiers });
    return soldiers;
  }

  releaseGateAssaultCompanies(companies = null) {
    const rally = cityRallyPoint();
    const crews = companies || this.companies.filter((c) => c.gateCrew
      || (c.ramMesh && c.state === 'battering' && c.aliveSoldiers.length > 0));
    for (const company of crews) {
      if (company.ctype === 'archer') company.rearmAsSpear(false);
      company.gateCrew = false;
      if (company.ramSource?.ramClaimedBy === company) company.ramSource.ramClaimedBy = null;
      company.ramSource = null;
      company.destroyRamMesh();
      company.mode = 'hold';
      company.state = 'hold';
      company.orderCity(rally, { formation: 'column', stance: 'aggressive' });
    }
  }

  // เมื่อประตูเปิด กองที่กำลังเข้าตีประตูใต้ไม่ควรเดินชนกำแพงต่อ
  // ส่งเฉพาะหน่วยภาคสนามเข้าประตู; พลธนูและคนที่กำลังปีนยังทำหน้าที่เดิมบนกำแพง
  routeOpenGateAttackers() {
    let ordered = this.rerouteBlockedCompanies(0);

    const infantry = this.companies.filter((company) => company.kind === 'inf'
      && company.ctype !== 'archer'
      && company.mode === 'assault'
      && company.side === 2
      && company.aliveSoldiers.length > 0
      && company.aliveSoldiers.every((soldier) => soldier.zone === 'field' && !soldier.climb)
      && company.orderable());
    const destinations = cityOrderDestinations(infantry, cityRallyPoint());
    infantry.forEach((company, index) => {
      if (company.orderCity(destinations[index], { formation: 'column', stance: 'aggressive' })) ordered++;
    });
    return ordered;
  }

  // โล่ที่ยังมีชีวิต (ใช้ตรวจกำบังธนู)
  liveShields() {
    const out = [];
    for (const c of this.companies) if (c.ctype === 'shield') for (const s of c.soldiers) if (s.alive) out.push(s);
    return out;
  }

  covered(target, shields) {
    for (const sh of shields) {
      if (sh.pos.distanceToSquared(target.pos) < CFG.unit.shield.coverRadius ** 2) return true;
    }
    return false;
  }

  toggleSelect(comp, additive) {
    if (!additive) this.clearSelection();
    if (comp.selected && additive) {
      comp.selected = false;
      this.selection.delete(comp);
    } else {
      comp.selected = true;
      this.selection.add(comp);
    }
  }

  selectNearbySameType(comp, radius = 45) {
    this.clearSelection();
    const center = comp.flagPos;
    for (const c of this.companies) {
      if (c.ctype !== comp.ctype || c.aliveSoldiers.length === 0) continue;
      if (c.flagPos.distanceTo(center) > radius) continue;
      c.selected = true;
      this.selection.add(c);
    }
    return this.selection.size;
  }

  clearSelection() {
    for (const c of this.selection) c.selected = false;
    this.selection.clear();
    this.clearOrderPreview?.();
  }

  setHover(comp) { this.hover = comp; }

  issueAssault(side, ladder, archers, rams, cav) {
    const tactics = { formation: this.commandFormation, stance: this.commandStance };
    const active = this.companies.filter((c) => c.ladder && c.mode === 'assault' && c.side === side && c.aliveSoldiers.length > 0).length;
    let slots = CFG.maxAssaultPerSide - active;
    let ordered = 0;
    // กองที่อยู่ในเมืองแล้วขึ้นบันไดในของด้านนั้น แทนการเดินออกประตูไปพาดบันไดจากข้างนอก
    const outside = [];
    for (const c of ladder) {
      if (!c.aliveSoldiers.some((s) => isInsideZone(s.zone))) outside.push(c);
      else if (this.orderInnerStairAssault(c, side)) ordered++;
    }
    const climbers = outside.filter((c) => c.ctype !== 'ram' || side !== 2 || !c.ramMesh || c.ramHp <= 0);
    for (const c of climbers) {
      if (slots <= 0) break;
      if (c.orderAssault(side, tactics)) { slots--; ordered++; }
    }
    for (const c of archers) if (c.orderAssault(side, tactics)) ordered++;
    if (side === 2) {
      for (const c of rams) if (c.ramMesh && c.ramHp > 0 && c.orderAssault(side, tactics)) ordered++;
    }
    const cavPoints = formationDestinations(cav, worldPoint(side, 0, CFG.wallHalf + CFG.wallThick + 16, 0), 14, this.commandFormation);
    for (let i = 0; i < cav.length; i++) if (cav[i].orderRide(clampFieldPoint(cavPoints[i]), tactics)) ordered++;
    return ordered;
  }

  // ทหารในเมืองขึ้นบันไดในไปจัดการทหารเมืองที่ค้างบนยอดกำแพง
  orderInnerStairAssault(company, side) {
    if (!this.wallDefenderCounts.some((n) => n > 0)) return false;
    const climbers = company.aliveSoldiers.filter((s) => s.zone === 'city' && !s.stair && s.kind === 'inf');
    if (!climbers.length) return false;
    const objective = this.wallDefenderCounts[side] > 0 ? side : this.nearestDefendedWall(side);
    company.mode = 'assault';
    company.state = 'holdAt'; // กองไม่ลากทหาร ปล่อยให้เดินเข้าบันไดเอง
    company.waypoints = null;
    company.order = createOrder({
      kind: ORDER_KIND.ASSAULT_WALL, targetPoint: stairPoints(side).base, targetSide: side,
      formation: company.formation, stance: company.stance, issuedAt: this.time,
    });
    for (const s of climbers) this.sendUpInnerStair(s, side, objective);
    return true;
  }

  sendUpInnerStair(s, stairSide, objectiveSide) {
    this.engagements.release(s);
    s.state = 'toStairUp';
    s.stairClimbSide = stairSide;
    s.wallObjectiveSide = objectiveSide;
    s.orderTarget = stairPoints(stairSide).base;
    s.waypoints = null;
    s.stairAssault = true;
    s.intent = 'climb-inner-stair';
    this.stairAssaultEnRoute[stairSide]++;
  }

  // ในเมืองไม่มีใครให้ล่าแล้ว แต่ยังมีทหารเมืองบนกำแพง → ขึ้นบันไดในของช่วงที่ใกล้ที่สุด
  autoClimbToWall(u) {
    if (u.kind !== 'inf') return false;
    let best = -1, bestD = Infinity;
    for (let side = 0; side < 4; side++) {
      if (this.wallDefenderCounts[side] === 0 || this.stairAssaultEnRoute[side] >= CFG.stairAssault.maxEnRoute) continue;
      const d = u.pos.distanceToSquared(stairPoints(side).base);
      if (d < bestD) { bestD = d; best = side; }
    }
    if (best < 0) return false;
    this.sendUpInnerStair(u, best, best);
    return true;
  }

  updateStairAscent() {
    const anyWallDefenders = this.wallDefenderCounts.some((n) => n > 0);
    this.stairAssaultEnRoute.fill(0);
    for (const s of this.cityAttackers) {
      if (!s.alive || s.stair || s.state !== 'toStairUp') continue;
      if (!anyWallDefenders) {
        s.state = 'order';
        s.stairAssault = false;
        s.orderTarget = null;
        s.intent = 'clear-city';
        continue;
      }
      this.stairAssaultEnRoute[s.stairClimbSide]++;
      if (s.pos.distanceTo(stairPoints(s.stairClimbSide).base) < 1.3) this.stairs[s.stairClimbSide].requestUp(s);
    }
    for (const st of this.stairs) for (const s of st.up) if (s.faction === 'atk') this.stairAssaultEnRoute[st.side]++;
  }

  refreshWallDefenders() {
    const counts = this.wallDefenderCounts;
    counts.fill(0);
    for (const d of this.defenses) {
      for (const s of d.melee) if (s.alive && s.zone === 'wall' && !s.stair) counts[sectionOf(s.pos)]++;
      for (const s of d.archers) if (s.alive && s.zone === 'wall' && !s.stair) counts[sectionOf(s.pos)]++;
    }
  }

  nearestDefendedWall(here) {
    return [here, (here + 1) % 4, (here + 3) % 4, (here + 2) % 4].find((side) => this.wallDefenderCounts[side] > 0);
  }

  cityOrderDestinations(companies, point) {
    return cityOrderDestinations(companies, point);
  }

  // สถานะประตูทุกชั้น (นอก → ใน) ใช้คิดเส้นทางและขอบเขตการเดิน
  gatesOpen() {
    return [this.gate.open, ...this.innerGates.map((g) => g.open)];
  }

  // กองที่เคยติดประตูชั้น ring ได้ไปต่อทันทีที่ประตูนั้นเปิด
  rerouteBlockedCompanies(ring) {
    let n = 0;
    for (const c of this.companies) {
      if (c.pendingGate !== ring || !c.pendingTarget || c.aliveSoldiers.length === 0) continue;
      const target = c.pendingTarget.clone();
      c.pendingGate = null;
      c.pendingTarget = null;
      c.waitingGate = false;
      const tactics = { formation: c.formation, stance: c.stance };
      if (c.kind === 'cav' ? c.orderRide(target, tactics) : c.orderCity(target, tactics)) n++;
    }
    return n;
  }

  // พาดบันไดข้ามกำแพงชั้นใน: กระจายจุดพาดของแต่ละกองตามแนวกำแพง ไม่ให้บันไดซ้อนกัน
  orderEscaladeSelected(companies, cls, point) {
    const tactics = { formation: 'column', stance: this.commandStance };
    const t = SIDE_VECS[cls.side].t;
    let n = 0;
    companies.forEach((c, i) => {
      const spot = point.clone().addScaledVector(t, (i - (companies.length - 1) / 2) * 4.5);
      if (c.orderEscalade?.(cls.ring, spot, tactics)) n++;
    });
    return n;
  }

  // ผู้บุกที่อยู่ในกำแพงเมือง (รวมคนกำลังไต่บันไดพาด) — เป้าของพลธนูบนกำแพงชั้นใน
  insideAttackerTargets() {
    const out = [];
    for (const s of this.cityAttackers) if (s.alive && (isInsideZone(s.zone) || s.zone === 'ladder')) out.push(s);
    return out;
  }

  // ธนูชนเนื้อกำแพงชั้นใดชั้นหนึ่ง (ลอดช่องประตูที่เปิดอยู่ได้)
  insideWallSolid(p) {
    const m = distOutOf(p);
    for (let ring = 0; ring < RINGS.length; ring++) {
      const R = RINGS[ring];
      if (m < R.half || m > R.half + R.thick || p.y >= R.h - 0.3) continue;
      const open = ring === 0 ? this.gate.open : this.innerGates[ring - 1]?.open;
      if (open && inGateLane(p, ring)) continue;
      return true;
    }
    return false;
  }

  // ทางเดินหน่วยที่ไล่ล่าเองในวงแหวนเมือง: อ้อมมุมกำแพงชั้นในแทนการพุ่งชนกำแพง
  hopFor(u, target) {
    const region = zoneRegion(u.zone);
    return region >= 1 ? nextHop(u.pos, target, region) : target;
  }

  updateInnerGates(dt) {
    const G = CFG.innerGates;
    for (const g of this.innerGates) {
      const doors = this.gateDoors[g.ring];
      if (g.open) {
        if (g.anim < 1) {
          g.anim = Math.min(1, g.anim + dt / 2.0);
          if (doors) openGateDoors(doors.doorL, doors.doorR, g.anim);
        }
        continue;
      }
      const outsideZone = GROUND_ZONES[g.ring], insideZone = GROUND_ZONES[g.ring + 1];
      const front = gateFrontPoint(g.ring), inside = gateInsidePoint(g.ring);
      let hackers = 0, openers = 0;
      for (const s of this.cityAttackers) {
        if (!s.alive || s.kind !== 'inf') continue;
        if (s.zone === outsideZone && !s.inCombat && s.pos.distanceTo(front) < G.hackRadius) {
          hackers++;
          if (!s.attackTarget) { s.facePoint(front, dt); s.intent = 'hack-inner-gate'; }
        } else if (s.zone === insideZone && s.pos.distanceTo(inside) < G.openRadius) {
          openers++;
        }
      }
      if (hackers > 0) {
        g.hp = Math.max(0, g.hp - dt * G.hackRate * Math.min(hackers, G.hackCap));
        g.hackT += dt;
        if (g.hackT > 0.35) {
          g.hackT = 0;
          this.spawnSpark(front.clone().setY(1.5 + this.rng() * 2.5).addScaledVector(SIDE_VECS[2].n, -2.2), 'wood', 2, 2.2);
          sfx.clash();
        }
        if (!g.started) { g.started = true; this.onEvent('inner_gate_attack', { ring: g.ring }); }
      }
      if (openers > 0) g.progress = Math.min(1, g.progress + dt * (G.insideBase + G.insidePer * Math.min(8, openers)));
      if (g.hp <= 0 || g.progress >= 1) {
        g.open = true;
        this.shake = Math.max(this.shake, 0.8);
        this.onEvent('inner_gate_open', { ring: g.ring, breached: g.hp <= 0 });
        this.rerouteBlockedCompanies(g.ring);
      }
    }
  }

  // ยึดลานวัง: ผู้บุกในลานวังต้องมากกว่าองครักษ์ในลาน แถบจึงเดิน
  updatePalace(dt) {
    let atk = 0, def = 0;
    for (const s of this.cityAttackers) if (s.alive && s.zone === 'palace') atk++;
    for (const s of this.garrison.soldiers) if (s.alive && s.zone === 'palace') def++;
    const before = this.palace.progress;
    this.palace.atk = atk;
    this.palace.def = def;
    this.palace.progress = palaceProgressStep(before, atk, def, dt, CFG.palace);
    if (before === 0 && this.palace.progress > 0) this.onEvent('palace_contest', {});
    if (this.palaceFlag) this.palaceFlag.flagMat.color.copy(PALACE_RED).lerp(PALACE_BLUE, this.palace.progress);
  }

  // กองที่ยืนรักษากำแพงที่ยึดแล้วรับคำสั่งใหม่รายกองได้ ไม่ต้องเปลี่ยนภารกิจทั้งด้าน
  orderWallCompaniesToCity(companies, rallyPoint) {
    const orderedCompanies = new Set();
    let men = 0;
    const sides = new Set();
    for (const company of companies) {
      for (const s of company.aliveSoldiers) {
        if (s.zone !== 'wall' || s.stair) continue;
        const side = this.wallFighters.findIndex((fighters) => fighters.has(s));
        // ลงได้ทั้งกำแพงที่ยึดแล้ว และช่วงที่ไม่เหลือทหารเมืองแล้ว (เช่น ขึ้นบันไดในไปกวาดล้าง)
        if (side < 0 || (!this.captured[side] && this.wallDefenderCounts[side] > 0)) continue;
        s.wallSupport = false;
        s.wallObjectiveSide = undefined;
        s.waypoints = null;
        s.state = 'wall';
        s.forceCityDescent = true;
        s.cityRallyTarget = rallyPoint.clone();
        s.intent = 'descend-to-city';
        orderedCompanies.add(company);
        sides.add(side);
        men++;
      }
    }
    if (orderedCompanies.size) {
      this.onEvent('wall_descent_order', { n: orderedCompanies.size, men, sides: [...sides] });
    }
    return orderedCompanies;
  }

  orderSelected(rawPoint, cls) {
    const point = rawPoint.isVector3 ? rawPoint : new THREE.Vector3(rawPoint.x, rawPoint.y || 0, rawPoint.z);
    const sel = [...this.selection];
    const ladder = sel.filter((c) => c.isLadderCarrier);
    const archers = sel.filter((c) => c.ctype === 'archer');
    const rams = sel.filter((c) => c.ctype === 'ram');
    const cav = sel.filter((c) => c.ctype === 'cav');
    const tactics = { formation: this.commandFormation, stance: this.commandStance };
    let ordered = 0;
    this.clearOrderPreview();
    const visual = orderVisual(cls.type);
    this.spawnMarker(point, visual);

    if (cls.type === 'assault') {
      ordered = this.issueAssault(cls.side, ladder, archers, rams, cav);
      this.onEvent(ordered > 0 ? 'order_assault' : 'order_fail', { side: cls.side, n: ordered });
    } else if (cls.type === 'escalade') {
      ordered = this.orderEscaladeSelected(sel.filter((c) => c.kind === 'inf' && c.ctype !== 'archer'), cls, point);
      this.onEvent(ordered > 0 ? 'order_escalade' : 'order_escalade_fail', { ring: cls.ring, side: cls.side, n: ordered });
    } else if (cls.type === 'city') {
      const descending = this.orderWallCompaniesToCity(sel, point);
      ordered += descending.size;
      const remaining = sel.filter((c) => !descending.has(c));
      // กองที่อยู่ในเมืองแล้ว (ชั้นใดก็ได้) เดินข้ามชั้นได้เลย; กองนอกเมืองต้องรอประตูนอกเปิด
      const inside = new Set(remaining.filter((c) => c.hasInsideSoldiers?.()));
      const mobile = remaining.filter((c) => (c.isLadderCarrier || c.ctype === 'cav') && (this.gate.open || inside.has(c)));
      if (mobile.length) {
        // ทุกกองมุ่งจุดที่คลิก เดินเป็นแถวตอนรายกองผ่านประตู แล้วไล่ฟันศัตรูที่เจอระหว่างทาง
        const destinations = this.cityOrderDestinations(mobile, point);
        const cityTactics = { formation: 'column', stance: this.commandStance };
        for (let i = 0; i < mobile.length; i++) {
          const c = mobile[i];
          if (c.kind === 'cav' ? c.orderRide(destinations[i], cityTactics) : c.orderCity(destinations[i], cityTactics)) ordered++;
        }
      }
      const outside = remaining.filter((c) => !mobile.includes(c) && !inside.has(c));
      if (!this.gate.open && outside.length) {
        // ประตูนอกยังปิด — ตีความเป็นการโจมตีกำแพงด้านที่ใกล้จุดแตะที่สุด
        const side = nearestSide(point);
        const assaultOrdered = this.issueAssault(side,
          outside.filter((c) => c.isLadderCarrier), outside.filter((c) => c.ctype === 'archer'),
          outside.filter((c) => c.ctype === 'ram'), outside.filter((c) => c.ctype === 'cav'));
        ordered += assaultOrdered;
        this.onEvent(assaultOrdered > 0 ? 'order_assault' : 'order_fail', { side, n: assaultOrdered });
      }
    } else {
      const destinations = formationDestinations(sel, clampFieldPoint(point), 14, this.commandFormation);
      for (let i = 0; i < sel.length; i++) {
        const c = sel[i];
        const p = clampFieldPoint(destinations[i]);
        if (c.ctype === 'cav') { if (c.orderRide(p, tactics)) ordered++; }
        else if (c.orderHold(p, tactics)) ordered++;
      }
    }
    this.onEvent('order_result', { n: ordered, total: sel.length });
  }

  retreatSelected() {
    let ordered = 0;
    const total = this.selection.size;
    for (const company of this.selection) if (company.orderRetreat()) ordered++;
    this.onEvent('retreat_order', { n: ordered, total });
    return ordered;
  }

  toggleHoldFireSelected() {
    const archers = [...this.selection].filter((c) => c.ctype === 'archer');
    if (!archers.length) return null;
    const next = !archers.every((c) => c.holdFire);
    for (const company of archers) {
      company.holdFire = next;
      for (const s of company.aliveSoldiers) s.intent = next ? 'hold-fire' : 'ready-to-volley';
    }
    this.onEvent('hold_fire', { enabled: next, n: archers.length });
    return next;
  }

  spawnMarker(pos, visual) {
    const mesh = new THREE.Mesh(ringGeoBig, new THREE.MeshBasicMaterial({ color: visual.color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, 0.1, pos.z);
    const icon = makeOrderIcon(visual);
    icon.position.set(pos.x, 4.5, pos.z);
    this.group.add(mesh, icon);
    this.markers.push({ mesh, icon, t: 0 });
  }

  setOrderPreview(rawPoint, cls) {
    const selected = [...this.selection].filter((company) => company.state !== 'dead');
    const company = selected[0];
    if (!company) { this.clearOrderPreview(); return; }
    const point = rawPoint.clone ? rawPoint.clone() : new THREE.Vector3(rawPoint.x, 0, rawPoint.z);
    if (cls.type === 'city' && !this.gate.open && !company.hasInsideSoldiers?.()) cls = { type: 'assault', side: nearestSide(point) };
    const key = `${company.idx}|${company.side}|${cls.type}|${cls.side ?? ''}|${Math.round(point.x / 2)}|${Math.round(point.z / 2)}|${this.commandFormation}|${this.commandStance}`;
    if (key === this.orderPreviewKey) return;
    this.clearOrderPreview();
    this.orderPreviewKey = key;
    let target = point;
    if (cls.type === 'assault') {
      const dist = company.ctype === 'archer' ? CFG.unit.atkArch.standDist : CFG.wallHalf + CFG.wallThick + 5;
      target = worldPoint(cls.side, SIDE_VECS[cls.side].t.dot(point), dist, 0);
    }
    const destinations = cls.type === 'city' || cls.type === 'escalade'
      ? this.cityOrderDestinations(selected, target)
      : formationDestinations(selected, target, 14, this.commandFormation);
    const visual = orderVisual(cls.type);
    const color = visual.color;
    const lineMaterial = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.78 });
    const ghostMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.38, side: THREE.DoubleSide });
    const lines = [], ghosts = [];
    const threats = this.wallThreats();
    for (let i = 0; i < Math.min(selected.length, 24); i++) {
      const c = selected[i], destination = destinations[i];
      const route = cls.type === 'assault'
        ? assaultRoute(c.anchor, cls.side, destination, threats)
        : fieldRoute(c.anchor, destination, threats, this.gatesOpen());
      if (i < 12) {
        const points = [c.anchor, ...route].map((p) => p.clone().setY(0.24));
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial);
        lines.push(line); this.group.add(line);
      }
      const ghost = new THREE.Mesh(c.ctype === 'ram' || c.ctype === 'cav' ? ringGeoBig : ringGeo, ghostMaterial);
      ghost.rotation.x = -Math.PI / 2;
      ghost.position.copy(destination).setY(0.12);
      ghosts.push(ghost); this.group.add(ghost);
    }
    const icon = makeOrderIcon(visual, 0.76);
    icon.position.copy(target).setY(4.5);
    this.group.add(icon);
    this.orderPreview = { lines, ghosts, icon, lineMaterial, ghostMaterial };
  }

  clearOrderPreview() {
    if (!this.orderPreview) { this.orderPreviewKey = ''; return; }
    const { lines, ghosts, icon, lineMaterial, ghostMaterial } = this.orderPreview;
    for (const line of lines) { this.group.remove(line); line.geometry.dispose(); }
    for (const ghost of ghosts) this.group.remove(ghost);
    this.group.remove(icon);
    icon.material.dispose();
    lineMaterial.dispose(); ghostMaterial.dispose();
    this.orderPreview = null;
    this.orderPreviewKey = '';
  }

  // ---------- ลูปหลัก ----------
  update(dt) {
    if (!this.ended) this.time += dt;
    this._gatesOpen = this.gatesOpen();
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.refreshGround();
    this.refreshWallDefenders();
    this.rebuildMovementGrid();
    this.updateFeintHeat(dt);

    for (const d of this.defenses) d.update(dt);
    this.reserves.update(dt);
    this.garrison.update(dt, this.insideAttackerTargets());
    this.computeFreeze();
    this.assignArcherRamFallback();
    for (const c of this.companies) c.update(dt);
    this.updateWallSupport();
    this.updateCaptureDecisions();

    this.updateDescent(dt);
    this.updateStairAscent();
    this.updateEvacuation(dt);
    for (let s = 0; s < 4; s++) {
      this.stairs[s].update(
        dt,
        (s2) => this.onStairTopArrived(s, s2),
        (s2) => this.onStairBottomArrived(s, s2),
      );
    }

    this.updateArcherVolley(dt);
    this.buildArrowGrids();
    this.meleeCombat(dt);
    this.refreshWallMembership();
    this.updateRocks(dt);
    this.updateArrows(dt);
    this.updateSparks(dt);
    this.updateFallingLadders(dt);
    this.updateRam(dt);
    this.updateGate(dt);
    this.updateInnerGates(dt);
    this.updateSally(dt);
    this.syncMeshes(dt);
    this.cleanup(dt);
    this.sampleMetrics(dt);

    if (!this.ended) {
      this.updateCapture(dt);
      this.updatePalace(dt);
      this.checkEnd();
    }
  }

  refreshGround() {
    this._ground.length = 0;
    for (const c of this.companies) {
      for (const s of c.soldiers) {
        if (s.alive && s.zone === 'field' && s.state !== 'climb') this._ground.push(s);
      }
    }
  }

  rebuildMovementGrid() {
    const units = [];
    for (const c of this.companies) for (const s of c.soldiers) if (s.alive && !s.climb && !s.stair) units.push(s);
    for (const d of this.defenses) {
      for (const s of d.melee) if (s.alive && !s.stair) units.push(s);
      for (const s of d.archers) if (s.alive && !s.stair) units.push(s);
      for (const carrier of d.carriers) if (carrier.s.alive && !carrier.s.stair) units.push(carrier.s);
    }
    for (const sq of this.reserves.squads) for (const s of sq.soldiers) if (s.alive && !s.stair) units.push(s);
    for (const s of this.garrison.soldiers) if (s.alive) units.push(s);
    for (const s of this.sally.horses) if (s.alive) units.push(s);
    this._spatialUnits = units;
    this.movementGrid.rebuild(units);
  }

  nearGateOrStair(s) {
    if (Math.abs(s.pos.x) < 7 && s.pos.z > CFG.wallHalf - 7 && s.pos.z < CFG.wallHalf + CFG.wallThick + 9) return true;
    for (let ring = 1; ring < RINGS.length; ring++) {
      const R = RINGS[ring];
      if (Math.abs(s.pos.x) < 6 && s.pos.z > R.half - 5 && s.pos.z < R.half + R.thick + 6) return true;
    }
    return !!s.stair || s.state === 'toLadder' || s.state === 'waitBase';
  }

  canCompanyAdvance(company, direction) {
    for (const other of this.companies) {
      if (other === company || other.state === 'dead') continue;
      if (!['march', 'ride', 'cityMarch'].includes(other.state)) continue;
      _t1.subVectors(other.anchor, company.anchor).setY(0);
      const distance = _t1.length();
      if (distance < 0.01 || distance > 9) continue;
      const ahead = _t1.dot(direction);
      if (ahead <= 0 || Math.abs(_t1.x * direction.z - _t1.z * direction.x) > 6) continue;
      const otherTarget = other.waypoints?.[0] || other.dest;
      if (!otherTarget) continue;
      _t2.subVectors(otherTarget, other.anchor).setY(0);
      if (_t2.lengthSq() < 0.01) continue;
      _t2.normalize();
      const sameDirection = direction.dot(_t2) > 0.45;
      if (sameDirection || company.id > other.id) return false;
    }
    return true;
  }

  stepGroundUnit(s, dt, target, speed = s.speed, arriveR = 0.35) {
    _t1.subVectors(target, s.pos).setY(0);
    const distance = _t1.length();
    if (distance <= arriveR) { s.moving = false; return true; }
    _t1.normalize();
    const radius = s.kind === 'cav' ? CFG.movement.cavalryRadius : CFG.movement.infantryRadius;
    const neighbors = this.movementGrid.query(s.pos, radius * 2.1, this._nearby);
    let pushX = 0, pushZ = 0;
    const chokeScale = this.nearGateOrStair(s) ? 0.22 : 1;
    for (const other of neighbors) {
      if (other === s || !other.alive || other.zone !== s.zone || other.faction !== s.faction) continue;
      const otherRadius = other.kind === 'cav' ? CFG.movement.cavalryRadius : CFG.movement.infantryRadius;
      const dx = s.pos.x - other.pos.x, dz = s.pos.z - other.pos.z;
      const d2 = dx * dx + dz * dz;
      const desired = radius + otherRadius;
      if (d2 >= desired * desired) continue;
      if (d2 < 0.0001) {
        const sign = s.id < other.id ? -1 : 1;
        pushX += sign; pushZ -= sign;
      } else {
        const d = Math.sqrt(d2);
        const strength = (desired - d) / desired;
        pushX += (dx / d) * strength;
        pushZ += (dz / d) * strength;
      }
    }
    _t1.x += pushX * CFG.movement.separationStrength * chokeScale;
    _t1.z += pushZ * CFG.movement.separationStrength * chokeScale;
    if (_t1.lengthSq() < 0.001) { s.moving = false; return false; }
    _t1.normalize();
    _t2.copy(s.pos).addScaledVector(_t1, Math.max(3, distance));
    s.stepToward(dt, _t2, speed, 0.05);
    return false;
  }

  sampleMetrics(dt) {
    this.metrics.sampleT += dt;
    if (this.metrics.sampleT < 1) return;
    this.metrics.sampleT = 0;
    let wallViolations = 0, overlapPairs = 0, chokeOverlapPairs = 0;
    const inner = CFG.wallHalf - 0.8, outer = CFG.wallHalf + CFG.wallThick + 0.8;
    for (const s of this._spatialUnits || this._ground) {
      const edge = Math.max(Math.abs(s.pos.x), Math.abs(s.pos.z));
      const gatePass = this.gate.open && s.pos.z > 0 && Math.abs(s.pos.x) <= 4.8;
      if (s.zone === 'field' && edge > inner && edge < outer && !gatePass) wallViolations++;
      const radius = s.kind === 'cav' ? CFG.movement.cavalryRadius : CFG.movement.infantryRadius;
      for (const other of this.movementGrid.query(s.pos, radius * 1.7, this._nearby)) {
        if (other.id <= s.id || other.faction !== s.faction || other.zone !== s.zone) continue;
        if (s.pos.distanceToSquared(other.pos) < (radius * 1.15) ** 2) {
          if (this.nearGateOrStair(s) || this.nearGateOrStair(other)) chokeOverlapPairs++;
          else overlapPairs++;
        }
      }
    }
    this.metrics.wallViolations = wallViolations;
    this.metrics.overlapPairs = overlapPairs;
    this.metrics.chokeOverlapPairs = chokeOverlapPairs;
    this.metrics.stuckCompanies = this.companies.filter((c) => (c.order?.stuckFor || 0) >= CFG.movement.stuckTimeout).length;
    let max = 0;
    for (const attackers of this.engagements.byTarget.values()) max = Math.max(max, attackers.length);
    this.metrics.maxAttackersPerTarget = max;
  }

  updateFeintHeat(dt) {
    this.feintHeat = [0, 0, 0, 0];
    for (const g of this._ground) {
      if (g.state !== 'hold' || !g.company || g.company.mode !== 'hold') continue;
      let best = 0, bestD = -Infinity;
      for (let s = 0; s < 4; s++) {
        const d = SIDE_VECS[s].n.dot(g.pos);
        if (d > bestD) { bestD = d; best = s; }
      }
      const tOff = Math.abs(SIDE_VECS[best].t.dot(g.pos));
      if (bestD > CFG.wallHalf + 10 && bestD < CFG.wallHalf + 72 && tOff <= CFG.wallHalf + 20) this.feintHeat[best] += dt;
    }
  }

  computeFreeze() {
    for (const d of this.defenses) {
      for (const l of this.laddersOf(d.side)) l.freeze = false;
      const R = d.roller;
      if (R.phase === 'telegraph' && R.target && !R.targetIsRam) R.target.freeze = true;
    }
    for (const r of this.rocks) if (r.alive && r.ladder && !r.ladder.broken) r.ladder.freeze = true;
  }

  // ---------- บันไดใน: ลงจากกำแพง / พลขนหินขึ้น ----------
  updateDescent(dt) {
    for (let side = 0; side < 4; side++) {
      const hasForcedDescent = [...this.wallFighters[side]]
        .some((s) => s.alive && (s.forceCityAfterCapture || s.forceCityDescent));
      // ช่วงที่ยังไม่ยึด: ลงได้เฉพาะคนที่ถูกสั่งลง (เช่น ขึ้นบันไดในไปกวาดล้างเสร็จแล้ว)
      if (!this.captured[side] && !hasForcedDescent) continue;
      const directiveBlocksDescent = !this.captured[side]
        || this.captureDirective[side] === 'pending' || this.captureDirective[side] === 'hold';
      if (directiveBlocksDescent && !hasForcedDescent) continue;
      const st = this.stairs[side];
      const sp = stairPoints(side);
      let pending = 0;
      for (const s of this.wallFighters[side]) if (s.alive && !s.wallSupport && s.state === 'toStair') pending++;
      let slots = CFG.descendAtOnce - st.down.length - pending;
      for (const s of this.wallFighters[side]) {
        if (!s.alive) continue;
        const forcedDescent = s.forceCityAfterCapture || s.forceCityDescent;
        if (!forcedDescent && (directiveBlocksDescent || s.wallSupport)) continue;
        if (slots > 0 && s.state === 'wall') {
          s.state = 'toStair';
          s.orderTarget = sp.landing;
          slots--;
        }
        if (s.state === 'toStair' && s.pos.distanceTo(sp.landing) < 1.3) {
          st.requestDown(s);
        }
      }
    }
  }

  assignWallSupport(fromSide) {
    const targets = [(fromSide + 1) % 4, (fromSide + 3) % 4]
      .filter((side) => this.wallDefenderCounts[side] > 0);
    if (!targets.length) return;
    const candidates = [...this.wallFighters[fromSide]]
      .filter((s) => s.alive && !s.stair && !s.forceCityAfterCapture && !s.forceCityDescent)
      .slice(0, this.wallSupportLimit);
    candidates.forEach((s, i) => {
      const target = targets[i % targets.length];
      s.wallSupport = true;
      s.wallObjectiveSide = target;
      s.waypoints = wallRoute(fromSide, target);
      s.state = 'order';
      s.intent = `support-wall-${target}`;
    });
  }

  chooseCaptureAction(side, action) {
    if (!this.captured[side] || !['hold', 'reinforce', 'descend'].includes(action)) return false;
    this.captureDirective[side] = action;
    const fighters = [...this.wallFighters[side]].filter((s) => s.alive && !s.stair);
    for (const s of fighters) {
      s.forceCityDescent = false;
      s.cityRallyTarget = null;
      s.wallSupport = action === 'hold';
      s.wallObjectiveSide = action === 'hold' ? side : undefined;
      s.waypoints = null;
      s.state = 'wall';
      s.intent = action === 'hold' ? 'hold-captured-wall' : action === 'descend' ? 'descend-to-city' : 'await-wall-support';
    }
    if (action === 'reinforce') this.assignWallSupport(side);
    this.onEvent('capture_action', { side, action });
    return true;
  }

  updateCaptureDecisions() {
    for (let side = 0; side < 4; side++) {
      if (this.captureDirective[side] !== 'pending') continue;
      if (this.time - this.captureDecisionAt[side] >= 8) this.chooseCaptureAction(side, 'reinforce');
    }
  }

  updateWallSupport() {
    for (const set of this.wallFighters) for (const s of set) {
      if (!s.alive || !s.wallSupport || s.stair) continue;
      if (s.intent === 'hold-captured-wall') continue;
      // ไล่ต่อจนกว่ากำแพงช่วงเป้าหมายไม่มีทหารเมืองจริง ๆ — แม้ด้านนั้นจะนับว่ายึดแล้วก็ตาม
      const target = s.wallObjectiveSide;
      if (target !== undefined && this.wallDefenderCounts[target] > 0) continue;
      const here = sectionOf(s.pos);
      const next = this.nearestDefendedWall(here);
      if (next === undefined) {
        s.wallSupport = false;
        s.waypoints = null;
        if (s.stairAssault) { s.forceCityDescent = true; s.intent = 'descend-after-wall-cleared'; }
        else s.intent = 'descend-after-capture';
        continue;
      }
      s.wallObjectiveSide = next;
      s.waypoints = wallRoute(here, next);
      s.intent = `support-wall-${next}`;
    }
  }

  refreshWallMembership() {
    const moves = [];
    for (let old = 0; old < 4; old++) for (const s of this.wallFighters[old]) {
      if (!s.alive || s.zone !== 'wall') continue;
      const current = sectionOf(s.pos);
      if (current !== old) moves.push([old, current, s]);
    }
    for (const [old, current, s] of moves) {
      this.wallFighters[old].delete(s);
      this.wallFighters[current].add(s);
    }
  }

  // AI เมือง: เสียกำแพง ≥ 2 ด้าน + ผู้บุกเข้าเมืองแล้ว → สละกำแพงที่เหลือ รวมพลตั้งรับขั้นสุดท้ายในถนน
  updateEvacuation(dt) {
    if (!this.gate.open) return;
    if (this.captured.filter(Boolean).length < 2) return;
    if (this.invadersInCity() < 12) return;
    for (const d of this.defenses) {
      if (d.evacuated) continue;
      d.evacuated = true;
      const sp = stairPoints(d.side);
      let sent = 0;
      for (const s of d.melee) {
        if (!s.alive) continue;
        if (s.zone === 'wall' && !s.stair) {
          s.state = 'toStairD';
          s.orderTarget = sp.landing;
          sent++;
        }
      }
      for (const s of d.archers) {
        if (!s.alive || s.zone !== 'wall' || s.stair) continue;
        s.state = 'toStairD';
        s.orderTarget = sp.landing;
        sent++;
      }
      if (sent > 0) this.onEvent('evacuate', { side: d.side, n: sent });
    }
    for (const d of this.defenses) {
      const st = this.stairs[d.side];
      const sp = stairPoints(d.side);
      for (const s of [...d.melee, ...d.archers]) {
        if (s.alive && s.state === 'toStairD' && s.pos.distanceTo(sp.landing) < 1.3 && st.down.length < 12) {
          st.requestDown(s);
        }
      }
    }
  }

  onStairTopArrived(side, s) {
    if (s.faction === 'atk') {
      // ผู้บุกขึ้นบันไดในมาถึงยอดกำแพง → กลายเป็นนักรบบนกำแพง ไล่ไปช่วงที่ยังมีทหารเมือง
      s.zone = 'wall';
      s.state = 'wall';
      s.pos.y = CFG.walkY;
      this.cityAttackers.delete(s);
      this.wallFighters[side].add(s);
      const objective = s.wallObjectiveSide ?? side;
      s.wallSupport = true;
      s.wallObjectiveSide = objective;
      s.waypoints = objective === side ? null : wallRoute(side, objective);
      s.intent = 'retake-wall';
      return;
    }
    if (s.utype === 'carrier') {
      const c = this.defenses[side].carriers.find((cc) => cc.s === s);
      if (c) { s.zone = 'wall'; this.defenses[side].carrierArrivedTop(c); }
      return;
    }
    s.zone = 'wall';
    this.reserves.releaseSoldier(s); // ออกจากกองสำรอง — ไม่งั้นถูกนับซ้ำสองที่
    this.defenses[side].addReinforcement(s);
  }

  onStairBottomArrived(side, s) {
    if (s.utype === 'carrier') {
      const c = this.defenses[side].carriers.find((cc) => cc.s === s);
      if (c) { s.zone = 'city'; this.defenses[side].carrierArrivedBottom(c); }
      return;
    }
    if (s.faction === 'def') {
      // ทหารเมืองสละกำแพงลงมา → ตั้งแนวรับขั้นสุดท้ายที่ลานหน้าประตูเมืองชั้นใน
      s.zone = 'city';
      s.state = 'order';
      s.orderTarget = cityRallyPoint();
      return;
    }
    s.zone = 'city';
    s.state = 'order';
    s.forceCityAfterCapture = false;
    s.forceCityDescent = false;
    s.stairAssault = false;
    s.wallSupport = false;
    const cityRallyTarget = s.cityRallyTarget;
    s.cityRallyTarget = null;
    if (!this.gate.open && this.gateOpeners.size < CFG.gate.openerLimit) {
      s.gateDuty = true;
      s.orderTarget = gateInsidePoint();
      s.intent = 'open-city-gate';
      this.gateOpeners.add(s);
    } else {
      s.orderTarget = cityRallyTarget || cityRallyPoint();
      s.intent = 'clear-city';
    }
    this.wallFighters[side].delete(s);
    this.cityAttackers.add(s);
  }

  // ทหารราบเดินเข้าเมืองผ่านประตู (จาก company.cityMarch)
  onInfEnteredCity(s) {
    s.forceCityAfterCapture = false;
    this.cityAttackers.add(s);
  }
  onInfLeftCity(s) {
    this.cityAttackers.delete(s);
  }

  // ม้าต้องอยู่ในชุดเดียวกับผู้บุกในเมือง จึงจะถูก melee loop เลือกไปไล่ศัตรู
  onCavEnteredCity(s) {
    this.cityAttackers.add(s);
  }
  onCavLeftCity(s) {
    this.cityAttackers.delete(s);
  }

  // ---------- นักธนูฝ่ายโจมตี: ยิงกดกำแพง ----------
  updateArcherVolley(dt) {
    const targets = this.attackerArcherTargets();
    for (const c of this.companies) {
      if (c.ctype !== 'archer' || c.state !== 'volley') continue;
      if (c.holdFire) continue;
      for (const s of c.soldiers) {
        if (!s.alive) continue;
        s.cd -= dt;
        if (s.cd > 0) continue;
        // ยิงทหารจริงทุกโซนที่เปิดทางถึง: กำแพง, เมืองเมื่อประตูเปิด, และม้าซองในสนาม
        let best = null, bestD = CFG.unit.atkArch.range;
        for (const w of targets) {
          const d = s.pos.distanceTo(w.pos);
          if (d < bestD) { bestD = d; best = w; }
        }
        if (!best) continue;
        s.cd = CFG.unit.atkArch.atkCd * (0.85 + this.rng() * 0.3);
        s.facePoint(best.pos, dt);
        this.fireArrow(s, best, 'atk');
        sfx.whoosh();
      }
    }
  }

  // ---------- การสู้: กำแพง + ในเมือง + ภาคสนาม (ม้าซอง) ----------
  meleeCombat(dt) {
    this.engagements.cleanup();
    // กองร้อยอ่าน inCombat เพื่อปล่อยทหารที่กำลังรบ — ล้างค่าเก่าของทหารที่เฟรมนี้ไม่ได้เข้าวงรบ
    for (const c of this.companies) for (const s of c.soldiers) s.inCombat = false;
    const units = [];
    for (const set of this.wallFighters) for (const s of set) if (s.alive) units.push(s);
    for (const s of this.cityAttackers) if (s.alive) units.push(s);
    for (const d of this.defenses) {
      for (const s of d.melee) if (s.alive) units.push(s);
      for (const s of d.archers) if (s.alive) units.push(s);
      for (const c of d.carriers) if (c.s.alive) units.push(c.s);
    }
    for (const s of this.reserves.allSoldiers()) if (s.alive) units.push(s);
    for (const s of this.garrison.soldiers) if (s.alive) units.push(s);

    // ม้าซอง + ทหารฝ่ายบุกที่อยู่ในระยะปะทะ (สงครามภาคสนาม)
    const sally = this.sally.horses.filter((h) => h.alive);
    if (sally.length) {
      units.push(...sally);
      for (const c of this.companies) {
        for (const s of c.soldiers) {
          if (!s.alive || s.zone !== 'field') continue;
          for (const h of sally) {
            if (s.pos.distanceToSquared(h.pos) < 1000) { units.push(s); break; }
          }
        }
      }
    }

    const cityDefenders = units.filter((u) => u.faction === 'def' && u.zone === 'city' && u.alive);

    // จัดเรียงตามแกน X — ให้การหาศัตรูสแกนเฉพาะ "เพื่อนบ้านในระยะ" (รองรับทหารนับพัน)
    units.sort((a, b) => a.pos.x - b.pos.x);

    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u.alive) continue;
      u.inCombat = false;
      this.advanceAttack(u, dt);

      // กำลังไต่บันไดพาดข้ามกำแพงชั้นใน — กองร้อยคุมตำแหน่ง ฟันใครไม่ได้ระหว่างไต่
      if (u.climb) { u.cd -= dt; continue; }

      if (u.stair) {
        u.cd -= dt;
        this.tryAttack(u, this.nearestInWindow(units, i, u, 1.4), dt);
        continue;
      }

      // พลขนหินไม่มีศัตรู → ระบบขนส่งเป็นคนคุมการเดิน
      if (u.faction === 'def' && u.utype === 'carrier') {
        const enemy = this.nearestInWindow(units, i, u, 1.3);
        u.cd -= dt;
        if (enemy) this.tryAttack(u, enemy, dt);
        continue;
      }

      const pursuitRange = u.company?.stance === 'hold' ? 9 : (u.detectRange || CFG.combat.detectionRange);
      const capacity = this.nearGateOrStair(u)
        ? CFG.combat.chokeCapacity
        : u.kind === 'cav' ? CFG.combat.cavalryCapacity : CFG.combat.infantryCapacity;
      const oldClaim = this.engagements.byAttacker.get(u);
      let enemy = oldClaim?.target?.alive && oldClaim.target.zone === u.zone
        && u.pos.distanceTo(oldClaim.target.pos) < pursuitRange + 3 ? oldClaim.target : null;
      if (!enemy) {
        this.engagements.release(u);
        enemy = this.nearestInWindow(units, i, u, pursuitRange, (e) => this.engagements.hasSpace(e, capacity));
      }
      const claim = enemy ? this.engagements.claim(u, enemy, capacity) : null;
      u.cd -= dt;

      if (u.state === 'toStair' || u.state === 'toStairD' || u.state === 'toStairUp') {
        if (enemy && u.pos.distanceTo(enemy.pos) < 1.2) this.tryAttack(u, enemy, dt);
        else { u.stepToward(dt, u.orderTarget, u.speed, 0.4); if (u.zone === 'wall') { u.pos.y = CFG.walkY; clampOnWall(u.pos); } }
        continue;
      }

      // นักธนู/รถทุบยืนยิง ไม่ออกไล่ — สู้เฉพาะเมื่อโดนชิด
      if ((u.utype === 'atkArch' && u.company.state === 'volley') || u.utype === 'crew') {
        this.tryAttack(u, enemy && u.pos.distanceTo(enemy.pos) < 1.4 ? enemy : null, dt);
        continue;
      }

      const engageR = u.kind === 'cav' ? 2.1 : 1.15;
      const eD = enemy ? u.pos.distanceTo(enemy.pos) : Infinity;
      // เฉพาะทหารที่กองกำลังพาเดินจริง (รับคำสั่งเดินทัพ / ม้าที่กำลังขี่) — คนที่ลงบันไดมาเปิดประตู
      // หรือยืนบนกำแพงไม่ได้เดินตามกอง แม้กองต้นสังกัดจะกำลังเดินทัพอยู่
      const orderDriven = !!u.company && u.zone !== 'wall' && COMPANY_MOVE_STATES.has(u.company.state)
        && (u.state === 'march' || u.state === 'toLadder' || u.company.state === 'ride');
      const retreating = orderDriven && u.company.mode === 'retreat';
      if (enemy && eD < engageR) {
        // ผู้บุกที่กำลังฟันอยู่ต้องไม่ถูกกองลากกลับเข้าแถว (ฝ่ายเมืองคงพฤติกรรมเดิม)
        if (u.faction === 'atk') u.inCombat = true;
        this.tryAttack(u, enemy, dt);
      } else if (enemy && claim && eD < pursuitRange + 3 && !retreating) {
        u.inCombat = true;
        this.engagements.pointFor(u, enemy, engageR * 0.78, _t1);
        this.stepGroundUnit(u, dt, this.hopFor(u, _t1), u.speed, 0.28);
        u.intent = `closing-${enemy.utype}`;
        this.clampToZone(u);
      } else {
        if (!enemy || retreating) this.engagements.release(u);
        // กองกำลังเดินตามคำสั่ง (เข้าเมือง/ขี่ม้า/ถอย) — ให้กองพาเดิน ไม่ไล่ล่าเองจนเกิดชักเย่อ
        if (orderDriven) continue;
        let target = null;
        if (u.waypoints && u.waypoints.length) {
          target = u.waypoints[0];
          if (u.pos.distanceTo(target) < 1.5) { u.waypoints.shift(); target = u.waypoints[0] || null; }
        }
        if (!target) {
          if (u.faction === 'atk' && u.zone === 'wall') target = sectionCenter(u.wallObjectiveSide ?? sectionOf(u.pos));
          else if (u.faction === 'atk' && isInsideZone(u.zone)) {
            if (u.gateDuty && !this.gate.open) {
              target = gateInsidePoint();
              u.intent = u.pos.distanceTo(target) < CFG.gate.openRadius ? 'opening-city-gate' : 'move-to-city-gate';
            } else {
              const hunted = this.nearestCityDefender(u.pos, 180, u);
              if (hunted) {
                if (this.engagements.hasSpace(hunted, capacity)) {
                  target = hunted.pos;
                  u.intent = `hunt-city-${hunted.utype}`;
                } else {
                  _t1.copy(u.pos).sub(hunted.pos).setY(0);
                  if (_t1.lengthSq() < 0.001) _t1.set((u.id % 2) * 2 - 1, 0, (u.id % 3) - 1);
                  target = hunted.pos.clone().addScaledVector(_t1.normalize(), 4.2);
                  u.intent = 'waiting-combat-slot';
                }
              } else if (u.zone === 'city' && this.autoClimbToWall(u)) {
                continue;
              } else target = u.orderTarget || null;
            }
          } else if (u.faction === 'def') {
            target = u.orderTarget || u.homePost;
          }
        }
        if (target) {
          this.stepGroundUnit(u, dt, this.hopFor(u, target), u.speed, 0.9);
          this.clampToZone(u);
        }
      }
    }
  }

  // หาศัตรูใกล้สุดโดยสแกนเฉพาะหน่วยที่ "อยู่ใกล้แกน x" (units เรียงตาม x แล้ว)
  nearestInWindow(units, i, u, range, predicate = null) {
    let enemy = null, eD = range;
    const uSec = u.faction === 'def' ? sectionOf(u.pos) : -1;
    const scan = (e, dx, dz) => {
      if (!e.alive || e.faction === u.faction || e.zone !== u.zone || (predicate && !predicate(e))) return;
      if (u.faction === 'def' && u.zone === 'wall') {
        if (sectionOf(e.pos) !== uSec && dx * dx + dz * dz > 110) return;
      }
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < eD) { eD = d; enemy = e; }
    };
    for (let j = i - 1; j >= 0; j--) {
      const e = units[j];
      const dx = u.pos.x - e.pos.x;
      if (dx > eD) break; // เรียงแล้ว — ตัวที่ไกลกว่านี้ข้ามได้ทั้งก้อน
      scan(e, dx, u.pos.z - e.pos.z);
    }
    for (let j = i + 1; j < units.length; j++) {
      const e = units[j];
      const dx = e.pos.x - u.pos.x;
      if (dx > eD) break;
      scan(e, dx, u.pos.z - e.pos.z);
    }
    return enemy;
  }

  nearestCityDefender(pos, radius, hunter = null) {
    let best = null, bestD = radius;
    const candidates = [];
    const zone = hunter?.zone || 'city';
    // ทหารเมืองในชั้นเดียวกับผู้ล่า: องครักษ์ชั้นใน/วัง
    for (const s of this.garrison?.soldiers || []) {
      if (!s.alive || s.zone !== zone) continue;
      if (hunter) { candidates.push(s); continue; }
      const d = pos.distanceTo(s.pos);
      if (d < bestD) { bestD = d; best = s; }
    }
    // กองสำรอง + ทหารเมืองที่สละกำแพงลงมา (evacuees) ล้วนเป็นเป้าในเมืองชั้นนอก
    for (const sq of this.reserves.squads) {
      for (const s of sq.soldiers) {
        if (!s.alive || s.zone !== zone) continue;
        if (hunter) { candidates.push(s); continue; }
        const d = pos.distanceTo(s.pos);
        if (d < bestD) { bestD = d; best = s; }
      }
    }
    for (const d of this.defenses) {
      for (const s of d.melee) {
        if (!s.alive || s.zone !== zone) continue;
        if (hunter) { candidates.push(s); continue; }
        const dd = pos.distanceTo(s.pos);
        if (dd < bestD) { bestD = dd; best = s; }
      }
      for (const s of d.archers) {
        if (!s.alive || s.zone !== zone) continue;
        if (hunter) { candidates.push(s); continue; }
        const dd = pos.distanceTo(s.pos);
        if (dd < bestD) { bestD = dd; best = s; }
      }
      for (const c of d.carriers) {
        const s = c.s;
        if (!s.alive || s.zone !== zone) continue;
        if (hunter) { candidates.push(s); continue; }
        const dd = pos.distanceTo(s.pos);
        if (dd < bestD) { bestD = dd; best = s; }
      }
    }
    if (hunter) return chooseTacticalTarget(hunter, candidates, radius, (target) => this.engagements.byTarget.get(target)?.length || 0);
    return best;
  }

  tryAttack(u, enemy, dt) {
    if (!enemy) return;
    u.facePoint(enemy.pos, dt);
    if (u.cd <= 0 && !u.attackTarget) {
      u.cd = u.atkCd;
      u.attackTarget = enemy;
      u.attackWindup = u.kind === 'cav' ? 0.24 : 0.18;
      u.intent = `attack-${enemy.utype}`;
    }
  }

  advanceAttack(u, dt) {
    if (!u.attackTarget) return;
    u.attackWindup -= dt;
    const enemy = u.attackTarget;
    if (u.attackWindup > 0) { if (enemy.alive) u.facePoint(enemy.pos, dt); return; }
    u.attackTarget = null;
    u.attackWindup = 0;
    if (!enemy.alive || enemy.zone !== u.zone) return;
    const reach = u.kind === 'cav' ? 2.6 : 1.65;
    if (u.pos.distanceTo(enemy.pos) > reach) return;
    u.attackAnim = 0.28;
    let dmg = u.dmg;
    if (u.kind === 'cav' && u.chargeReady) {
      dmg += 2;
      u.chargeReady = false;
      u.intent = 'cavalry-charge-impact';
      this.shake = Math.max(this.shake, 0.28);
    }
    if (u.faction === 'def' && this.gate.open && u.pos.distanceTo(gateInsidePoint()) < 9) dmg += 1;
    enemy.damage(dmg);
    this.lastCombatPos = enemy.pos.clone();
    this.lastCombatAt = this.time;
    enemy.hitAnim = 0.16;
    enemy.hitDir.copy(enemy.pos).sub(u.pos).setY(0).normalize();
    _t2.copy(enemy.pos); _t2.y += 0.9;
    this.spawnSpark(_t2, u.kind === 'cav' ? 'gold' : 'red', u.kind === 'cav' ? 6 : 4, u.kind === 'cav' ? 2.8 : 2.1);
    sfx.clash();
  }

  clampToZone(u) {
    if (u.zone === 'wall') { u.pos.y = CFG.walkY; clampOnWall(u.pos); return; }
    if (u.zone === 'field') { u.pos.y = 0; constrainFieldOutsideWall(u.pos, this.gate.open); return; }
    const region = zoneRegion(u.zone);
    if (region < 0) return; // บันได/บันไดพาด/สันกำแพงชั้นใน — ระบบนั้นคุมตำแหน่งเอง
    u.pos.y = 0;
    // อยู่ในชั้นของตัวเองเสมอ ข้ามได้เฉพาะลอดประตูที่เปิดแล้ว (ไม่เดินทะลุกำแพงชั้นใน)
    constrainToRegion(u.pos, region, this._gatesOpen || this.gatesOpen());
  }

  // ---------- ธนู (สองฝ่าย) ----------
  // ตารางค้นหาเป้า (spatial hash ขนาดช่อง 8 ม.) — ธนูแต่ละเม็ดค้นเฉพาะ 3×3 ช่องรอบตัว
  buildArrowGrids() {
    this._gridG = new Map(); // ฝ่ายเมืองยิง → ผู้บุกภาคพื้น (ทุ่ง + ในเมืองทุกชั้น + คนไต่บันไดพาด)
    const addG = (s) => {
      const k = (Math.floor(s.pos.x / 8) + 300) + '|' + (Math.floor(s.pos.z / 8) + 300);
      let a = this._gridG.get(k);
      if (!a) { a = []; this._gridG.set(k, a); }
      a.push(s);
    };
    for (const s of this._ground) addG(s);
    for (const s of this.cityAttackers) if (s.alive && !s.stair && s.zone !== 'wall') addG(s);
    this._gridW = new Map(); // ฝ่ายบุกยิง → ทหารบนกำแพง + ในเมือง + ม้าซองในสนาม
    for (const s of this.attackerArcherTargets()) {
      const k = (Math.floor(s.pos.x / 8) + 300) + '|' + (Math.floor(s.pos.z / 8) + 300);
      let a = this._gridW.get(k);
      if (!a) { a = []; this._gridW.set(k, a); }
      a.push(s);
    }
  }

  gridTargets(grid, p) {
    const kx = Math.floor(p.x / 8) + 300, kz = Math.floor(p.z / 8) + 300;
    const out = [];
    for (let gx = kx - 1; gx <= kx + 1; gx++) {
      for (let gz = kz - 1; gz <= kz + 1; gz++) {
        const a = grid.get(gx + '|' + gz);
        if (a) out.push(...a);
      }
    }
    return out;
  }

  fireArrow(from, target, by) {
    const start = _t1.copy(from.pos); start.y += 1.35;
    const aim = _t2.copy(target.pos); aim.y += target.kind === 'cav' ? 1.2 : 0.9;
    aim.x += (this.rng() - 0.5) * CFG.arrow.spread * 2;
    aim.z += (this.rng() - 0.5) * CFG.arrow.spread * 2;
    const dx = aim.x - start.x, dy = aim.y - start.y, dz = aim.z - start.z;
    const dh = Math.hypot(dx, dz) || 0.001;
    const v = by === 'atk' ? CFG.unit.atkArch.projSpeed : 27;
    const g = CFG.unit.atkArch.gravity;
    // บอลลิสติกส์เต็มรูป: แก้ทั้ง dh และ dy (ยิงขึ้นยอดกำแพงต้องโค้งข้ามใบกำแพง)
    const v2 = v * v;
    const disc = v2 * v2 - g * (g * dh * dh + 2 * dy * v2);
    let ang;
    if (disc < 0) {
      ang = Math.PI / 4; // ไปไม่ถึง — โยนสูงสุดเท่าที่ได้
    } else {
      const high = dy > 2; // เป้าสูงกว่าตัวยิง → ใช้มุมโค้งสูง
      const tanA = (v2 + (high ? 1 : -1) * Math.sqrt(disc)) / (g * dh);
      ang = Math.atan(tanA);
    }
    const cosA = Math.cos(ang);
    const a = this.getArrow();
    a.mesh.position.copy(start);
    a.vel.set((dx / dh) * cosA * v, Math.sin(ang) * v, (dz / dh) * cosA * v);
    a.alive = true;
    a.life = 0;
    a.by = by;
    a.mesh.visible = true;
  }

  getArrow() {
    let a = this.arrows.find((x) => !x.alive);
    if (!a) {
      const mesh = new THREE.Mesh(arrowGeo, arrowMat);
      this.group.add(mesh);
      a = { mesh, vel: new THREE.Vector3(), alive: false, life: 0, by: 'def' };
      this.arrows.push(a);
    }
    return a;
  }

  updateArrows(dt) {
    const shields = this.liveShields();
    const guardShields = this.garrison.shields(); // โล่องครักษ์กันธนูฝ่ายบุกให้ทหารเมืองรอบตัว
    for (const a of this.arrows) {
      if (!a.alive) continue;
      a.life += dt;
      // ย่อยเป็น substep กันธนู "กระโดด" ทะลุโซนชนเมื่อ dt ใหญ่ (4x เร่งเวลา)
      const steps = 4;
      const sdt = dt / steps;
      for (let st = 0; st < steps && a.alive; st++) {
        a.vel.y -= CFG.unit.atkArch.gravity * sdt;
        a.mesh.position.addScaledVector(a.vel, sdt);
        const p = a.mesh.position;
        let hit = false;
        const targets = this.gridTargets(a.by === 'atk' ? this._gridW : this._gridG, p);
        const hitR2 = a.by === 'atk' ? 0.7 : 0.5;
        for (const s of targets) {
          const dx = p.x - s.pos.x, dy = p.y - (s.pos.y + 0.9), dz = p.z - s.pos.z;
          if (dx * dx + dy * dy + dz * dz < hitR2) {
            // โล่กำบัง: มีพลโล่ใกล้เป้า → โอกาสสะท้อน
            const cover = a.by === 'atk' ? guardShields : shields;
            const coverChance = a.by === 'atk' ? CFG.garrison.shield.coverChance : CFG.unit.shield.coverChance;
            if (this.covered(s, cover) && this.rng() < coverChance) {
              this.spawnSpark(p, 'gray', 2, 1.6);
            } else {
              s.damage(a.by === 'atk' ? CFG.arrow.dmgWall : CFG.arrow.dmg);
              this.spawnSpark(p, 'red', 2, 1.4);
              if (a.by === 'atk') this.stats.arrowHitsAtk = (this.stats.arrowHitsAtk || 0) + 1;
            }
            hit = true;
            break;
          }
        }
        if (hit) { a.alive = false; a.mesh.visible = false; break; }
        if (p.y < 0.05 || this.insideWallSolid(p) || a.life > 7) {
          a.alive = false; a.mesh.visible = false;
        }
      }
      if (a.alive) {
        a.mesh.lookAt(_t1.copy(a.mesh.position).add(a.vel));
      }
    }
  }

  // ---------- หินกลิ้งลงบันได ----------
  spawnRock(ladder) {
    const r = this.getRock();
    r.alive = true;
    r.ladder = ladder;
    r.ramTarget = null;
    r.s = 0.4;
    r.speed = CFG.rock.speed0;
    r.mid = false;
    r.passed.clear();
    r.mesh.visible = true;
    r.mesh.position.copy(ladder.top);
  }

  dropRockOnRam(ramCompany) {
    const r = this.getRock();
    r.alive = true;
    r.ladder = null;
    r.ramTarget = ramCompany;
    r.s = 0;
    r.speed = 16;
    r.mesh.visible = true;
    r.mesh.position.copy(ramCompany.anchor).setY(CFG.wallH + 6);
  }

  getRock() {
    let r = this.rocks.find((x) => !x.alive);
    if (!r) {
      const mesh = new THREE.Mesh(rockGeo, rockMat);
      mesh.castShadow = true;
      this.group.add(mesh);
      r = { mesh, ladder: null, ramTarget: null, s: 0, speed: 0, alive: false, mid: false, passed: new Set() };
      this.rocks.push(r);
    }
    return r;
  }

  updateRocks(dt) {
    for (const r of this.rocks) {
      if (!r.alive) continue;
      // หินจากหอประตู ทุ่มใส่รถทุบ
      if (r.ramTarget) {
        r.mesh.position.y -= r.speed * dt;
        r.mesh.rotation.x += dt * 9;
        const p = r.mesh.position;
        if (p.y <= 1.4) {
          r.alive = false;
          r.mesh.visible = false;
          this.spawnSpark(p, 'dust', 5, 2.5);
          sfx.crack();
          this.shake = Math.max(this.shake, 0.35);
          const c = r.ramTarget;
          if (c.ramMesh && c.aliveSoldiers.length > 0) {
            c.ramHp -= CFG.unit.ram.rockDmg;
            for (const s of c.aliveSoldiers) if (s.pos.distanceTo(p) < 2.4) s.damage(2);
            if (c.ramHp <= 0) c.onRamDestroyed();
          }
          continue;
        }
        continue;
      }
      const l = r.ladder;
      r.speed += CFG.rock.accel * dt;
      r.s += r.speed * dt;
      r.mesh.position.copy(l.top).addScaledVector(l.dir, -r.s);
      r.mesh.rotation.x += dt * 9;
      r.mesh.rotation.z += dt * 7;
      for (const c of l.climbers) {
        if (!c.alive || r.passed.has(c)) continue;
        if (Math.abs(c.climb.s - r.s) < CFG.rock.killRadius) {
          r.passed.add(c);
          if (this.rng() < CFG.rock.killChance) {
            c.die();
            this.spawnSpark(c.pos, 'dust', 3, 2.0);
          }
        }
      }
      if (!r.mid && !l.broken && r.s > l.len * 0.45) {
        r.mid = true;
        if (this.rng() < CFG.ladder.breakChance) this.breakLadder(l);
      }
      if (r.s >= l.len) {
        r.alive = false;
        r.mesh.visible = false;
        this.spawnSpark(l.base, 'dust', 6, 3.0);
        sfx.thud();
        this.shake = Math.max(this.shake, 0.45);
        for (const s of this._ground) {
          if (s.alive && s.pos.distanceTo(l.base) < CFG.rock.baseKillRadius) s.damage(2);
        }
      }
    }
  }

  breakLadder(l) {
    if (l.broken) return;
    const company = this.companies.find((c) => c.ladder === l);
    this.fallingLadders.push({ mesh: l.mesh, quat0: l.mesh.quaternion.clone(), axis: SIDE_VECS[l.side].t.clone(), t: 0 });
    this.spawnSpark(l.top, 'wood', 6, 2.5);
    sfx.crack();
    this.shake = Math.max(this.shake, 1.0);
    if (company) company.onLadderBroken();
    this.onEvent('ladder_broken', { side: l.side });
  }

  updateFallingLadders(dt) {
    for (const f of this.fallingLadders) {
      f.t += dt;
      const k = Math.min(1, f.t / 0.7);
      _q.setFromAxisAngle(f.axis, k * 1.35);
      f.mesh.quaternion.copy(_q).multiply(f.quat0);
      if (f.t > 1.6) { this.group.remove(f.mesh); f.done = true; }
    }
    this.fallingLadders = this.fallingLadders.filter((f) => !f.done);
  }

  // ---------- ประกายไฟ ----------
  spawnSpark(pos, kind, n, speed) {
    for (let i = 0; i < n; i++) {
      let sp = this.sparks.find((x) => !x.alive);
      if (!sp) {
        const mesh = new THREE.Mesh(sparkGeo, SPARK_MATS.dust);
        this.group.add(mesh);
        sp = { mesh, vel: new THREE.Vector3(), life: 0, alive: false };
        this.sparks.push(sp);
      }
      sp.alive = true;
      sp.mesh.visible = true;
      sp.mesh.material = SPARK_MATS[kind] || SPARK_MATS.dust;
      sp.mesh.position.copy(pos);
      sp.vel.set((this.rng() - 0.5) * speed, this.rng() * speed * 0.9 + 0.6, (this.rng() - 0.5) * speed);
      sp.life = 0.35 + this.rng() * 0.3;
      sp.mesh.scale.setScalar(1);
    }
  }

  updateSparks(dt) {
    for (const s of this.sparks) {
      if (!s.alive) continue;
      s.life -= dt;
      if (s.life <= 0) { s.alive = false; s.mesh.visible = false; continue; }
      s.vel.y -= 7 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.scale.setScalar(Math.max(0.15, s.life * 2.2));
    }
  }

  // ---------- รถทุบประตู + ประตู ----------
  updateRam(dt) {
    if (this.gate.open) return;
    // ประตูเป็นจุดเดียว — ความเร็วทุบไม่ซ้อนกัน (ใช้คันที่พร้อมที่สุด)
    const rams = this.companies.filter((c) => c.ramMesh && c.state === 'battering' && c.aliveSoldiers.length > 0);
    if (rams.length > 0) {
      rams.forEach((company, index) => {
        if (company.order) company.order.waitingReason = index === 0 ? '' : 'รอช่องรถทุบประตู';
        for (const s of company.aliveSoldiers) if (index > 0) s.intent = 'waiting-ram-slot';
      });
      this.gate.breach = Math.min(1, this.gate.breach + CFG.unit.ram.batterRate * dt);
      if (this.gate.breach >= 1) {
        this.gate.open = true;
        this.shake = Math.max(this.shake, 1.6);
        this.onEvent('gate_breached', {});
        this.releaseGateAssaultCompanies(rams);
        this.routeOpenGateAttackers();
      }
    }
  }

  updateGate(dt) {
    if (this.gate.open) {
      if (this.gate.anim < 1) {
        this.gate.anim = Math.min(1, this.gate.anim + dt / 2.4);
        openGateDoors(this.doorL, this.doorR, this.gate.anim);
      }
      return;
    }
    if (this.gate.progress >= 1) return;
    const gi = gateInsidePoint();
    let n = 0;
    for (const s of this.cityAttackers) {
      if (s.alive && s.kind === 'inf' && s.pos.distanceTo(gi) < CFG.gate.openRadius) n++;
    }
    if (n > 0) {
      if (!this.gate.started) { this.gate.started = true; this.onEvent('gate_opening', {}); }
      this.gate.progress = Math.min(1, this.gate.progress + dt * (CFG.gate.insideBase + CFG.gate.insidePer * Math.min(10, n)));
      if (this.gate.progress >= 1) {
        this.gate.open = true;
        for (const s of this.gateOpeners) { s.gateDuty = false; s.intent = 'hunt-city-defenders'; }
        this.gateOpeners.clear();
        this.releaseGateAssaultCompanies();
        this.routeOpenGateAttackers();
        this.onEvent('gate_open', {});
      }
    }
  }

  // ---------- ม้าซอง: เมืองส่งม้าออกไปถล่มนักธนู/รถทุบ แล้วถอยกลับ ----------
  updateSally(dt) {
    const S = this.sally;
    if (S.active) {
      S.t += dt;
      const alive = S.horses.filter((h) => h.alive);
      const retreating = S.t > CFG.sortie.duration || alive.length < CFG.sortie.retreatBelow;
      for (const h of alive) {
        if (h.alive && !h.inCombat) {
          const target = retreating ? gateInsidePoint() : (S.target ? S.target.flagPos : gateInsidePoint());
          h.stepToward(dt, target, CFG.sortie.speed, 1.6);
        }
      }
      if (retreating && (alive.length === 0 || alive.every((h) => h.pos.distanceTo(gateInsidePoint()) < 3))) {
        for (const h of alive) { this.group.remove(h.mesh); h.alive = false; }
        S.horses = [];
        S.active = false;
        S.cooldown = CFG.sortie.cooldown;
        this.onEvent('sortie_return', {});
      }
      return;
    }
    S.cooldown -= dt;
    if (S.cooldown > 0 || this.gate.open || this.captured[2]) return;
    if (this.reserves.aliveCount() < CFG.sortie.minReserves) return;
    // มีเครื่องโจมตีตั้งหลักแหล่งใกล้ประตูหรือไม่ (นักธนู / รถทุบ)
    let prey = null, preyD = CFG.sortie.triggerRange;
    for (const c of this.companies) {
      if ((c.ctype === 'archer' && c.state === 'volley') || (c.ramMesh && c.state === 'battering')) {
        const d = c.flagPos.distanceTo(gateInsidePoint());
        if (d < preyD) { preyD = d; prey = c; }
      }
    }
    if (!prey) return;
    // ออกซอง!
    S.active = true;
    S.t = 0;
    S.target = prey;
    S.horses = [];
    const front = worldPoint(2, 0, CFG.gate.frontPoint, 0);
    for (let i = 0; i < CFG.sortie.horses; i++) {
      const h = new Soldier({
        type: 'cavD', faction: 'def', side: -1, kind: 'cav', utype: 'sally',
        hp: CFG.sortie.hp, speed: CFG.sortie.speed, atkCd: CFG.sortie.atkCd, dmg: CFG.sortie.dmg, rng: this.rng,
      });
      h.pos.copy(front).addScaledVector(SIDE_VECS[2].t, (i - CFG.sortie.horses / 2) * 1.6);
      h.state = 'order';
      this.group.add(h.mesh);
      h.syncMesh(0);
      S.horses.push(h);
    }
    this.onEvent('sortie', { n: CFG.sortie.horses });
  }

  // ---------- ยึดกำแพง ----------
  updateCapture(dt) {
    for (let s = 0; s < 4; s++) {
      if (this.captured[s]) continue;
      let atk = 0;
      for (const f of this.wallFighters[s]) if (f.alive) atk++;
      const def = this.wallDefenderCounts[s];
      if (atk >= CFG.captureSoldiersNeeded && def === 0) {
        this.capT[s] += dt;
        if (this.capT[s] >= CFG.captureHoldTime) {
          this.captured[s] = true;
          this.stats.capturedCount++;
          this.citySides[s].flagMat.color.set(0x3d7ac0);
          this.spawnSpark(sectionCenter(s), 'blue', 10, 4);
          this.shake = Math.max(this.shake, 0.7);
          this.onEvent('captured', { side: s });
          this.rearmArchersAfterCapture(s);
          this.captureDirective[s] = 'pending';
          this.captureDecisionAt[s] = this.time;
        }
      } else {
        this.capT[s] = Math.max(0, this.capT[s] - dt * 1.5);
      }
    }
  }

  // ---------- จบศึก ----------
  checkEnd() {
    let defendersAlive = this.defenses.reduce((a, d) => a + d.aliveCount(), 0) + this.reserves.aliveCount() + this.garrison.aliveCount();
    for (const h of this.sally.horses) if (h.alive) defendersAlive++;
    let attackersAlive = 0;
    for (const c of this.companies) for (const s of c.soldiers) if (s.alive) attackersAlive++;
    this.stats.attackersAlive = attackersAlive;
    this.stats.defendersTotal = defendersAlive;
    const result = battleOutcome({ palaceProgress: this.palace.progress, attackersAlive, time: this.time, timeLimit: CFG.timeLimit });
    if (result) this.end(result);
  }

  end(result) {
    this.ended = true;
    this.result = result;
    this.onEvent('end', {
      result, stats: { ...this.stats }, captured: [...this.captured], gateOpen: this.gate.open, time: this.time,
      innerGatesOpen: this.innerGates.map((g) => g.open), palaceProgress: this.palace.progress,
    });
  }

  // ---------- ภาพ / ทำความสะอาด ----------
  syncMeshes(dt) {
    const fieldStates = ['idle', 'hold', 'march', 'ride', 'holdAt', 'waitBase', 'toLadder', 'volley', 'battering', 'order'];
    for (const c of this.companies) {
      for (const s of c.soldiers) s.syncMesh(dt);
      const alive = c.aliveSoldiers;
      const dead = alive.length === 0;
      if (dead && c.selected) { c.selected = false; this.selection.delete(c); }
      c.selRing.visible = c.selected && !dead && fieldStates.includes(c.state);
      if (c.selRing.visible) {
        const p = c.flagPos;
        c.selRing.position.set(p.x, 0.07, p.z);
      }
      let hp = 0, hpMax = 0, engaged = false;
      for (const s of alive) { hp += Math.max(0, s.hp); hpMax += s.hpMax; engaged ||= !!s.inCombat || !!s.attackTarget; }
      const showHealth = !dead && (c.selected || engaged);
      c.healthBar.back.visible = c.healthBar.front.visible = showHealth;
      if (showHealth) {
        const p = c.flagPos;
        const ratio = hp / Math.max(1, hpMax);
        c.healthBar.back.position.set(p.x, p.y + (c.kind === 'cav' ? 4.5 : 3.6), p.z);
        c.healthBar.front.position.set(p.x, p.y + (c.kind === 'cav' ? 4.5 : 3.6), p.z + 0.01);
        c.healthBar.front.scale.set(Math.max(0.04, 4 * ratio), 0.24, 1);
        c.healthBar.front.material = ratio > 0.55 ? HP_FRONT_MAT : ratio > 0.25
          ? (c._hpWarnMat ||= new THREE.SpriteMaterial({ color: 0xe4a63b, depthTest: false, depthWrite: false }))
          : (c._hpDangerMat ||= new THREE.SpriteMaterial({ color: 0xc23b32, depthTest: false, depthWrite: false }));
      }
    }
    for (const d of this.defenses) {
      for (const s of d.melee) s.syncMesh(dt);
      for (const s of d.archers) s.syncMesh(dt);
      for (const c of d.carriers) c.s.syncMesh(dt);
    }
    for (const sq of this.reserves.squads) for (const s of sq.soldiers) s.syncMesh(dt);
    for (const s of this.garrison.soldiers) s.syncMesh(dt);
    for (const s of this.garrison.archers) s.syncMesh(dt);
    for (const h of this.sally.horses) h.syncMesh(dt);
    this.hoverRing.visible = !!(this.hover && !this.hover.selected && this.hover.aliveSoldiers.length > 0 && fieldStates.includes(this.hover.state));
    if (this.hoverRing.visible) {
      const p = this.hover.flagPos;
      this.hoverRing.position.set(p.x, 0.06, p.z);
    }
  }

  cleanup(dt) {
    const reap = (s, isDef) => {
      if (!s.alive && s.state === 'dying' && s.dieT > 4.0) {
        s.state = 'dead';
        this.group.remove(s.mesh);
        if (!s.counted) { s.counted = true; if (isDef) this.stats.kills++; else this.stats.losses++; }
      }
    };
    for (const c of this.companies) for (const s of c.soldiers) reap(s, false);
    for (const d of this.defenses) {
      for (const s of d.melee) reap(s, true);
      for (const s of d.archers) reap(s, true);
      for (const c of d.carriers) reap(c.s, true);
    }
    for (const sq of this.reserves.squads) for (const s of sq.soldiers) reap(s, true);
    for (const s of this.garrison.soldiers) reap(s, true);
    for (const s of this.garrison.archers) reap(s, true);
    for (const h of this.sally.horses) reap(h, true);
    for (const set of this.wallFighters) {
      for (const s of [...set]) if (s.state === 'dead') set.delete(s);
    }
    for (const s of [...this.cityAttackers]) if (s.state === 'dead') this.cityAttackers.delete(s);
    for (const s of [...this.gateOpeners]) if (!s.alive || this.gate.open) this.gateOpeners.delete(s);
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.t += dt;
      m.mesh.scale.setScalar(1 + m.t * 1.5);
      m.mesh.material.opacity = Math.max(0, 0.9 - m.t * 0.72);
      m.icon.position.y = 4.5 + m.t * 2;
      m.icon.material.opacity = Math.max(0, 1 - m.t * 0.78);
      if (m.t > 1.25) {
        this.group.remove(m.mesh, m.icon);
        m.mesh.material.dispose();
        m.icon.material.dispose();
        this.markers.splice(i, 1);
      }
    }
  }

  // ทหารฝ่ายเมืองทุกนาย (ไม่สร้างอาร์เรย์ใหม่ทุกเฟรม)
  *defenderUnits() {
    for (const d of this.defenses) {
      yield* d.melee;
      yield* d.archers;
      for (const c of d.carriers) yield c.s;
    }
    for (const sq of this.reserves.squads) yield* sq.soldiers;
    if (this.garrison) { yield* this.garrison.soldiers; yield* this.garrison.archers; }
    yield* this.sally.horses;
  }

  // จัดกลุ่มทหารเมืองตามตำแหน่งจริงสำหรับป้ายจำนวน: กำแพงนอก/เมืองนอก/เมืองชั้นในแยกตามด้าน, ลานวัง, ม้าซอง
  defenderGroups() {
    const acc = new Map();
    const add = (key, icon, s) => {
      let g = acc.get(key);
      if (!g) { g = { key, icon, count: 0, x: 0, y: 0, z: 0 }; acc.set(key, g); }
      g.count++;
      g.x += s.pos.x;
      g.z += s.pos.z;
      g.y = Math.max(g.y, s.pos.y);
    };
    for (const s of this.defenderUnits()) {
      if (!s.alive || s.stair) continue;
      if (s.zone === 'wall') add(`wall${sectionOf(s.pos)}`, '🛡', s);
      else if (s.zone === 'city') add(`city${sectionOf(s.pos)}`, '⚔', s);
      else if (s.zone === 'inner' || s.zone === 'wall2') add(`inner${sectionOf(s.pos)}`, '🏮', s);
      else if (s.zone === 'palace' || s.zone === 'wall3') add('palace', '👑', s);
      else if (s.zone === 'field') add('sally', '🐎', s);
    }
    return [...acc.values()].map((g) => ({ ...g, x: g.x / g.count, z: g.z / g.count }));
  }

  updateOverlays(dt, cameraDist, camera = null) {
    this.defMarkers.update(this.defenderUnits(), markerScaleForDistance(cameraDist));
    this.defGroupT -= dt;
    if (this.defGroupT <= 0) { this.defGroupT = 0.4; this.defGroups = this.defenderGroups(); }
    this.defLabels.update(this.defGroups, cameraDist, camera);
  }

  // ข้อมูลสำหรับ HUD
  sideInfo(side) {
    const d = this.defenses[side];
    let onWall = 0, inCity = 0;
    for (const f of this.wallFighters[side]) if (f.alive) onWall++;
    for (const s of this.cityAttackers) if (s.alive && s.side === side) inCity++;
    return {
      captured: this.captured[side],
      capProgress: Math.min(1, this.capT[side] / CFG.captureHoldTime),
      onWall,
      inCity,
      descending: this.stairs[side].down.length,
      defendersWall: d.aliveMelee(),
      pile: d.rock.pile,
      pileMax: CFG.rockLogi.pileMax,
      stock: d.rock.stock,
      pattern: d.cfg.pattern.name,
      reinforceMen: this.reserves.enRouteMen(side),
    };
  }

  globalInfo() {
    let attackersAlive = 0;
    for (const c of this.companies) for (const s of c.soldiers) if (s.alive) attackersAlive++;
    return {
      defendersAlive: this.defenses.reduce((a, d) => a + d.aliveCount(), 0) + this.reserves.aliveCount()
        + this.garrison.aliveCount() + this.sally.horses.filter((h) => h.alive).length,
      defendersInitial: this.stats.defendersInitial,
      reserves: this.reserves.aliveCount(),
      garrison: this.garrison.aliveCount(),
      innerGates: this.innerGates.map((g) => ({ ring: g.ring, open: g.open, hp: g.hp, hpMax: g.hpMax, progress: g.progress, started: g.started })),
      palace: { ...this.palace },
      attackersAlive,
      attackersTotal: this.stats.deployedTotal,
      capturedCount: this.captured.filter(Boolean).length,
      gate: this.gate,
      metrics: { ...this.metrics },
    };
  }

  destroy(scene) {
    scene.remove(this.group);
  }
}
