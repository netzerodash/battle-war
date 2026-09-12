import * as THREE from 'three';
import { CFG } from './config.js';
import { worldPoint, sectionCenter, gateFrontPoint, gateInsidePoint, gateRoute, isInsideCity, clampFieldPoint, SIDE_VECS } from './world.js';
import { Soldier } from './soldier.js';
import { makeLadder, makeRamMesh } from './models.js';

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();

// กองร้อยหนึ่งหน่วย — มี 4 ประเภท: spear(หอกปีน) / shield(โล่กำบัง) / archer(ธนูกดกำแพง) / ram(รถทุบประตู) + cav
export class Company {
  constructor(idx, side, ctype, spawnAnchor, battle) {
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
    this.volleyPos = null;

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
        hp: stat.hp, speed: stat.speed, atkCd: stat.atkCd, dmg: stat.dmg,
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
  get isLadderCarrier() { return this.ctype === 'spear' || this.ctype === 'shield'; }

  orderable() {
    if (this.aliveSoldiers.length === 0) return false;
    if (this.ctype === 'cav' || this.ctype === 'archer' || this.ctype === 'ram') return true;
    // 'done' = กองที่เหลือทหารกระจัดกระจาย (เช่น บุกแล้วเหลือโคจรกลับ) — สั่งใหม่ได้
    return ['idle', 'hold', 'march', 'done'].includes(this.state);
  }

  // ---------- คำสั่ง ----------
  orderAssault(assaultSide) {
    if (!this.orderable()) return false;
    this.side = assaultSide;
    this.mode = 'assault';

    if (this.ctype === 'archer') {
      // นักธนู: เข้าประจำตำแหน่งยิงที่ระยะพอดี
      this.plantT = this.battle.assignPlantSlot(assaultSide, 'archer');
      this.volleyPos = worldPoint(assaultSide, this.plantT * 0.9, CFG.unit.atkArch.standDist, 0);
      this.dest = this.volleyPos;
      this.state = 'march';
      this.stateT = 0;
      for (const s of this.aliveSoldiers) { s.state = 'march'; s.zone = 'field'; }
      return true;
    }

    if (this.ctype === 'ram') {
      // รถทุบ: มุ่งหน้าสู่ประตูเมืองเสมอ
      this.state = 'march';
      this.stateT = 0;
      this.dest = gateFrontPoint().addScaledVector(SIDE_VECS[2].n, -1.5);
      for (const s of this.aliveSoldiers) { s.state = 'march'; s.zone = 'field'; }
      return true;
    }

    // หอก / โล่ — แบกบันไดเข้าโจมตี
    this.plantT = this.battle.assignPlantSlot(assaultSide, 'ladder');
    if (!this.ladder) this.buildLadder(assaultSide, this.plantT);
    else { this.ladder.side = assaultSide; this.resetLadderTo(assaultSide, this.plantT); }
    this.dest = worldPoint(assaultSide, this.plantT, CFG.wallHalf + CFG.wallThick + CFG.ladder.baseDist + 1.8, 0);
    this.state = 'march';
    this.stateT = 0;
    for (const s of this.aliveSoldiers) { s.state = 'march'; s.zone = 'field'; }
    if (this.ladder && !this.ladder.planted) this.ladder.mesh.visible = true;
    return true;
  }

  buildLadder(assaultSide, plantT) {
    const base = worldPoint(assaultSide, plantT, CFG.wallHalf + CFG.wallThick + CFG.ladder.baseDist, 0);
    const top = worldPoint(assaultSide, plantT, CFG.wallHalf + CFG.wallThick - 0.4, CFG.walkY);
    const len = base.distanceTo(top) + 0.5;
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
    l.base.copy(worldPoint(assaultSide, plantT, CFG.wallHalf + CFG.wallThick + CFG.ladder.baseDist, 0));
    l.top.copy(worldPoint(assaultSide, plantT, CFG.wallHalf + CFG.wallThick - 0.4, CFG.walkY));
    l.dir.copy(l.top).sub(l.base).normalize();
    l.planted = false; l.broken = false;
  }

  orderHold(point) {
    if (!this.orderable()) return false;
    this.mode = 'hold';
    this.state = 'march';
    this.stateT = 0;
    this.dest = clampFieldPoint(point.clone());
    for (const s of this.aliveSoldiers) { s.state = 'march'; s.zone = 'field'; }
    if (this.ladder && this.ladder.planted) { this.ladder.planted = false; this.ladder.mesh.visible = false; }
    return true;
  }

  // กองม้า: ขี่ไปจุดหมาย (เส้นทางเข้าเมืองต้องผ่านประตู)
  orderRide(point) {
    if (this.ctype !== 'cav' || this.aliveSoldiers.length === 0) return false;
    this.mode = 'ride';
    const target = point.clone();
    if (isInsideCity(target) && !this.battle.gate.open) {
      this.pendingCityTarget = target.clone();
      this.waitingGate = true;
      target.copy(gateFrontPoint());
      this.battle.onEvent('cav_wait_gate', {});
    } else if (isInsideCity(target)) {
      this.enteredCity = true;
      this.pendingCityTarget = null;
      this.waitingGate = false;
    }
    this.buildRideRoute(target);
    this.state = 'ride';
    this.stateT = 0;
    return true;
  }

  // ทหารราบเดินเข้าเมืองผ่านประตู (ได้เมื่อประตูเปิดแล้วเท่านั้น)
  orderCity(point) {
    if (this.kind !== 'inf' || this.ctype === 'ram' || this.ctype === 'archer') return false;
    if (!this.battle.gate.open || !this.orderable() || this.aliveSoldiers.length === 0) return false;
    this.mode = 'city';
    this.enteredCity = false;
    this.waypoints = [...gateRoute(this.side, this.anchor), gateFrontPoint(), gateInsidePoint(), point.clone()];
    this.state = 'cityMarch';
    this.stateT = 0;
    for (const s of this.aliveSoldiers) { s.state = 'march'; s.zone = 'field'; }
    if (this.ladder && this.ladder.planted) { this.ladder.planted = false; this.ladder.mesh.visible = false; }
    return true;
  }

  buildRideRoute(target) {
    const inside = isInsideCity(target);
    if (inside && !this.enteredCity) {
      this.waypoints = [...gateRoute(this.side, this.anchor), gateFrontPoint(), gateInsidePoint(), target];
    } else if (inside) {
      this.waypoints = [target];
    } else {
      this.waypoints = [clampFieldPoint(target)];
      if (this.enteredCity) {
        // ออกจากเมืองผ่านประตูก่อน
        this.waypoints.unshift(gateInsidePoint(), gateFrontPoint());
        this.enteredCity = false;
      }
    }
  }

  // ---------- อัปเดตรายเฟรม ----------
  update(dt) {
    this.stateT += dt;
    const alive = this.aliveSoldiers;
    if (alive.length === 0) { this.state = 'dead'; return; }
    const v = SIDE_VECS[this.side];

    switch (this.state) {
      case 'idle':
      case 'holdAt':
        break;

      case 'march': {
        _v.subVectors(this.dest, this.anchor); _v.y = 0;
        const d = _v.length();
        const spd = this.ctype === 'ram' ? CFG.unit.ram.speed : 2.6;
        if (d > 0.4) this.anchor.addScaledVector(_v.normalize(), Math.min(d, spd * dt));
        this.followSlots(dt, alive);

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
          if (this.mode === 'assault') {
            if (this.ctype === 'archer') { this.state = 'volley'; }
            else if (this.ctype === 'ram') { this.state = 'battering'; this.stateT = 0; this.battle.onEvent('ram_ready', {}); }
            else { this.state = 'planting'; this.stateT = 0; this.gatherTargets(); }
          } else { this.state = 'hold'; }
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
          if (s.state === 'march' || s.state === 'idle') {
            s.stepToward(dt, s.gatherPos, s.speed, 0.4);
            if (!s.moving) s.facePoint(this.ladder ? this.ladder.base : this.anchor, dt);
          }
        }
        if (this.stateT >= CFG.ladder.plantTime) this.plantLadder();
        break;
      }

      case 'climbing': this.updateClimbing(dt); break;

      case 'replanting': {
        for (const s of alive) if (s.gatherPos) s.stepToward(dt, s.gatherPos, s.speed, 0.5);
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
          if (s.gatherPos) s.stepToward(dt, s.gatherPos, s.speed, 0.4);
          s.facePoint(sectionCenter(this.side), dt);
        }
        break;
      }

      case 'ride': {
        let done = true;
        for (const s of alive) {
          const wp = this.waypoints && this.waypoints.length ? this.waypoints[0] : this.dest;
          if (!wp) break;
          if (!s.stepToward(dt, wp, CFG.unit.cav.speed, 2.2)) done = false;
          if (isInsideCity(s.pos)) {
            if (s.zone === 'field') s.zone = 'city';
            if (!this.enteredCity) { this.enteredCity = true; this.battle.onEvent('cav_enter', {}); }
          } else if (s.zone === 'city') {
            s.zone = 'field';
          }
        }
        if (this.waypoints && this.waypoints.length && this.anchorCloseTo(this.waypoints[0])) {
          this.waypoints.shift();
          if (this.waypoints.length === 0) { this.state = 'holdAt'; this.dest = null; }
        }
        if (done && (!this.waypoints || this.waypoints.length <= 1)) this.state = 'holdAt';
        break;
      }

      case 'holdAt': {
        if (this.waypoints && this.waypoints.length === 0) this.waypoints = null;
        break;
      }

      case 'cityMarch': {
        // ราบเดินเข้าเมืองผ่านประตู (เปิดแล้ว) — เข้าไปแล้วกลายเป็นนักรบในเมือง
        let done = true;
        for (const s of alive) {
          const wp = this.waypoints && this.waypoints.length ? this.waypoints[0] : this.dest;
          if (!wp) break;
          if (!s.stepToward(dt, wp, s.speed, 0.8)) done = false;
          if (isInsideCity(s.pos)) {
            if (s.zone === 'field') { s.zone = 'city'; this.battle.onInfEnteredCity(s); }
          } else if (s.zone === 'city') {
            s.zone = 'field';
            this.battle.onInfLeftCity(s);
          }
        }
        if (this.waypoints && this.waypoints.length && this.anchorCloseTo(this.waypoints[0])) {
          this.waypoints.shift();
          if (this.waypoints.length === 0) { this.state = 'holdAt'; this.dest = null; }
        }
        if (done && (!this.waypoints || this.waypoints.length <= 1)) this.state = 'holdAt';
        break;
      }
    }
  }

  anchorCloseTo(p) { return this.anchor.distanceTo(p) < 3.5; }

  followSlots(dt, alive) {
    const v = SIDE_VECS[this.side];
    const sp = this.kind === 'cav' ? 2.6 : this.ctype === 'ram' ? 2.2 : 1.5;
    for (let i = 0; i < alive.length; i++) {
      const s = alive[i];
      const col = (i % 5) - 2, row = Math.floor(i / 5);
      _v.copy(this.anchor)
        .addScaledVector(v.t, col * sp)
        .addScaledVector(v.n, row * sp);
      s.stepToward(dt, _v, s.speed, 0.6);
      if (s.zone === 'field') s.pos.y = 0;
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
    for (const s of this.aliveSoldiers) if (s.state !== 'wall') s.state = 'waitBase';
    this.state = 'climbing';
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
      if (s.stepToward(dt, _v, s.speed, 0.7)) {
        if (l.climbers.size < CFG.ladder.maxClimbers && !l.broken) {
          s.state = 'climb';
          s.climb = { ladder: l, s: 0.5 };
          l.climbers.add(s);
        }
      }
    }

    if (this.soldiers.every((s) => !s.alive || s.state === 'wall')) this.state = 'done';
  }

  onLadderBroken() {
    const l = this.ladder;
    l.broken = true;
    l.planted = false;
    for (const s of [...l.climbers]) if (s.alive) s.die();
    l.climbers.clear();
    for (const s of this.aliveSoldiers) {
      s.state = 'idle';
      s.gatherPos = worldPoint(this.side, this.plantT + (this.battle.rng() - 0.5) * 10, CFG.wallHalf + CFG.wallThick + 8, 0);
    }
    this.state = 'replanting';
    this.stateT = 0;
  }

  onRamDestroyed() {
    this.ramHp = 0;
    if (this.ramMesh) { this.battle.group.remove(this.ramMesh); this.ramMesh = null; }
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
