import * as THREE from 'three';
import { CFG } from './config.js';
import { worldPoint, sectionCenter, stairPoints, SIDE_VECS } from './world.js';
import { Soldier } from './soldier.js';
import { rockGeo, rockMat } from './models.js';
import { sfx } from './audio.js';

const CORNER_BETWEEN = {
  '0-1': [42, -42], '1-2': [42, 42], '2-3': [-42, 42], '0-3': [-42, -42],
};
function cornerBetween(a, b) {
  const key = Math.min(a, b) + '-' + Math.max(a, b);
  const [x, z] = CORNER_BETWEEN[key];
  return new THREE.Vector3(x, CFG.walkY, z);
}

// ฝ่ายรับประจำกำแพงด้านเดียว + โลจิสติกส์หิน + AI ผู้บัญชาการ
export class DefenseSide {
  constructor(side, cfg, battle) {
    this.side = side;
    this.cfg = cfg;
    this.battle = battle;
    this.melee = [];
    this.archers = [];
    this.detachedTo = null;
    this.detachCd = 0;
    this.brainT = Math.random() * 0.5;

    // โลจิสติกส์หิน: กองบนกำแพง (roller ใช้จากนี้) + คลังในเมือง (พลขนหินแบกขึ้นมา)
    this.rock = { pile: CFG.rockLogi.pileStart, stock: CFG.rockLogi.stock };
    this.carriers = [];
    for (let i = 0; i < CFG.rockLogi.carriers; i++) this.spawnCarrier(true);

    this.roller = { phase: 'pause', timer: 2 + battle.rng() * 3, burstLeft: 0, target: null, visual: null };
    this.roller.visual = new THREE.Mesh(rockGeo, rockMat);
    this.roller.visual.visible = false;
    this.roller.visual.castShadow = true;
    battle.group.add(this.roller.visual);

    for (let i = 0; i < cfg.melee; i++) {
      const t = -33 + (i + 0.5) * (66 / cfg.melee);
      this.melee.push(this.makeSoldier('def', CFG.defender, worldPoint(side, t, 45.9, CFG.walkY)));
    }
    for (let i = 0; i < cfg.archers; i++) {
      const t = -35 + (i + 0.5) * (70 / cfg.archers);
      const s = this.makeSoldier('archer', { hp: CFG.archerStat.hp, dmg: CFG.archerStat.dmg, atkCd: CFG.archerStat.atkCd }, worldPoint(side, t, 44.7, CFG.walkY));
      s.cd = cfg.archerCd * (0.5 + battle.rng());
      this.archers.push(s);
    }
  }

  makeSoldier(type, stat, post, utype = type) {
    const s = new Soldier({
      type, faction: 'def', side: -1, utype,
      hp: stat.hp, speed: CFG.defender.speed, atkCd: stat.atkCd, dmg: stat.dmg,
    });
    s.homePost = post.clone();
    s.pos.copy(post);
    s.state = 'post';
    s.zone = 'wall';
    this.battle.group.add(s.mesh);
    s.syncMesh(0);
    return s;
  }

  aliveMelee() { return this.melee.filter((s) => s.alive).length; }
  aliveCount() { return this.aliveMelee() + this.archers.filter((s) => s.alive).length; }

  addReinforcement(s) {
    s.zone = 'wall';
    s.state = 'post';
    s.homePost = sectionCenter(this.side)
      .addScaledVector(SIDE_VECS[this.side].t, this.battle.rng() * 20 - 10)
      .addScaledVector(SIDE_VECS[this.side].n, this.battle.rng() * 2 - 1);
    s.orderTarget = null;
    this.melee.push(s);
  }

  // ---------- พลขนหิน ----------
  spawnCarrier(initial = false) {
    const s = new Soldier({
      type: 'carrier', faction: 'def', side: -1, utype: 'carrier',
      hp: CFG.defender.hp, speed: CFG.defender.speed * 1.05, atkCd: CFG.defender.atkCd, dmg: 1,
    });
    s.zone = 'city';
    s.state = 'order';
    s.pos.copy(this.stockPoint());
    this.battle.group.add(s.mesh);
    s.syncMesh(0);
    const c = { s, state: initial ? 'toStock' : 'respawn', t: initial ? 0 : 10 };
    this.carriers.push(c);
    return c;
  }

  stockPoint() { return worldPoint(this.side, 0, 28, 0); }
  pilePoint() { return worldPoint(this.side, 2.5, 44.5, CFG.walkY); }

  updateCarriers(dt) {
    const L = CFG.rockLogi;
    for (const c of this.carriers) {
      if (!c.s.alive) { c.state = 'respawn'; c.t = 10; continue; }
      if (c.state === 'respawn') {
        c.t -= dt;
        if (c.t <= 0) {
          // เปลี่ยนตัวใหม่ (กำลังคนเมืองยังเหลืออยู่) — แต่ถ้าคลังหมดก็ไม่มีอะไรจะขน
          c.s = new Soldier({
            type: 'carrier', faction: 'def', side: -1, utype: 'carrier',
            hp: CFG.defender.hp, speed: CFG.defender.speed * 1.05, atkCd: CFG.defender.atkCd, dmg: 1,
          });
          c.s.zone = 'city';
          c.s.state = 'order';
          c.s.pos.copy(this.stockPoint());
          this.battle.group.add(c.s.mesh);
          c.s.syncMesh(0);
          c.state = 'toStock';
        }
        continue;
      }
      if (c.s.stair) continue; // บันไดคุมตำแหน่งอยู่
      const s = c.s;
      switch (c.state) {
        case 'toStock': {
          if (this.rock.stock <= 0) { s.state = 'idle'; break; } // คลังหมด — ยืนรอ
          s.state = 'order';
          if (s.stepToward(dt, this.stockPoint(), s.speed, 0.7)) {
            this.rock.stock--; c.state = 'toStair';
          }
          break;
        }
        case 'toStair': {
          s.state = 'order';
          if (s.stepToward(dt, stairPoints(this.side).base, s.speed, 0.8)) {
            this.battle.stairs[this.side].requestUp(s);
            c.state = 'ascend';
          }
          break;
        }
        case 'ascend': break; // รอ channel ยกขึ้น → callback พาไป dump
        case 'dump': {
          s.state = 'order';
          s.facePoint(sectionCenter(this.side), dt);
          c.t -= dt;
          if (c.t <= 0) {
            this.battle.stairs[this.side].requestDown(s);
            c.state = 'descend';
          }
          break;
        }
        case 'descend': break;
        case 'return': {
          s.state = 'order';
          if (s.stepToward(dt, this.stockPoint(), s.speed, 0.8)) c.state = 'toStock';
          break;
        }
      }
    }
    this.carriers = this.carriers.filter((c) => c.s.alive || c.state === 'respawn');
  }

  // callback จาก stair channel เมื่อพลขนหินขึ้นถึงยอด
  carrierArrivedTop(c) {
    this.rock.pile = Math.min(CFG.rockLogi.pileMax, this.rock.pile + CFG.rockLogi.carryAmount);
    c.state = 'dump';
    c.t = 0.6;
    c.s.orderTarget = this.pilePoint();
  }

  carrierArrivedBottom(c) {
    c.state = 'return';
  }

  // ---------- เครื่องกลิ้งหิน (ใช้กองหินบนกำแพง — หมดเมื่อไหร่เงียบเมื่อนั้น) ----------
  ladders() {
    return this.battle.laddersOf(this.side).filter((l) => l.planted && !l.broken);
  }

  updateRoller(dt) {
    const R = this.roller;
    const ram = this.battle.ramUnderGate();
    let candidates = [];
    let target = null, targetIsRam = false;

    if (ram && this.side === 2) { target = ram; targetIsRam = true; }
    else {
      candidates = this.ladders().filter((l) => l.climbers.size > 0);
      if (candidates.length) target = candidates.reduce((a, b) => (a.climbers.size >= b.climbers.size ? a : b));
    }

    if (!target || this.rock.pile <= 0) {
      R.visual.visible = false;
      R.target = null;
      R.targetIsRam = false;
      if (R.phase !== 'pause') { R.phase = 'pause'; R.timer = 1.2; }
      R.timer = Math.min(R.timer, 2.0);
      return;
    }

    R.timer -= dt;
    if (R.phase === 'pause') {
      if (R.timer <= 0) {
        R.target = target; R.targetIsRam = targetIsRam;
        R.burstLeft = targetIsRam ? this.cfg.pattern.burst : this.cfg.pattern.burst;
        R.phase = 'telegraph';
        R.timer = CFG.rock.telegraph;
        R.visual.visible = true;
      }
    } else if (R.phase === 'telegraph') {
      if (target) {
        if (!targetIsRam) target.freeze = true;
        R.visual.visible = true;
        if (targetIsRam && ram) {
          const rp = ram.flagPos || ram.anchor;
          R.visual.position.copy(rp).setY(CFG.wallH + 6);
        } else if (target.top) {
          R.visual.position.copy(target.top).addScaledVector(target.dir, 0.3);
          R.visual.position.x += (this.battle.rng() - 0.5) * 0.15;
          R.visual.position.z += (this.battle.rng() - 0.5) * 0.15;
        }
        R.visual.rotation.set(this.battle.time * 3, this.battle.time * 2, 0);
      }
      if (R.timer <= 0) {
        R.visual.visible = false;
        if (this.rock.pile > 0 && target) {
          if (targetIsRam && ram) this.battle.dropRockOnRam(ram);
          else if (!targetIsRam && target.climbers && target.climbers.size > 0) this.battle.spawnRock(target);
          this.rock.pile--;
          this.battle.stats.rocksUsed++;
          R.burstLeft--;
        }
        if (R.burstLeft > 0 && this.rock.pile > 0) {
          R.phase = 'gap'; R.timer = this.cfg.pattern.rollGap;
        } else {
          R.phase = 'pause';
          R.timer = this.cfg.pattern.pause * (0.85 + this.battle.rng() * 0.3);
        }
      }
    } else if (R.phase === 'gap') {
      if (R.timer <= 0) { R.phase = 'telegraph'; R.timer = CFG.rock.telegraph; }
    }
  }

  updateArchers(dt) {
    for (const a of this.archers) {
      if (!a.alive) continue;
      a.cd -= dt;
      if (a.cd > 0) continue;
      const target = this.pickArrowTarget(a);
      if (!target) continue;
      a.cd = this.cfg.archerCd * (0.8 + this.battle.rng() * 0.4);
      a.facePoint(target.pos, dt);
      this.battle.fireArrow(a, target, 'def');
      sfx.whoosh();
    }
  }

  // เลือกเป้า: ดวลนักธนูฝ่ายบุกที่ยิงใส่เรา > กองหลอกล่อ > ทหารที่เข้าใกล้
  pickArrowTarget(a) {
    let duel = null, duelD = Infinity;
    let feint = null, feintD = Infinity;
    let near = null, nearD = Infinity;
    for (const s of this.battle.groundAttackers()) {
      const d = a.pos.distanceTo(s.pos);
      if (d > CFG.archerRange) continue;
      if (s.utype === 'atkArch') { if (d < duelD) { duel = s; duelD = d; } }
      else if (s.state === 'hold') { if (d < feintD) { feint = s; feintD = d; } }
      else if (s.utype !== 'shield') { if (d < nearD) { near = s; nearD = d; } }
    }
    if (duel) return duel;
    if (feint) return feint;
    if (near) return near;
    // โล่เป็นเป้าสุดท้าย (กันธนูได้ ยิงเปล่าเปลือง)
    let sh = null, shD = Infinity;
    for (const s of this.battle.groundAttackers()) {
      if (s.utype !== 'shield') continue;
      const d = a.pos.distanceTo(s.pos);
      if (d < CFG.archerRange && d < shD) { sh = s; shD = d; }
    }
    return sh;
  }

  // ---------- AI ผู้บัญชาการ: สนับสนุนกำแพงเพื่อนบ้านเมื่อตัวเองสงบ ----------
  updateBrain(dt) {
    this.brainT -= dt;
    this.detachCd -= dt;
    if (this.brainT > 0) return;
    this.brainT = 0.5;
    const B = this.battle;

    if (this.detachedTo !== null) {
      const heat = B.feintHeat[this.detachedTo];
      const enemyOnTarget = B.wallFighters[this.detachedTo].size;
      const homeFight = B.wallFighters[this.side].size;
      if ((enemyOnTarget === 0 && heat <= 0.01) || homeFight >= 3) {
        for (const s of this.melee) {
          if (s.alive && s.detached) {
            s.detached = false;
            s.waypoints = [cornerBetween(this.side, this.detachedTo), s.homePost.clone()];
            s.state = 'order';
          }
        }
        this.detachedTo = null;
        this.detachCd = CFG.ai.detachCooldown;
      }
      return;
    }

    if (this.detachCd > 0 || B.wallFighters[this.side].size > 2) return;
    // ด้านข้างที่โดนกดหนัก (ผู้บุกบนกำแพงเยอะ หรือถูกหลอกล่อนาน)
    const adj = [(this.side + 1) % 4, (this.side + 3) % 4];
    let tgt = null, worst = 0;
    for (const a of adj) {
      if (B.captured[a]) continue;
      const pressure = Math.max(B.wallFighters[a].size, B.feintHeat[a] > 5 ? CFG.ai.detachThreat : 0);
      const needHelp = pressure >= CFG.ai.detachThreat || (B.feintHeat[a] > 5 && B.defenses[a].aliveMelee() < CFG.wallMelee * 0.75);
      if (needHelp && pressure > worst) { worst = pressure; tgt = a; }
    }
    if (tgt !== null) {
      const alive = this.melee.filter((s) => s.alive && !s.detached);
      const send = alive.slice(0, CFG.ai.detachMax);
      for (const s of send) {
        s.detached = true;
        s.waypoints = [cornerBetween(this.side, tgt), sectionCenter(tgt).clone()];
        s.state = 'order';
      }
      this.detachedTo = tgt;
      if (send.length) B.onEvent('support_march', { from: this.side, to: tgt, n: send.length });
    }
  }

  update(dt) {
    this.updateRoller(dt);
    this.updateArchers(dt);
    this.updateCarriers(dt);
    this.updateBrain(dt);
  }

  ladders() {
    return this.battle.laddersOf(this.side).filter((l) => l.planted && !l.broken);
  }
}

// กองสำรองของเมือง — ยืนเป็นกองบนลานใน ไปเสริมกำแพงที่บาง / ยามรุมผู้บุกที่ลงมา
export class ReserveForce {
  constructor(battle) {
    this.battle = battle;
    this.squads = [];
    this.dispatchTimer = 3;
    for (let i = 0; i < CFG.reserveSquads; i++) {
      const px = -35 + (i % 20) * 3.5, pz = 5 + Math.floor(i / 20) * 3;
      const soldiers = [];
      for (let k = 0; k < CFG.squadSize; k++) {
        const s = new Soldier({
          type: 'def', faction: 'def', side: -1, utype: 'def',
          hp: CFG.defender.hp, speed: CFG.defender.speed, atkCd: CFG.defender.atkCd, dmg: CFG.defender.dmg,
        });
        s.zone = 'city';
        s.state = 'idle';
        s.pos.set(px + (k % 2) * 1.4 - 0.7, 0, pz + Math.floor(k / 2) * 1.4);
        s.homePost = s.pos.clone();
        this.battle.group.add(s.mesh);
        s.syncMesh(0);
        soldiers.push(s);
      }
      this.squads.push({ soldiers, state: 'idle', side: -1 });
    }
  }

  allSoldiers() {
    const out = [];
    for (const sq of this.squads) for (const s of sq.soldiers) out.push(s);
    return out;
  }

  // ตัดทหารออกจากกองสำรองเมื่อขึ้นกำแพงแล้ว (กันนับซ้ำสองที่)
  releaseSoldier(s) {
    for (const sq of this.squads) {
      const i = sq.soldiers.indexOf(s);
      if (i >= 0) {
        sq.soldiers.splice(i, 1);
        if (sq.soldiers.length === 0) sq.state = 'done';
        return true;
      }
    }
    return false;
  }

  aliveCount() {
    let n = 0;
    for (const sq of this.squads) for (const s of sq.soldiers) if (s.alive) n++;
    return n;
  }

  // กำลังเสริมที่กำลังเดินทาง/ขึ้นบันได (โชว์ใน HUD — ปัจจัยเวลาที่ชัดเจน)
  enRouteMen() {
    let n = 0;
    for (const sq of this.squads) {
      if (sq.state === 'toStair' || sq.state === 'ascending') {
        for (const s of sq.soldiers) if (s.alive) n++;
      }
    }
    return n;
  }

  update(dt) {
    this.dispatchTimer -= dt;
    if (this.dispatchTimer <= 0) {
      this.dispatchTimer = CFG.ai.reinforceInterval;
      this.dispatch();
    }
    for (const sq of this.squads) {
      if (!sq.soldiers.some((s) => s.alive)) { sq.state = 'done'; continue; }
      this.updateSquad(sq);
    }
  }

  dispatch() {
    const B = this.battle;
    const needs = [];
    for (let s = 0; s < 4; s++) {
      if (B.captured[s]) continue;
      const alive = B.defenses[s].aliveMelee();
      if (alive < CFG.wallMelee * CFG.ai.reinforceThreshold && alive > CFG.wallMelee * CFG.ai.minReinforceAlive) needs.push(s);
    }
    let sent = 0;
    for (const side of needs) {
      for (const sq of this.squads) {
        if (sent >= CFG.ai.reinforceSquads) break;
        if (sq.state === 'idle') { sq.state = 'toStair'; sq.side = side; sent++; }
      }
    }
    if (B.invadersInCity() >= 3) {
      for (const sq of this.squads) {
        if (sq.state !== 'idle') continue;
        if (B.nearestInvader(sq.soldiers[0].pos, 30)) sq.state = 'guard';
      }
    }
  }

  updateSquad(sq) {
    const B = this.battle;
    if (sq.state === 'ascending') {
      if (sq.soldiers.every((s) => !s.alive || (s.zone === 'wall' && s.state === 'post'))) sq.state = 'done';
      return;
    }
    let target = null;
    if (sq.state === 'toStair') target = stairPoints(sq.side).base;
    else if (sq.state === 'guard') {
      const post = sq.soldiers.find((s) => s.alive).homePost;
      const inv = B.nearestInvader(post, 24);
      if (inv) target = inv.pos;
      else sq.state = 'idle';
    }
    for (const s of sq.soldiers) {
      if (!s.alive || s.inCombat || s.stair) continue;
      s.orderTarget = target;
      s.state = target ? 'order' : 'idle';
    }
    if (sq.state === 'toStair') {
      const sp = stairPoints(sq.side);
      const ready = sq.soldiers.filter((s) => s.alive && !s.stair && s.pos.distanceTo(sp.base) < 1.6);
      if (ready.length === sq.soldiers.filter((s) => s.alive).length) {
        sq.state = 'ascending';
        for (const s of ready) B.stairs[sq.side].requestUp(s);
      }
    }
  }
}
