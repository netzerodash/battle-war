import * as THREE from 'three';
import { CFG } from './config.js';
import {
  worldPoint, sectionCenter, gateFrontPoint, gateInsidePoint, isInsideCity, clampFieldPoint, SIDE_VECS,
  regionOf, GROUND_ZONES, isGroundZone, isInsideZone, zoneRegion, constrainToRegion, sectionOf, clamp, gateHalfWidth,
  wallZoneOf, clampOnInnerWall,
} from './world.js';
import { Soldier } from './soldier.js';
import { makeLadder, makeRamMesh, makeSoldierMesh } from './models.js';
import { unitSlot } from './formation.js';
import { canUnitClimb } from './rules.js';
import { assaultRoute, fieldRoute, routeBetween } from './navigation.js';
import { createOrder, ORDER_KIND, ORDER_PHASE } from './orders.js';

const UP = new THREE.Vector3(0, 1, 0);
const CITY_CENTER = new THREE.Vector3(0, 0, 0); // จุดหันหน้าของแนวยิงในเมือง — กำแพงชั้นในอยู่ระหว่างทางเสมอ
const _v = new THREE.Vector3();
let nextCompanyId = 1;

// บันไดพาดเอนชนหน้ากำแพงด้านนอก ปลายโผล่พ้นใบเสมา — ไม่แทงเข้าเนื้อกำแพงหรือทะลุพื้นทางเดิน
function siegeLadderEnds(side, plantT) {
  const face = CFG.wallHalf + CFG.wallThick;
  return {
    base: worldPoint(side, plantT, face + CFG.ladder.baseDist, 0),
    top: worldPoint(side, plantT, face + CFG.ladder.topOut, CFG.walkY + CFG.ladder.topRise),
  };
}

// กองร้อยหนึ่งหน่วย — มี 4 ประเภท: spear(หอกปีน) / shield(โล่กำบัง) / archer(ธนูกดกำแพง) / ram(รถทุบประตู) + cav
export class Company {
  constructor(idx, side, ctype, spawnAnchor, battle) {
    this.id = nextCompanyId++;
    this.idx = idx;
    this.side = side;
    this.ctype = ctype;        // 'spear' | 'shield' | 'archer' | 'ram' | 'cav'
    this.kind = ctype === 'cav' ? 'cav' : 'inf';
    this.battle = battle;
    this.mode = 'idle';
    this.state = 'idle';
    this.stateT = 0;
    this.spawnBase = spawnAnchor.clone();
    this.anchor = spawnAnchor.clone();
    this.dest = null;
    this.plantT = 0;
    this.soldiers = [];
    this.ladder = null;
    this.ramMesh = null;
    this.ramHp = CFG.unit.ram.ramHp;
    this.selected = false;
    this.enteredCity = false;
    this.pendingCityTarget = null;
    this.waitingGate = false;
    this.pendingTarget = null; // จุดหมายที่ยังไปไม่ถึงเพราะติดประตูที่ปิดอยู่
    this.pendingGate = null;   // เลขชั้นกำแพงของประตูที่ขวางอยู่
    this.escalade = null;      // ข้อมูลบันไดพาดข้ามกำแพงชั้นใน
    this.volleyPos = null;
    this.holdFire = false;
    this.gateCrew = false;
    this.ramSource = null;
    this.formation = 'line';
    this.stance = 'aggressive';
    this.order = null;
    this.progressSampleT = 0;
    this.progressPos = spawnAnchor.clone();
    this.lastReplanAt = -Infinity;

    const isCav = ctype === 'cav';
    const bannerType = { spear: 'atkBanner', shield: 'shieldBanner', archer: 'atkArchBanner', ram: 'crewBanner', cav: 'cavBanner' }[ctype];
    const baseType = { spear: 'atk', shield: 'shield', archer: 'atkArch', ram: 'crew', cav: 'cav' }[ctype];
    const stat = isCav ? CFG.unit.cav
      : ctype === 'ram' ? { hp: CFG.unit.ram.crewHp, dmg: 1, atkCd: 1.0, speed: CFG.unit.ram.speed }
      : ctype === 'archer' ? CFG.unit.atkArch
      : CFG.unit[ctype];
    const n = isCav ? CFG.army.cavalryPerCompany : ctype === 'ram' ? CFG.unit.ram.crew : 10;

    for (let i = 0; i < n; i++) {
      const banner = i === 0;
      const s = new Soldier({
        type: banner ? bannerType : baseType,
        faction: 'atk', side, kind: isCav ? 'cav' : 'inf', utype: isCav ? 'cav' : ctype,
        hp: stat.hp, speed: stat.speed, atkCd: stat.atkCd, dmg: stat.dmg, rng: battle.rng,
      });
      s.company = this;
      const col = (i % 5) - 2, row = Math.floor(i / 5);
      const sp = isCav ? 2.4 : ctype === 'ram' ? 1.7 : 1.5;
      s.pos.copy(spawnAnchor)
        .addScaledVector(SIDE_VECS[side].t, col * sp)
        .addScaledVector(SIDE_VECS[side].n, row * sp);
      s.yaw = Math.atan2(SIDE_VECS[side].n.x, SIDE_VECS[side].n.z);
      s.syncMesh(0);
      battle.group.add(s.mesh);
      this.soldiers.push(s);
    }

    if (ctype === 'spear' || ctype === 'shield') {
      // ทั้งสองประเภทแบกบันไดได้ — สร้างภายหลังเมื่อถูกสั่งโจมตี
    }
    if (ctype === 'ram') {
      this.ramMesh = makeRamMesh();
      this.ramMesh.position.copy(spawnAnchor).setY(0);
      this.ramMesh.rotation.y = Math.atan2(-SIDE_VECS[2].n.x, -SIDE_VECS[2].n.z);
      battle.group.add(this.ramMesh);
    }
  }

  get aliveSoldiers() { return this.soldiers.filter((s) => s.alive); }
  get flagPos() { const s = this.soldiers[0]; return s && s.alive ? s.pos : this.anchor; }
  // ทหารราบทุกชนิดยกเว้นธนูปีนได้; พลรถทุบใช้บันไดเมื่อไม่ได้ถูกส่งเข้าประตูใต้
  get isLadderCarrier() { return canUnitClimb(this.ctype); }

  orderable() {
    if (this.aliveSoldiers.length === 0) return false;
    if (['planting', 'climbing', 'replanting'].includes(this.state)) return false;
    if (this.ctype === 'cav' || this.ctype === 'archer' || this.ctype === 'ram') return true;
    // 'done' = กองที่เหลือทหารกระจัดกระจาย (เช่น บุกแล้วเหลือโคจรกลับ) — สั่งใหม่ได้
    // cityMarch สั่งเปลี่ยนเป้าได้ระหว่างไล่ล่าในเมือง ไม่ต้องรอให้ทั้งกองถึงจุดเดิมก่อน
    return ['idle', 'hold', 'holdAt', 'march', 'done', 'cityMarch', 'escalade'].includes(this.state);
  }

  // ---------- คำสั่ง ----------
  setTactics(formation = this.formation, stance = this.stance) {
    this.formation = formation;
    this.stance = stance;
  }

  beginOrder(kind, target, route, targetSide = null) {
    this.waypoints = route.map((p) => p.clone());
    this.order = createOrder({
      kind, targetPoint: target, targetSide, route,
      formation: this.formation, stance: this.stance, issuedAt: this.battle.time,
    });
    this.progressSampleT = 0;
    this.progressPos.copy(this.anchor);
    for (const s of this.aliveSoldiers) s.intent = `${kind}-${this.order.phase}`;
  }

  routeThreats() {
    const threats = this.battle.wallThreats();
    return this.stance === 'avoid-arrows' ? threats.map((n) => n * 2.5) : threats;
  }

  orderAssault(assaultSide, tactics = {}) {
    if (!this.orderable()) return false;
    this.cancelEscalade();
    this.setTactics(tactics.formation, tactics.stance);
    this.side = assaultSide;
    this.mode = 'assault';

    if (this.ctype === 'archer') {
      // นักธนู: เข้าประจำตำแหน่งยิงที่ระยะพอดี
      this.plantT = this.battle.assignPlantSlot(assaultSide, 'archer');
      this.volleyPos = worldPoint(assaultSide, this.plantT * 0.9, CFG.unit.atkArch.standDist, 0);
      this.dest = this.volleyPos;
      const route = assaultRoute(this.anchor, assaultSide, this.dest, this.routeThreats());
      this.beginOrder(ORDER_KIND.ASSAULT_WALL, this.dest, route, assaultSide);
      this.state = 'march';
      this.stateT = 0;
      for (const s of this.aliveSoldiers) { s.state = 'march'; s.zone = 'field'; }
      return true;
    }

    if (this.ctype === 'ram' && assaultSide === 2 && this.ramMesh && this.ramHp > 0) {
      // รถทุบ: มุ่งหน้าสู่ประตูเมืองเสมอ
      this.state = 'march';
      this.stateT = 0;
      this.dest = gateFrontPoint().addScaledVector(SIDE_VECS[2].n, -1.5);
      const route = assaultRoute(this.anchor, assaultSide, this.dest, this.routeThreats());
      this.beginOrder(ORDER_KIND.ASSAULT_WALL, this.dest, route, assaultSide);
      for (const s of this.aliveSoldiers) { s.state = 'march'; s.zone = 'field'; }
      return true;
    }

    if (this.ctype === 'ram') this.destroyRamMesh();

    // หอก / โล่ — แบกบันไดเข้าโจมตี
    this.plantT = this.battle.assignPlantSlot(assaultSide, 'ladder');
    if (!this.ladder) this.buildLadder(assaultSide, this.plantT);
    else { this.ladder.side = assaultSide; this.resetLadderTo(assaultSide, this.plantT); }
    this.dest = worldPoint(assaultSide, this.plantT, CFG.wallHalf + CFG.wallThick + CFG.ladder.baseDist + 1.8, 0);
    const route = assaultRoute(this.anchor, assaultSide, this.dest, this.routeThreats());
    this.beginOrder(ORDER_KIND.ASSAULT_WALL, this.dest, route, assaultSide);
    this.state = 'march';
    this.stateT = 0;
    for (const s of this.groundSoldiers()) s.state = 'march';
    if (this.ladder && !this.ladder.planted) this.ladder.mesh.visible = true;
    return true;
  }

  buildLadder(assaultSide, plantT) {
    const { base, top } = siegeLadderEnds(assaultSide, plantT);
    const len = base.distanceTo(top);
    const mesh = makeLadder(len);
    mesh.visible = false;
    this.battle.group.add(mesh);
    this.ladder = {
      id: this.battle.nextLadderId++, side: assaultSide, mesh,
      base, top, dir: top.clone().sub(base).normalize(), len,
      planted: false, broken: false, climbers: new Set(), freeze: false,
    };
  }

  resetLadderTo(assaultSide, plantT) {
    const l = this.ladder;
    const ends = siegeLadderEnds(assaultSide, plantT);
    l.base.copy(ends.base);
    l.top.copy(ends.top);
    l.dir.copy(l.top).sub(l.base).normalize();
    l.planted = false; l.broken = false;
  }

  orderHold(point, tactics = {}) {
    if (!this.orderable()) return false;
    this.cancelEscalade();
    this.setTactics(tactics.formation, tactics.stance);
    this.mode = 'hold';
    this.state = 'march';
    this.stateT = 0;
    this.dest = clampFieldPoint(point.clone());
    this.beginOrder(ORDER_KIND.HOLD, this.dest, fieldRoute(this.routeStart(), this.dest, this.routeThreats(), this.gatesOpen()));
    for (const s of this.groundSoldiers()) s.state = 'march';
    if (this.ladder && this.ladder.planted) { this.ladder.planted = false; this.ladder.mesh.visible = false; }
    return true;
  }

  // กองม้า: ขี่ไปจุดหมาย (เส้นทางเข้าเมืองต้องผ่านประตู)
  orderRide(point, tactics = {}) {
    if (this.ctype !== 'cav' || this.aliveSoldiers.length === 0) return false;
    this.setTactics(tactics.formation || 'line', tactics.stance);
    this.mode = 'ride';
    const target = point.clone();
    this.routeStart();
    this.buildRideRoute(target);
    // เส้นทางติดประตูที่ปิด → ขี่ไปรอหน้าประตูนั้น แล้วพุ่งต่อเองเมื่อประตูเปิด
    this.rememberBlockedTarget(this.waypoints, target);
    this.waitingGate = this.pendingGate === 0;
    this.pendingCityTarget = this.waitingGate ? target.clone() : null;
    if (this.pendingGate !== null) this.battle.onEvent('cav_wait_gate', { ring: this.pendingGate });
    for (const s of this.aliveSoldiers) s.chargeReady = true;
    this.order = createOrder({
      kind: isInsideCity(point) ? ORDER_KIND.ENTER_GATE : ORDER_KIND.MOVE,
      targetPoint: point, targetSide: isInsideCity(point) ? 2 : null,
      route: this.waypoints || [], formation: this.formation, stance: this.stance, issuedAt: this.battle.time,
    });
    this.state = 'ride';
    this.stateT = 0;
    return true;
  }

  // ทหารราบเดินเข้าเมืองผ่านประตู (ได้เมื่อประตูเปิดแล้วเท่านั้น)
  // นักธนูเข้าได้ด้วย — ถึงที่แล้วตั้งแนวยิงในเมือง (cityVolley) ไว้กดพลธนูบนสันกำแพงชั้นใน
  orderCity(point, tactics = {}) {
    if (this.kind !== 'inf') return false;
    if (!this.orderable() || this.aliveSoldiers.length === 0) return false;
    // กองนอกเมืองเข้าได้เมื่อประตูนอกเปิดแล้ว; กองที่อยู่ในเมืองแล้วเดินข้ามชั้นได้ตามประตูที่เปิดอยู่
    if (!this.battle.gate.open && !this.hasInsideSoldiers()) return false;
    this.cancelEscalade();
    this.mode = 'city';
    this.setTactics(tactics.formation || 'column', tactics.stance);
    if (this.ctype === 'ram') this.destroyRamMesh();
    this.enteredCity = false;
    this.waypoints = routeBetween(this.routeStart(), point, this.routeThreats(), this.gatesOpen());
    this.rememberBlockedTarget(this.waypoints, point);
    this.order = createOrder({
      kind: ORDER_KIND.ENTER_GATE, targetPoint: point, targetSide: 2,
      route: this.waypoints, formation: this.formation, stance: this.stance, issuedAt: this.battle.time,
    });
    this.state = 'cityMarch';
    this.stateT = 0;
    // โซนของแต่ละคนคงตามตำแหน่งจริง แล้วค่อยเปลี่ยนเมื่อลอดประตูแต่ละชั้น
    for (const s of this.groundSoldiers()) s.state = 'march';
    if (this.ladder) { this.ladder.planted = false; this.ladder.mesh.visible = false; }
    return true;
  }

  // เมื่อพลรถทุบตายหมด นักธนูที่ยังรบได้จะไปรับช่วงรถทุบที่ถูกทิ้งไว้
  takeOverRam(ramCompany) {
    if (this.ctype !== 'archer' || this.gateCrew || this.aliveSoldiers.length === 0) return false;
    if (!ramCompany?.ramMesh || ramCompany.ramHp <= 0 || ramCompany.ramClaimedBy) return false;
    ramCompany.ramClaimedBy = this;
    this.gateCrew = true;
    this.ramSource = ramCompany;
    this.side = 2;
    this.mode = 'ram-takeover';
    this.state = 'march';
    this.stateT = 0;
    this.dest = ramCompany.anchor.clone();
    const route = fieldRoute(this.anchor, this.dest, this.routeThreats(), this.gatesOpen());
    this.beginOrder(ORDER_KIND.ASSAULT_WALL, this.dest, route, 2);
    this.order.waitingReason = 'กำลังไปรับช่วงรถทุบประตู';
    for (const s of this.aliveSoldiers) { s.state = 'march'; s.zone = 'field'; s.intent = 'take-over-abandoned-ram'; }
    return true;
  }

  collectAbandonedRam() {
    const source = this.ramSource;
    if (!source?.ramMesh || source.ramHp <= 0) {
      if (source?.ramClaimedBy === this) source.ramClaimedBy = null;
      this.gateCrew = false;
      this.ramSource = null;
      this.state = 'volley';
      return false;
    }
    this.ramMesh = source.ramMesh;
    this.ramHp = source.ramHp;
    source.ramMesh = null;
    source.ramHp = 0;
    source.ramClaimedBy = null;
    this.ramSource = null;
    this.mode = 'assault';
    this.dest = gateFrontPoint().addScaledVector(SIDE_VECS[2].n, -1.5);
    const route = assaultRoute(this.anchor, 2, this.dest, this.routeThreats());
    this.beginOrder(ORDER_KIND.ASSAULT_WALL, this.dest, route, 2);
    this.order.waitingReason = '';
    this.state = 'march';
    for (const s of this.aliveSoldiers) { s.state = 'march'; s.intent = 'push-recovered-ram'; }
    this.battle.onEvent('archer_ram_takeover', { n: this.aliveSoldiers.length });
    return true;
  }

  // หลังยึดกำแพง นักธนูวางคันธนู หยิบหอก และใช้ state machine ของทหารราบเต็มรูปแบบ
  rearmAsSpear(forceCityAfterCapture = true) {
    if (this.ctype !== 'archer' || this.aliveSoldiers.length === 0) return false;
    this.ctype = 'spear';
    this.kind = 'inf';
    this.holdFire = false;
    this.soldiers.forEach((s, index) => {
      if (!s.alive) return;
      const healthRatio = s.hpMax > 0 ? Math.max(0, s.hp) / s.hpMax : 1;
      const scale = s.mesh.scale.clone();
      this.battle.group.remove(s.mesh);
      s.mesh = makeSoldierMesh(index === 0 ? 'atkBanner' : 'atk');
      s.mesh.userData.soldier = s;
      s.mesh.scale.copy(scale);
      s.utype = 'spear';
      s.forceCityAfterCapture = forceCityAfterCapture;
      s.hpMax = CFG.unit.spear.hp;
      s.hp = Math.max(1, s.hpMax * healthRatio);
      s.speed = CFG.unit.spear.speed;
      s.atkCd = CFG.unit.spear.atkCd;
      s.dmg = CFG.unit.spear.dmg;
      this.battle.group.add(s.mesh);
      s.syncMesh(0);
    });
    return true;
  }

  orderRetreat() {
    const alive = this.aliveSoldiers;
    if (!alive.length || alive.some((s) => s.zone === 'wall' || s.zone === 'stair' || s.climb)) return false;
    this.cancelEscalade();
    this.setTactics('column', 'hold');
    this.mode = 'retreat';
    this.dest = this.spawnBase.clone();
    if (this.ctype === 'cav') {
      this.buildRideRoute(this.dest);
      this.order = createOrder({
        kind: ORDER_KIND.RETREAT, targetPoint: this.dest, route: this.waypoints,
        formation: this.formation, stance: this.stance, issuedAt: this.battle.time,
      });
      this.state = 'ride';
    } else {
      const route = fieldRoute(this.routeStart(), this.dest, this.routeThreats(), this.gatesOpen());
      this.beginOrder(ORDER_KIND.RETREAT, this.dest, route);
      this.state = this.hasInsideSoldiers() ? 'cityMarch' : 'march';
    }
    this.stateT = 0;
    for (const s of alive) { s.state = 'march'; s.intent = 'retreating'; }
    return true;
  }

  buildRideRoute(target) {
    this.waypoints = routeBetween(this.anchor, target, this.routeThreats(), this.gatesOpen());
  }

  gatesOpen() {
    return this.battle.gatesOpen ? this.battle.gatesOpen() : [!!this.battle.gate?.open, false, false];
  }

  hasInsideSoldiers() {
    return this.aliveSoldiers.some((s) => isInsideZone(s.zone));
  }

  // จุดเริ่มคิดเส้นทาง = กลางกลุ่มทหารภาคพื้นในโซนที่มีคนมากที่สุด (กองที่แตกกระจายหลังปีนกำแพงก็ยังคิดเส้นทางถูก)
  routeStart() {
    const ground = this.groundSoldiers();
    if (!ground.length) return this.anchor;
    const byZone = new Map();
    for (const s of ground) {
      if (!byZone.has(s.zone)) byZone.set(s.zone, []);
      byZone.get(s.zone).push(s);
    }
    const main = [...byZone.values()].sort((a, b) => b.length - a.length)[0];
    this.updateAnchor(main);
    return this.anchor;
  }

  rememberBlockedTarget(route, point) {
    const blocked = route?.blockedAt;
    this.pendingGate = blocked === undefined ? null : blocked;
    this.pendingTarget = blocked === undefined ? null : point.clone();
    if (blocked !== undefined && this.order) this.order.waitingReason = blocked === 0 ? 'รอประตูเมืองเปิด' : `รอประตูชั้น ${blocked + 1} เปิด (ฟันประตูได้)`;
  }

  // ปรับโซนตามตำแหน่งจริงหลังเดิน — ลอดประตูชั้นไหนก็เปลี่ยนเป็นโซนของชั้นนั้น
  syncZone(s) {
    if (!isGroundZone(s.zone) || s.climb) return;
    const zone = GROUND_ZONES[regionOf(s.pos)];
    if (zone === s.zone) return;
    const wasInside = isInsideZone(s.zone);
    s.zone = zone;
    if (isInsideZone(zone) && !wasInside) {
      if (this.kind === 'cav') this.battle.onCavEnteredCity(s); else this.battle.onInfEnteredCity(s);
    } else if (!isInsideZone(zone) && wasInside) {
      if (this.kind === 'cav') this.battle.onCavLeftCity(s); else this.battle.onInfLeftCity(s);
    }
  }

  constrainSoldier(s, gates = this.gatesOpen()) {
    if (!isGroundZone(s.zone) || s.climb) return;
    constrainToRegion(s.pos, zoneRegion(s.zone), gates);
    s.pos.y = 0;
  }

  // ถึงปลายทางของคำสั่งเดิน — ถ้าเป็นคำสั่งพาดบันไดข้ามกำแพงชั้นใน ก็เริ่มตั้งบันไดต่อทันที
  arrive() {
    if (this.state !== 'cityMarch' && this.state !== 'ride') return;
    this.waypoints = null;
    // นักธนูที่เดินเข้าเมือง (ไม่ได้ไปรับช่วงรถทุบ) ตั้งแนวยิงทันที — battle.updateArcherVolley จะยิงให้
    this.state = (this.ctype === 'archer' && !this.gateCrew && this.mode === 'city') ? 'cityVolley' : 'holdAt';
    if (this.state === 'cityVolley') this.spreadVolleyLine();
    if (this.order) this.order.phase = this.state === 'cityVolley' ? ORDER_PHASE.ENGAGE : ORDER_PHASE.COMPLETE;
    if (this.escalade) this.beginEscalade();
  }

  // แนวยิงในเมือง: ยืนเรียงขนานกำแพงด้านที่กองอยู่ ไม่กระจุกเป็นก้อนให้หินหรือน้ำมันกินทีเดียว
  spreadVolleyLine() {
    const alive = this.aliveSoldiers;
    if (!alive.length) return;
    const side = sectionOf(this.anchor);
    const t = SIDE_VECS[side].t;
    const out = SIDE_VECS[side].n;
    alive.forEach((s, i) => {
      const col = (i % 5) - 2, row = Math.floor(i / 5);
      s.gatherPos = this.anchor.clone().addScaledVector(t, col * 2.0).addScaledVector(out, row * 2.0).setY(0);
    });
  }

  // ---------- พาดบันไดข้ามกำแพงชั้นใน ----------
  orderEscalade(ring, point, tactics = {}) {
    if (this.kind !== 'inf' || this.ctype === 'archer' || !this.orderable()) return false;
    const R = CFG.rings[ring];
    if (!R || ring < 1) return false;
    const start = this.routeStart();
    if (regionOf(start) > ring) return false; // อยู่ด้านในกำแพงชั้นนั้นแล้ว
    const side = sectionOf(point);
    let t = clamp(SIDE_VECS[side].t.dot(point), -(R.half - 2), R.half - 2);
    if (side === 2 && Math.abs(t) < gateHalfWidth(ring) + 3) t = (t < 0 ? -1 : 1) * (gateHalfWidth(ring) + 3);
    // พาดเอนชนขอบหลังคากระเบื้องที่ยื่นพ้นหน้ากำแพง 0.45 ม. ปลายโผล่พ้นสันกำแพง มุมเอียงราว 75°
    const face = R.half + R.thick;
    const topOut = 0.6, topY = R.h + 1.1, run = topY / 3.8;
    const base = worldPoint(side, t, face + topOut + run + 1.0, 0);
    const route = routeBetween(start, base, this.routeThreats(), this.gatesOpen());
    if (route.blockedAt !== undefined) return false; // ยังเข้าไม่ถึงลานหน้ากำแพงชั้นนั้น
    this.cancelEscalade();
    this.setTactics(tactics.formation || 'column', tactics.stance);
    if (this.ctype === 'ram') this.destroyRamMesh();
    this.mode = 'escalade';
    this.escalade = {
      ring, side, t, base,
      foot: worldPoint(side, t, face + topOut + run, 0),
      top: worldPoint(side, t, face + topOut, topY),
      landing: worldPoint(side, t, R.half - 1.8, 0),
      climbers: new Set(), onWall: new Set(), sweepT: 0, mesh: null, planted: false, len: 0, dir: null,
      mid: worldPoint(side, t, face - R.thick / 2, R.h + 0.45), // จุดยืนกลางสันกำแพงตรงหัวบันได
    };
    this.waypoints = route;
    this.pendingTarget = null;
    this.pendingGate = null;
    this.order = createOrder({
      kind: ORDER_KIND.ASSAULT_WALL, targetPoint: base, targetSide: side, route,
      formation: this.formation, stance: this.stance, issuedAt: this.battle.time,
    });
    this.state = 'cityMarch';
    this.stateT = 0;
    for (const s of this.groundSoldiers()) s.state = 'march';
    return true;
  }

  beginEscalade() {
    const e = this.escalade;
    this.state = 'escalade';
    this.stateT = 0;
    e.sweepT = 0; // นับเวลากวาดสันกำแพงตั้งแต่เริ่มตั้งบันไดจริง ไม่ใช่ตั้งแต่ออกเดิน
    e.len = e.foot.distanceTo(e.top);
    e.dir = e.top.clone().sub(e.foot).normalize();
    e.mesh = makeLadder(e.len);
    e.mesh.position.copy(e.foot);
    e.mesh.quaternion.setFromUnitVectors(UP, e.dir);
    e.mesh.visible = false;
    this.battle.group.add(e.mesh);
    const R = CFG.rings[e.ring];
    this.aliveSoldiers.forEach((s, i) => {
      const a = (i / Math.max(1, this.aliveSoldiers.length)) * Math.PI;
      const r = 1.6 + (i % 3) * 0.9;
      s.gatherPos = worldPoint(e.side, e.t + Math.cos(a) * r, R.half + R.thick + 2.4 + Math.sin(a) * r, 0);
    });
    if (this.order) this.order.phase = ORDER_PHASE.DEPLOY;
    this.battle.onEvent('escalade_start', { ring: e.ring, side: e.side });
  }

  updateEscalade(dt, alive) {
    const e = this.escalade;
    if (!e) { this.state = 'holdAt'; return; }
    const outsideZone = GROUND_ZONES[e.ring], insideZone = GROUND_ZONES[e.ring + 1];
    if (!e.planted && this.stateT >= CFG.escalade.plantTime) {
      e.planted = true;
      e.mesh.visible = true;
      if (this.order) this.order.phase = ORDER_PHASE.ENGAGE;
    }
    e.sweepT += dt;
    const crestZone = wallZoneOf(e.ring);
    // ยังมีพลธนูฝ่ายเมืองเฝ้าสันกำแพงช่วงหัวบันไดอยู่ไหม — มีก็ขึ้นไปกวาดก่อน ไม่มีก็ข้ามลงลานเลย
    const sweeping = e.sweepT < CFG.escalade.sweepTimeout
      && !!this.battle.crestArcherNear?.(e.ring, e.mid, CFG.escalade.sweepRange);
    const dropInside = (s) => {
      s.onCrest = false;
      s.pos.copy(e.landing).addScaledVector(SIDE_VECS[e.side].t, (this.battle.rng() - 0.5) * 3);
      s.pos.y = 0;
      s.zone = insideZone;
      s.state = 'order';
      s.orderTarget = null;
      s.intent = 'escalade-landed';
      this.battle.onInfEnteredCity(s);
    };
    for (const s of [...e.climbers]) {
      if (!s.alive) { e.climbers.delete(s); continue; }
      s.climb.s += s.speed * CFG.escalade.climbFactor * dt;
      if (s.climb.s >= e.len) {
        e.climbers.delete(s);
        s.climb = null;
        if (sweeping) {
          // ขึ้นยืนบนสันกำแพง เข้าฟันพลธนูที่เฝ้าอยู่ (melee loop รับช่วงต่อ)
          s.pos.copy(e.mid).addScaledVector(SIDE_VECS[e.side].t, (this.battle.rng() - 0.5) * 3);
          clampOnInnerWall(s.pos, e.ring);
          s.zone = crestZone;
          s.onCrest = true;
          s.state = 'order';
          s.orderTarget = null;
          s.intent = 'clearing-wall-archers';
          e.onWall.add(s);
          this.battle.onInfEnteredCity(s);
        } else dropInside(s);
        continue;
      }
      s.pos.copy(e.foot).addScaledVector(e.dir, s.climb.s);
      s.facePoint(e.top, dt);
    }
    // สันกำแพงโล่งแล้ว (หรือกวาดนานเกินกำหนด) — ชุดที่อยู่บนสันโดดลงลานด้านในต่อ
    for (const s of [...e.onWall]) {
      if (!s.alive) { e.onWall.delete(s); continue; }
      if (sweeping) { clampOnInnerWall(s.pos, e.ring); continue; }
      e.onWall.delete(s);
      dropInside(s);
    }
    let waiting = 0;
    for (const s of alive) {
      if (s.climb || s.zone !== outsideZone) continue;
      waiting++;
      if (this.yieldsControl(s)) continue;
      if (!e.planted || e.climbers.size >= CFG.escalade.maxClimbers) {
        if (s.gatherPos) this.stepUnit(s, dt, s.gatherPos, s.speed, 0.5);
        continue;
      }
      s.state = 'toLadder';
      if (this.stepUnit(s, dt, e.base, s.speed, 0.9) && e.climbers.size < CFG.escalade.maxClimbers) {
        s.state = 'climb';
        s.zone = 'ladder';
        s.climb = { ladder: e, s: 0 };
        s.intent = 'escalade-climb';
        this.battle.engagements?.release(s);
        e.climbers.add(s);
      }
    }
    this.updateAnchor(alive);
    if (waiting === 0 && e.climbers.size === 0 && e.onWall.size === 0) this.finishEscalade();
  }

  finishEscalade() {
    const e = this.escalade;
    if (e?.mesh) this.battle.group.remove(e.mesh);
    this.escalade = null;
    this.mode = 'city';
    this.state = 'holdAt';
    if (this.order) this.order.phase = ORDER_PHASE.COMPLETE;
    this.battle.onEvent('escalade_done', { ring: e?.ring });
  }

  // ยกเลิกการพาดบันไดเมื่อรับคำสั่งใหม่ — คนที่ค้างกลางบันไดไต่กลับลงมาที่โคน
  cancelEscalade() {
    for (const s of this.escalade?.onWall || []) s.onCrest = false;
    const e = this.escalade;
    if (!e) return;
    for (const s of e.climbers) {
      if (!s.alive) continue;
      s.climb = null;
      s.zone = GROUND_ZONES[e.ring];
      s.pos.copy(e.base);
      s.state = 'march';
    }
    if (e.mesh) this.battle.group.remove(e.mesh);
    this.escalade = null;
  }

  // ---------- อัปเดตรายเฟรม ----------
  update(dt) {
    this.stateT += dt;
    const alive = this.aliveSoldiers;
    if (alive.length === 0) { this.state = 'dead'; return; }
    const v = SIDE_VECS[this.side];
    const gates = this.gatesOpen();

    switch (this.state) {
      case 'idle':
      case 'holdAt':
        break;

      case 'march': {
        const marchTarget = this.waypoints?.length ? this.waypoints[0] : this.dest;
        _v.subVectors(marchTarget, this.anchor); _v.y = 0;
        const d = _v.length();
        const spd = this.ramMesh ? CFG.unit.ram.speed : 2.6;
        if (d > 0.4) {
          _v.normalize();
          if (this.battle.canCompanyAdvance(this, _v)) {
            this.anchor.addScaledVector(_v, Math.min(d, spd * dt));
            if (this.order?.waitingReason === 'รอช่องทางเดิน') this.order.waitingReason = '';
          } else if (this.order) {
            this.order.waitingReason = 'รอช่องทางเดิน';
          }
        }
        this.followSlots(dt, alive, marchTarget);

        if (this.ladder && !this.ladder.planted && !this.ladder.broken && this.mode === 'assault') {
          const m = this.ladder.mesh;
          m.visible = true;
          m.position.copy(this.anchor).setY(1.2);
          m.quaternion.setFromUnitVectors(UP, v.n);
        }
        if (this.ramMesh) {
          this.ramMesh.position.set(this.anchor.x, 0, this.anchor.z);
        }
        if (d <= 0.4) {
          if (this.waypoints?.length) {
            this.waypoints.shift();
            if (this.order) {
              this.order.routeIndex++;
              this.order.phase = this.waypoints.length > 1 ? ORDER_PHASE.TRANSIT : ORDER_PHASE.APPROACH;
            }
            if (this.waypoints.length > 0) break;
          }
          if (this.mode === 'ram-takeover') {
            this.collectAbandonedRam();
          }
          else if (this.mode === 'assault') {
            if (this.gateCrew && this.ramMesh) {
              this.state = 'battering'; this.stateT = 0;
              if (this.order) this.order.phase = ORDER_PHASE.ENGAGE;
              this.battle.onEvent('ram_ready', {});
            }
            else if (this.ctype === 'archer') {
              this.state = 'volley';
              if (this.order) this.order.phase = ORDER_PHASE.ENGAGE;
            }
            else if (this.ctype === 'ram') {
              this.state = 'battering'; this.stateT = 0;
              if (this.order) this.order.phase = ORDER_PHASE.ENGAGE;
              this.battle.onEvent('ram_ready', {});
            }
            else {
              this.state = 'planting'; this.stateT = 0; this.gatherTargets();
              if (this.order) this.order.phase = ORDER_PHASE.DEPLOY;
            }
          } else {
            this.state = 'hold';
            if (this.order) this.order.phase = ORDER_PHASE.COMPLETE;
          }
        }
        break;
      }

      case 'volley': {
        // นักธนูประจำตำแหน่ง — การยิงเกิดใน battle (ยิงเป้าบนกำแพง)
        for (const s of alive) {
          s.state = 'order';
          s.facePoint(worldPoint(this.side, 0, CFG.wallHalf, 0), dt);
        }
        break;
      }

      case 'cityVolley': {
        // แนวยิงในเมือง: ยืนกดพลธนู/องครักษ์บนกำแพงชั้นถัดเข้าไป (หันเข้าหากลางเมือง)
        for (const s of alive) {
          if (s.inCombat) continue; // โดนบุกถึงตัวแล้ว ปล่อยให้ melee loop คุม
          s.state = 'order';
          if (s.gatherPos) this.stepUnit(s, dt, s.gatherPos, s.speed, 0.6);
          s.facePoint(CITY_CENTER, dt);
        }
        this.updateAnchor(alive);
        break;
      }

      case 'battering': {
        // รถทุบ: เคลื่อนทวนไม้ + บั่นทอนประตู (สนามรบจัดการ breach ใน battle)
        for (const s of alive) {
          s.state = 'order';
          if (!s.inCombat) s.facePoint(gateInsidePoint(), dt);
        }
        if (this.ramMesh) {
          const k = Math.sin(this.battle.time * 5) * 0.45;
          this.ramMesh.position.set(this.dest.x, 0, this.dest.z + k);
        }
        break;
      }

      case 'planting': {
        for (const s of alive) {
          if (this.yieldsControl(s)) continue;
          if (s.state === 'march' || s.state === 'idle') {
            this.stepUnit(s, dt, s.gatherPos, s.speed, 0.4);
            if (!s.moving) s.facePoint(this.ladder ? this.ladder.base : this.anchor, dt);
          }
        }
        if (this.stateT >= CFG.ladder.plantTime) this.plantLadder();
        break;
      }

      case 'climbing': this.updateClimbing(dt); break;

      case 'escalade': this.updateEscalade(dt, alive); break;

      case 'replanting': {
        for (const s of alive) if (s.gatherPos && !this.yieldsControl(s)) this.stepUnit(s, dt, s.gatherPos, s.speed, 0.5);
        if (this.stateT >= CFG.ladder.replantTime) {
          this.plantT += this.battle.rng() * 12 - 6;
          this.resetLadderTo(this.side, this.plantT);
          this.ladder.mesh.visible = true;
          this.gatherTargets();
          this.state = 'planting';
          this.stateT = -1.0;
        }
        break;
      }

      case 'hold': {
        for (const s of alive) {
          s.state = 'hold';
          if (s.gatherPos && !this.yieldsControl(s)) this.stepUnit(s, dt, s.gatherPos, s.speed, 0.4);
          s.facePoint(sectionCenter(this.side), dt);
        }
        break;
      }

      case 'ride': {
        let done = true;
        for (let i = 0; i < alive.length; i++) {
          const s = alive[i];
          const wp = this.waypoints && this.waypoints.length ? this.waypoints[0] : this.dest;
          if (!wp) break;
          const final = !this.waypoints || this.waypoints.length <= 1;
          if (!this.yieldsControl(s)) {
            const target = this.routeSlot(wp, i, alive.length, final, 2.6);
            if (!this.stepUnit(s, dt, target, CFG.unit.cav.speed, 1.0)) done = false;
          }
          this.constrainSoldier(s, gates);
          this.syncZone(s);
          if (isInsideZone(s.zone) && !this.enteredCity) { this.enteredCity = true; this.battle.onEvent('cav_enter', {}); }
        }
        this.updateAnchor(this.leadingSoldiers(alive));
        if (this.waypoints && this.waypoints.length && this.anchorCloseTo(this.waypoints[0])) {
          this.waypoints.shift();
          if (this.order) { this.order.routeIndex++; this.order.phase = this.waypoints.length > 1 ? ORDER_PHASE.TRANSIT : ORDER_PHASE.APPROACH; }
          if (this.waypoints.length === 0) { this.dest = null; this.arrive(); }
        }
        if (done && (!this.waypoints || this.waypoints.length <= 1)) this.arrive();
        break;
      }

      case 'holdAt': {
        if (this.waypoints && this.waypoints.length === 0) this.waypoints = null;
        break;
      }

      case 'cityMarch': {
        // ราบเดินเข้าเมืองผ่านประตู (เปิดแล้ว) — เข้าไปแล้วกลายเป็นนักรบในเมือง
        let done = true;
        for (let i = 0; i < alive.length; i++) {
          const s = alive[i];
          const wp = this.waypoints && this.waypoints.length ? this.waypoints[0] : this.dest;
          if (!wp) break;
          const final = !this.waypoints || this.waypoints.length <= 1;
          if (!this.yieldsControl(s)) {
            // แถวตอนคงรูปกองตลอดทาง (ผ่านช่องประตูได้) — แบบอื่นค่อยกระจายตอนถึงปลายทาง
            const target = this.routeSlot(wp, i, alive.length, final || this.formation === 'column', 1.5);
            if (!this.stepUnit(s, dt, target, s.speed, 0.7)) done = false;
          }
          this.constrainSoldier(s, gates);
          this.syncZone(s);
        }
        this.updateAnchor(this.leadingSoldiers(alive));
        if (this.waypoints && this.waypoints.length && this.anchorCloseTo(this.waypoints[0])) {
          this.waypoints.shift();
          if (this.order) { this.order.routeIndex++; this.order.phase = this.waypoints.length > 1 ? ORDER_PHASE.TRANSIT : ORDER_PHASE.APPROACH; }
          if (this.waypoints.length === 0) { this.dest = null; this.arrive(); }
        }
        if (done && (!this.waypoints || this.waypoints.length <= 1)) this.arrive();
        break;
      }
    }
    this.trackProgress(dt);
  }

  // ทหารที่ปะทะอยู่ให้ melee loop คุมตัว — ถ้ากองลากกลับเข้าแถวพร้อมกัน จะชักเย่อจนไม่ขยับและตีไม่ถึง
  // (ยกเว้นคำสั่งถอยที่ต้องดึงออกจากวงรบ) ส่วนคนที่อยู่บนกำแพง/บันได/กำลังเข้าบันไดใน กองไม่ลากตามเลย
  yieldsControl(s) {
    if (s.zone === 'wall' || s.onCrest || s.stair || s.climb || s.state === 'toStairUp') return true;
    return s.inCombat && this.mode !== 'retreat';
  }

  // ทหารที่รับคำสั่งภาคพื้นได้ — ไม่ดึงคนที่ยืนบนกำแพงหรือกำลังใช้บันไดลงมาเดินกลางอากาศ
  groundSoldiers() {
    return this.aliveSoldiers.filter((s) => s.zone !== 'wall' && !s.onCrest && !s.stair && !s.climb);
  }

  // ปลายทางแออัด (หลายกองมุ่งจุดเดียว) จนเดินต่อไม่ได้ → ถือว่าถึงแล้ว กองจะได้รับคำสั่งใหม่ได้
  finishCrowdedArrival() {
    if (this.state !== 'cityMarch' && this.state !== 'ride') return false;
    if (this.waypoints && this.waypoints.length > 1) return false;
    const target = this.order?.targetPoint;
    if (!target || this.anchor.distanceTo(target) > 12) return false;
    this.order.stuckFor = 0;
    this.order.waitingReason = '';
    this.arrive();
    return true;
  }

  stepUnit(s, dt, target, speed, arriveR) {
    return this.battle.stepGroundUnit
      ? this.battle.stepGroundUnit(s, dt, target, speed, arriveR)
      : s.stepToward(dt, target, speed, arriveR);
  }

  trackProgress(dt) {
    if (!['march', 'ride', 'cityMarch'].includes(this.state) || !this.order) return;
    this.progressSampleT += dt;
    if (this.progressSampleT < CFG.movement.stuckSample) return;
    const moved = this.anchor.distanceTo(this.progressPos);
    if (this.order.waitingReason === 'รอช่องทางเดิน') {
      this.order.stuckFor = 0;
      this.progressPos.copy(this.anchor);
      this.progressSampleT = 0;
      return;
    }
    this.order.stuckFor = moved < CFG.movement.stuckMinProgress
      ? this.order.stuckFor + this.progressSampleT
      : Math.max(0, this.order.stuckFor - this.progressSampleT * 2);
    if (moved >= CFG.movement.stuckMinProgress && this.order.waitingReason === 'กำลังหาเส้นทางใหม่') this.order.waitingReason = '';
    this.progressPos.copy(this.anchor);
    this.progressSampleT = 0;
    if (this.order.stuckFor < CFG.movement.stuckTimeout) return;
    if (this.finishCrowdedArrival()) return;
    if (this.battle.time - this.lastReplanAt < CFG.movement.replanCooldown) return;
    this.replanCurrentOrder();
  }

  replanCurrentOrder() {
    if (!this.order?.targetPoint) return;
    let route;
    if (this.order.kind === ORDER_KIND.ASSAULT_WALL) {
      route = assaultRoute(this.anchor, this.order.targetSide ?? this.side, this.order.targetPoint, this.routeThreats());
    } else {
      route = fieldRoute(this.anchor, this.order.targetPoint, this.routeThreats(), this.gatesOpen());
    }
    this.waypoints = route.map((p) => p.clone());
    this.order.route = route.map((p) => p.clone());
    this.order.routeIndex = 0;
    this.order.replanCount++;
    this.order.stuckFor = 0;
    this.order.waitingReason = 'กำลังหาเส้นทางใหม่';
    this.lastReplanAt = this.battle.time;
    for (const s of this.aliveSoldiers) s.intent = 'replanning-route';
  }

  anchorCloseTo(p) { return this.anchor.distanceTo(p) < 3.5; }

  // จุดศูนย์กองคิดจากคนที่ยังเดินตามคำสั่ง — คนที่แยกไปรบไม่ควรถ่วงให้กองไม่ถึงจุดหมาย
  leadingSoldiers(alive) {
    const leading = alive.filter((s) => !this.yieldsControl(s));
    return leading.length ? leading : alive;
  }

  updateAnchor(alive = this.aliveSoldiers) {
    if (!alive.length) return;
    this.anchor.set(0, 0, 0);
    for (const s of alive) this.anchor.add(s.pos);
    this.anchor.multiplyScalar(1 / alive.length).setY(0);
  }

  routeSlot(waypoint, index, count, spread, spacing) {
    if (!spread) return waypoint;
    const forward = _v.copy(waypoint).sub(this.anchor).setY(0);
    if (forward.lengthSq() < 0.001) forward.copy(SIDE_VECS[this.side].n).multiplyScalar(-1);
    forward.normalize();
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const slot = unitSlot(index, count, spacing, this.formation);
    return waypoint.clone().addScaledVector(right, slot.lateral).addScaledVector(forward, slot.depth);
  }

  followSlots(dt, alive, destination = this.dest) {
    const forward = destination ? destination.clone().sub(this.anchor).setY(0) : SIDE_VECS[this.side].n.clone().multiplyScalar(-1);
    if (forward.lengthSq() < 0.001) forward.copy(SIDE_VECS[this.side].n).multiplyScalar(-1);
    forward.normalize();
    const right = new THREE.Vector3(forward.z, 0, -forward.x);
    const sp = this.kind === 'cav' ? 2.6 : this.ramMesh ? 2.2 : 1.5;
    const gates = this.gatesOpen();
    for (let i = 0; i < alive.length; i++) {
      const s = alive[i];
      if (this.yieldsControl(s)) continue;
      const slot = unitSlot(i, alive.length, sp, this.formation);
      _v.copy(this.anchor)
        .addScaledVector(right, slot.lateral)
        .addScaledVector(forward, slot.depth);
      this.stepUnit(s, dt, _v, s.speed, 0.6);
      this.constrainSoldier(s, gates);
      this.syncZone(s);
    }
  }

  gatherTargets() {
    const alive = this.aliveSoldiers;
    alive.forEach((s, i) => {
      const a = (i / Math.max(1, alive.length)) * Math.PI * 2;
      const r = 2.0 + (i % 3) * 0.9;
      s.gatherPos = worldPoint(this.side, this.plantT + Math.cos(a) * r,
        CFG.wallHalf + CFG.wallThick + CFG.ladder.baseDist + 1.8 + Math.sin(a) * r, 0);
    });
  }

  plantLadder() {
    const l = this.ladder;
    if (!l || l.broken) return;
    l.planted = true;
    l.mesh.visible = true;
    l.mesh.position.copy(l.base);
    l.mesh.quaternion.setFromUnitVectors(UP, l.dir);
    // เฉพาะคนที่ยังอยู่ข้างล่าง — คนที่ขึ้นกำแพง/ลงเมืองไปแล้วทำภารกิจของตัวเองต่อ
    for (const s of this.aliveSoldiers) if (s.zone === 'field' && !s.climb) s.state = 'waitBase';
    this.state = 'climbing';
    if (this.order) this.order.phase = ORDER_PHASE.ENGAGE;
  }

  updateClimbing(dt) {
    const l = this.ladder;
    if (!l || l.broken) return;
    const v = SIDE_VECS[this.side];

    for (const s of [...l.climbers]) {
      if (!s.alive) { l.climbers.delete(s); continue; }
      if (!l.freeze) s.climb.s += s.speed * 0.5 * dt; // climb speed ตามชนิดทหาร (โล่ช้ากว่า)
      if (s.climb.s >= l.len - 0.7) {
        l.climbers.delete(s);
        s.climb = null;
        s.state = 'wall';
        s.zone = 'wall';
        s.pos.copy(l.top).addScaledVector(v.n, -1.9).addScaledVector(v.t, (this.battle.rng() - 0.5) * 1.8);
        s.pos.y = CFG.walkY;
        this.battle.wallFighters[this.side].add(s);
        continue;
      }
      s.pos.copy(l.base).addScaledVector(l.dir, s.climb.s);
    }

    if (l.climbers.size < CFG.ladder.maxClimbers && !l.freeze) {
      // โล่ได้คิวก่อนหอก (เปิดทาง)
      const next = this.soldiers.find((s) => s.alive && s.state === 'waitBase' && s.utype === 'shield')
        || this.soldiers.find((s) => s.alive && s.state === 'waitBase');
      if (next) next.state = 'toLadder';
    }
    for (const s of this.soldiers) {
      if (!s.alive || s.state !== 'toLadder') continue;
      _v.copy(l.base).addScaledVector(v.n, 0.9);
      if (this.stepUnit(s, dt, _v, s.speed, 0.7)) {
        if (l.climbers.size < CFG.ladder.maxClimbers && !l.broken) {
          s.state = 'climb';
          s.climb = { ladder: l, s: 0.5 };
          l.climbers.add(s);
        }
      }
    }

    // ไม่เหลือใครข้างล่างแล้ว (อยู่บนกำแพง ลงบันได หรือเข้าเมืองไปแล้ว) → กองกลับมารับคำสั่งได้
    if (this.soldiers.every((s) => !s.alive || s.zone !== 'field')) this.state = 'done';
  }

  onLadderBroken() {
    const l = this.ladder;
    l.broken = true;
    l.planted = false;
    for (const s of [...l.climbers]) if (s.alive) s.die();
    l.climbers.clear();
    // บันไดหักกระทบเฉพาะคนที่รออยู่ข้างล่าง — คนบนกำแพงห้ามถูกดึงกลับมาต่อคิวบันได (จะค้างบนกำแพง)
    for (const s of this.groundSoldiers()) {
      s.state = 'idle';
      s.gatherPos = worldPoint(this.side, this.plantT + (this.battle.rng() - 0.5) * 10, CFG.wallHalf + CFG.wallThick + 8, 0);
    }
    this.state = 'replanting';
    this.stateT = 0;
  }

  onRamDestroyed() {
    this.ramHp = 0;
    if (this.ramMesh) { this.battle.group.remove(this.ramMesh); this.ramMesh = null; }
    this.gateCrew = false;
    this.ramSource = null;
    this.mode = 'hold';
    this.state = 'hold';
    this.dest = this.spawnBase.clone();
    for (const s of this.aliveSoldiers) {
      s.state = 'march';
      s.gatherPos = this.spawnBase.clone().addScaledVector(SIDE_VECS[this.side].t, (this.battle.rng() - 0.5) * 8);
    }
    this.battle.onEvent('ram_lost', {});
  }

  destroyRamMesh() {
    if (this.ramMesh) { this.battle.group.remove(this.ramMesh); this.ramMesh = null; }
  }
}
