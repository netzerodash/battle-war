import * as THREE from 'three';
import { CFG } from './config.js';
import { worldPoint, sectionCenter, stairPoints, SIDE_VECS, gateFrontPoint, gateInsidePoint, regionOf, GROUND_ZONES } from './world.js';
import { Soldier } from './soldier.js';
import { rockGeo, rockMat } from './models.js';
import { sfx } from './audio.js';

function cornerBetween(a, b) {
  const c = CFG.wallHalf + 2;
  const signs = { '0-1': [1, -1], '1-2': [1, 1], '2-3': [-1, 1], '0-3': [-1, -1] };
  const [sx, sz] = signs[Math.min(a, b) + '-' + Math.max(a, b)];
  return new THREE.Vector3(sx * c, CFG.walkY, sz * c);
}

// กระจายตำแหน่ง n จุดตามแนวกำแพงช่วง ±halfSpan โดยเว้นช่วงกลาง ±gap (ซุ้มประตู)
function spreadAlong(n, halfSpan, gap = 0) {
  if (gap <= 0) return Array.from({ length: n }, (_, i) => -halfSpan + (i + 0.5) * ((halfSpan * 2) / n));
  const perSide = Math.ceil(n / 2);
  const width = halfSpan - gap;
  const out = [];
  for (let i = 0; i < n; i++) {
    const sign = i % 2 ? 1 : -1;
    const k = Math.floor(i / 2);
    out.push(sign * (gap + (k + 0.5) * (width / perSide)));
  }
  return out;
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
    this.brainT = battle.rng() * 0.5;
    this.suppressedT = 0; // 🔥 ห่าธนูไฟ: ระหว่างนี้หยุดยิงธนู/กลิ้งหิน (กองหิน/ผู้บัญชาการยังทำงานปกติ)

    // โลจิสติกส์หิน: กองบนกำแพง (roller ใช้จากนี้) + คลังในเมือง (พลขนหินแบกขึ้นมา)
    this.rock = { pile: CFG.rockLogi.pileStart, stock: CFG.rockLogi.stock };
    this.carriers = [];
    for (let i = 0; i < CFG.rockLogi.carriers; i++) this.spawnCarrier(true);

    this.roller = { phase: 'pause', timer: 2 + battle.rng() * 3, burstLeft: 0, target: null, visual: null };
    this.roller.visual = new THREE.Mesh(rockGeo, rockMat);
    this.roller.visual.visible = false;
    this.roller.visual.castShadow = true;
    battle.group.add(this.roller.visual);

    const meleePerRank = 40;
    const meleeSpan = CFG.wallHalf - 10;
    for (let i = 0; i < cfg.melee; i++) {
      const rank = Math.floor(i / meleePerRank);
      const indexInRank = i % meleePerRank;
      const rankCount = Math.min(meleePerRank, cfg.melee - rank * meleePerRank);
      const t = -meleeSpan + (indexInRank + 0.5) * ((meleeSpan * 2) / rankCount);
      this.melee.push(this.makeSoldier('def', CFG.defender, worldPoint(side, t, CFG.wallHalf + 5.9 - rank * 2.1, CFG.walkY)));
    }
    const archerSpan = CFG.wallHalf - 8;
    for (let i = 0; i < cfg.archers; i++) {
      const t = -archerSpan + (i + 0.5) * ((archerSpan * 2) / cfg.archers);
      const s = this.makeSoldier('archer', { hp: CFG.archerStat.hp, dmg: CFG.archerStat.dmg, atkCd: CFG.archerStat.atkCd }, worldPoint(side, t, CFG.wallHalf + 4.7, CFG.walkY));
      s.cd = cfg.archerCd * (0.5 + battle.rng());
      this.archers.push(s);
    }
  }

  makeSoldier(type, stat, post, utype = type) {
    const s = new Soldier({
      type, faction: 'def', side: -1, utype,
      hp: stat.hp, speed: CFG.defender.speed, atkCd: stat.atkCd, dmg: stat.dmg, rng: this.battle.rng,
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
  aliveCount() {
    return this.aliveMelee()
      + this.archers.filter((s) => s.alive).length
      + this.carriers.filter((c) => c.s.alive).length;
  }

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
    const slot = this.carriers.length;
    const s = new Soldier({
      type: 'carrier', faction: 'def', side: -1, utype: 'carrier',
      hp: CFG.defender.hp, speed: CFG.defender.speed * 1.05, atkCd: CFG.defender.atkCd, dmg: 1, rng: this.battle.rng,
    });
    s.zone = 'city';
    s.state = 'order';
    s.pos.copy(this.stockPoint(slot));
    this.battle.group.add(s.mesh);
    s.syncMesh(0);
    const c = { s, slot, state: initial ? 'waiting' : 'waiting', t: 0 };
    this.carriers.push(c);
    return c;
  }

  stockPoint(slot = 0) {
    // Keep the doubled logistics crew in one visible line beside the inner wall.
    // This also leaves the central courtyard free for the reserve formation.
    const lateral = (slot - (CFG.rockLogi.carriers - 1) / 2) * 1.8;
    // ถอยห่างกำแพงพ้นแนวบันไดขึ้นกำแพงที่เลียบหน้าในกำแพง (ไม่ยืนใต้ขั้นบันได)
    return worldPoint(this.side, lateral, CFG.wallHalf - 6.5, 0);
  }
  pilePoint() { return worldPoint(this.side, 22, CFG.wallHalf + 4, CFG.walkY); } // กองหินข้างชานพักบันได

  updateCarriers(dt) {
    const L = CFG.rockLogi;
    const active = this.carriers.filter((c) => c.s.alive && !['waiting'].includes(c.state)).length;
    if (this.rock.pile <= L.reorderAt && this.rock.stock > 0) {
      let dispatch = Math.max(0, Math.ceil((L.pileMax - this.rock.pile) / L.carryAmount) - active);
      for (const c of this.carriers) {
        if (dispatch <= 0) break;
        if (c.s.alive && c.state === 'waiting') { c.state = 'toStock'; c.s.intent = 'refill-rocks'; dispatch--; }
      }
    }
    for (const c of this.carriers) {
      if (!c.s.alive) continue;
      if (c.s.stair) continue; // บันไดคุมตำแหน่งอยู่
      const s = c.s;
      switch (c.state) {
        case 'waiting': {
          s.state = 'idle';
          s.intent = 'await-rock-request';
          break;
        }
        case 'toStock': {
          if (this.rock.stock <= 0) { c.state = 'waiting'; s.state = 'idle'; break; }
          s.state = 'order';
          if (s.stepToward(dt, this.stockPoint(c.slot), s.speed, 0.7)) {
            this.rock.stock = Math.max(0, this.rock.stock - L.carryAmount); c.state = 'toStair';
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
          if (s.stepToward(dt, this.stockPoint(c.slot), s.speed, 0.8)) { c.state = 'waiting'; s.intent = 'await-rock-request'; }
          break;
        }
      }
    }
    this.carriers = this.carriers.filter((c) => c.s.state !== 'dead');
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
      // ยังไม่รับคำสั่ง = อยู่นอกการปะทะ ธนูเมืองไม่เปิดฉากยิงถึงค่ายตั้งทัพ
      if (!s.company || s.company.mode === 'idle') continue;
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
      if (s.utype !== 'shield' || !s.company || s.company.mode === 'idle') continue;
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
    // สละกำแพงแล้ว — ห้ามสั่งกองที่ยกไปช่วยให้เดินกลับจุดเฝ้า (จะไปทับคำสั่งลงบันไดจนค้างบนกำแพง)
    if (this.evacuated) return;

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
    if (this.suppressedT > 0) this.suppressedT = Math.max(0, this.suppressedT - dt);
    else { this.updateRoller(dt); this.updateArchers(dt); }
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
    // ตั้งเป็นแถวรอบวงแหวนเมืองชั้นนอก ด้านละเท่า ๆ กัน (กลางเมืองคือเมืองชั้นในและวัง)
    const ring1Face = CFG.rings[1].half + CFG.rings[1].thick;
    const band = CFG.wallHalf - ring1Face;
    for (let i = 0; i < CFG.reserveSquads; i++) {
      const side = i % 4;
      const j = Math.floor(i / 4);
      const col = j % 10, row = Math.floor(j / 10);
      const tOff = (col - 4.5) * 5.4;
      const dist = ring1Face + band * 0.55 - row * 3.2;
      const origin = worldPoint(side, tOff, dist, 0);
      const { n, t } = SIDE_VECS[side];
      const soldiers = [];
      for (let k = 0; k < CFG.squadSize; k++) {
        const s = new Soldier({
          type: 'def', faction: 'def', side: -1, utype: 'def',
          hp: CFG.defender.hp, speed: CFG.defender.speed, atkCd: CFG.defender.atkCd, dmg: CFG.defender.dmg, rng: this.battle.rng,
        });
        s.zone = 'city';
        s.state = 'idle';
        s.pos.copy(origin)
          .addScaledVector(t, (k % 2) * 1.4 - 0.7)
          .addScaledVector(n, Math.floor(k / 2) * 1.4 - 0.7);
        s.yaw = Math.atan2(n.x, n.z);
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
  enRouteMen(side = null) {
    let n = 0;
    for (const sq of this.squads) {
      if (side !== null && sq.side !== side) continue;
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
      const attackers = [...B.wallFighters[s]].filter((u) => u.alive).length;
      const activeLadders = B.laddersOf(s).filter((l) => l.planted && !l.broken).length;
      const threat = attackers * 3 + activeLadders;
      if (threat > 0 && alive < CFG.wallMelee * CFG.ai.reinforceThreshold && alive > CFG.wallMelee * CFG.ai.minReinforceAlive) {
        needs.push({ side: s, threat });
      }
    }
    needs.sort((a, b) => b.threat - a.threat);
    let sent = 0;
    for (const need of needs) {
      for (const sq of this.squads) {
        if (sent >= CFG.ai.reinforceSquads) break;
        if (sq.state === 'idle') {
          sq.state = 'toStair'; sq.side = need.side; sq.intent = 'reinforce-threatened-wall'; sent++;
        }
      }
    }
    // ล่าผู้บุกที่หลงเหลือในเมืองชั้นนอก — จับคู่กองว่างงานให้คนใกล้ที่สุดก่อน (ตะกละแบบง่าย ไม่ต้อง optimal)
    // ไม่รอให้ครบ 3 คนเหมือนเดิม เพราะผู้บุกกลุ่มเล็กที่รอดมาถึงตรงนี้ต้องมีคนไล่ล่าด้วย ไม่งั้นจะไม่มีใครจบเกม
    const invaders = [...B.cityAttackers].filter((s) => s.alive && s.zone === 'city');
    if (invaders.length) {
      const idle = this.squads.filter((sq) => sq.state === 'idle' && sq.soldiers.some((s) => s.alive));
      for (const inv of invaders) {
        if (!idle.length) break;
        let bestI = 0, bestD = Infinity;
        for (let i = 0; i < idle.length; i++) {
          const d = idle[i].soldiers.find((s) => s.alive).pos.distanceToSquared(inv.pos);
          if (d < bestD) { bestD = d; bestI = i; }
        }
        idle[bestI].state = 'guard';
        idle.splice(bestI, 1);
      }
    }
  }

  updateSquad(sq) {
    const B = this.battle;
    if (sq.state === 'ascending') {
      if (sq.soldiers.every((s) => !s.alive || (s.zone === 'wall' && s.state === 'post'))) sq.state = 'done';
      return;
    }
    // กำแพงด้านนั้นเสียไประหว่างเดินไปบันได — ยกเลิก ไม่ขึ้นไปยืนค้างบนกำแพงที่ถูกยึดแล้ว
    if (sq.state === 'toStair' && B.captured[sq.side]) sq.state = 'idle';
    let target = null;
    if (sq.state === 'toStair') target = stairPoints(sq.side).base;
    else if (sq.state === 'guard') {
      // ไล่ต่อเนื่องจากตำแหน่งปัจจุบันของกอง ไม่ใช่จุดตั้งเดิม — เดิมยึดจาก homePost ที่อยู่กับที่
      // ทำให้กองที่ไล่ออกมาไกลแล้วเลิกไล่เอง ทั้งที่ตัวกองยังอยู่ใกล้เป้าหมายอยู่เลย
      const leader = sq.soldiers.find((s) => s.alive);
      const inv = B.nearestInvader(leader.pos, 45);
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

// ---------- ทหารรักษาเมืองชั้นในและวังต้องห้าม ----------
// ยืนตั้งรับอยู่ในชั้นของตัวเอง (ออกไปไหนไม่ได้จนกว่าประตูชั้นนั้นจะเปิด) — แนวโล่ปิดปากประตูด้านใน,
// ง้าวหนุนหลัง, ม้าองครักษ์พุ่งใส่ผู้บุกที่หลุดเข้ามา, และพลธนูบนสันกำแพงยิงลงใส่ผู้บุกทั้งสองฝั่งกำแพง
const GUARD_TYPES = {
  shield: { mesh: 'guardShield', utype: 'guardShield', stat: () => CFG.garrison.shield },
  spear: { mesh: 'guardSpear', utype: 'guardSpear', stat: () => CFG.garrison.spear },
  cav: { mesh: 'guardCav', utype: 'guardCav', kind: 'cav', stat: () => CFG.garrison.cav },
};

function nearestWithin(from, list, range) {
  let best = null, bestD = range;
  for (const t of list || []) {
    if (!t.alive) continue;
    const d = from.pos.distanceTo(t.pos);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

function centroidOf(list) {
  const c = new THREE.Vector3();
  for (const s of list) c.add(s.pos);
  return c.multiplyScalar(1 / list.length).setY(0);
}

export class Garrison {
  constructor(battle) {
    this.battle = battle;
    this.soldiers = [];
    this.archers = [];
    this.thinkT = 0;
    this.palacePostIndex = 0;
    this.deploy(1, 'inner', CFG.garrison.inner);
    this.deploy(2, 'palace', CFG.garrison.palace);
  }

  deploy(ring, zone, plan) {
    const R = CFG.rings[ring];
    const gateZ = R.half - 4.5;
    const shieldRows = Math.ceil(plan.shields / 12);
    for (let i = 0; i < plan.shields; i++) {
      const col = i % 12, row = Math.floor(i / 12);
      this.spawn('shield', zone, new THREE.Vector3((col - 5.5) * 1.5, 0, gateZ - row * 1.5));
    }
    const behind = Math.ceil(plan.spears / 2);
    const ringDepth = ring < CFG.rings.length - 1 ? (R.half + CFG.rings[ring + 1].half + CFG.rings[ring + 1].thick) / 2 : R.half * 0.72;
    for (let i = 0; i < plan.spears; i++) {
      if (i < behind) {
        const col = i % 12, row = Math.floor(i / 12);
        this.spawn('spear', zone, new THREE.Vector3((col - 5.5) * 1.5, 0, gateZ - shieldRows * 1.5 - 1.2 - row * 1.5));
      } else {
        // เฝ้าลานด้านอื่นของชั้น (เมืองชั้นใน: เหนือ/ตะวันออก/ตะวันตก · วัง: ตะวันออก/ตะวันตก ข้างตำหนัก)
        const j = i - behind;
        const sides = ring === CFG.rings.length - 1 ? [1, 3] : [0, 1, 3];
        const side = sides[j % sides.length];
        const k = Math.floor(j / sides.length);
        this.spawn('spear', zone, worldPoint(side, (k - 2) * 2.4, ringDepth, 0));
      }
    }
    for (let i = 0; i < plan.cav; i++) {
      const perRow = Math.min(12, plan.cav);
      const col = i % perRow, row = Math.floor(i / perRow);
      const pos = ring === CFG.rings.length - 1
        ? new THREE.Vector3((col - (perRow - 1) / 2) * 2.4, 0, 3 - row * 2.6)
        : worldPoint(0, (col - (perRow - 1) / 2) * 2.6, ringDepth - row * 2.6, 0);
      this.spawn('cav', zone, pos);
    }
    // พลธนูบนสันกำแพง (ด้านใต้เว้นซุ้มประตู)
    const wallZone = `wall${ring + 1}`;
    const mid = R.half + R.thick / 2;
    for (let side = 0; side < 4; side++) {
      const ts = spreadAlong(plan.archersPerSide, mid - 3, side === 2 ? CFG.innerGates.halfWidth + 5 : 0);
      for (const t of ts) {
        const s = new Soldier({
          type: 'guardArcher', faction: 'def', side: -1, utype: 'guardArcher',
          hp: CFG.garrison.archer.hp, speed: CFG.defender.speed, atkCd: CFG.garrison.archer.cd, dmg: CFG.garrison.archer.dmg, rng: this.battle.rng,
        });
        s.pos.copy(worldPoint(side, t, mid, R.h + 0.45));
        s.homePost = s.pos.clone();
        s.zone = wallZone;
        s.state = 'post';
        s.ring = ring;
        s.yaw = Math.atan2(SIDE_VECS[side].n.x, SIDE_VECS[side].n.z);
        s.cd = CFG.garrison.archer.cd * (0.3 + this.battle.rng());
        this.battle.group.add(s.mesh);
        s.syncMesh(0);
        this.archers.push(s);
      }
    }
  }

  spawn(type, zone, pos) {
    const def = GUARD_TYPES[type];
    const stat = def.stat();
    const s = new Soldier({
      type: def.mesh, faction: 'def', side: -1, kind: def.kind || 'inf', utype: def.utype,
      hp: stat.hp, speed: stat.speed, atkCd: stat.atkCd, dmg: stat.dmg, rng: this.battle.rng,
    });
    s.zone = zone;
    s.state = 'post';
    s.pos.copy(pos).setY(0);
    s.homePost = s.pos.clone();
    // แนวโล่ขยับชิดประตูเมื่อประตูถูกฟัน (ประตูทุกชั้นอยู่ทางใต้ = +z)
    if (type === 'shield') s.gatePost = s.pos.clone().setZ(s.pos.z + 2);
    s.yaw = 0; // หันหน้าลงใต้ เข้าหาประตู
    if (stat.detectRange) s.detectRange = stat.detectRange;
    if (s.kind === 'cav') s.chargeReady = true;
    this.battle.group.add(s.mesh);
    s.syncMesh(0);
    this.soldiers.push(s);
    return s;
  }

  allSoldiers() { return [...this.soldiers, ...this.archers]; }
  aliveCount() {
    let n = 0;
    for (const s of this.soldiers) if (s.alive) n++;
    for (const s of this.archers) if (s.alive) n++;
    return n;
  }
  shields() { return this.soldiers.filter((s) => s.alive && s.utype === 'guardShield'); }

  update(dt, targets) {
    const range = CFG.garrison.archer.range;
    for (const a of this.archers) {
      if (!a.alive) continue;
      a.cd -= dt;
      if (a.cd > 0) continue;
      // เล็งกลุ่มที่กำลังฟันประตูชั้นนี้ก่อน แล้วค่อยยิงผู้บุกคนอื่นที่อยู่ในระยะ
      const hackers = this.battle.innerGates?.[a.ring - 1]?.hackers;
      const best = nearestWithin(a, hackers, range) || nearestWithin(a, targets, range);
      if (!best) { a.cd = 0.4; continue; }
      a.cd = CFG.garrison.archer.cd * (0.8 + this.battle.rng() * 0.4);
      a.facePoint(best.pos, dt);
      this.battle.fireArrow(a, best, 'def');
      sfx.whoosh();
    }
    // ม้าองครักษ์ที่กลับถึงจุดตั้งหลักแล้วพร้อมพุ่งชาร์จอีกครั้ง
    for (const s of this.soldiers) {
      if (s.alive && s.kind === 'cav' && !s.inCombat && s.homePost && s.pos.distanceTo(s.homePost) < 3) s.chargeReady = true;
      // องครักษ์ที่ถอยเข้าวัง: ลอดประตูวังพ้นแนวกลางกำแพงแล้วนับเป็นทหารในลานวัง
      if (s.alive && s.relocating) {
        if (s.zone === 'inner' && regionOf(s.pos) === 3) s.zone = 'palace';
        if (s.zone === 'palace' && !(s.waypoints && s.waypoints.length)) s.relocating = false;
      }
    }
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = CFG.garrison.ai.thinkInterval;
      this.think();
    }
  }

  // ---------- สมององครักษ์ (เรียงตามความสำคัญ): ถอยช่วยวัง · ดักบันไดพาด · ตีสวน · ยันประตู · ประจำจุด ----------
  think() {
    const B = this.battle;
    const AI = CFG.garrison.ai;
    const intruders = { inner: [], palace: [] };
    for (const s of B.cityAttackers || []) if (s.alive && intruders[s.zone]) intruders[s.zone].push(s);
    const ladders = (B.companies || []).filter((c) => c.escalade?.planted && c.aliveSoldiers.length > 0).map((c) => c.escalade);
    const palaceThreat = (B.palace?.progress || 0) > 0 || intruders.palace.length > 0;
    const palaceGateOpen = !!B.innerGates?.[1]?.open;
    for (const [zone, ring] of [['inner', 1], ['palace', 2]]) {
      const gate = B.innerGates?.[ring - 1];
      const guards = this.soldiers.filter((s) => s.alive && s.zone === zone && !s.relocating);
      if (gate?.open && !gate.sealed) { gate.sealed = true; this.sealBreach(ring, guards); }
      const foes = intruders[zone];
      // ล่าเสมอถ้าศัตรูเหลือน้อยพอ (smallGroupHunt) แม้กองรักษาเองจะบาดเจ็บจนสัดส่วนไม่ถึง counterRatio ก็ตาม
      const counter = foes.length > 0 && (foes.length <= guards.length * AI.counterRatio || foes.length <= AI.smallGroupHunt);
      const foeCenter = foes.length ? centroidOf(foes) : null;
      const intercept = new Map();
      for (const e of ladders) {
        if (GROUND_ZONES[e.ring + 1] !== zone) continue;
        guards.filter((s) => !intercept.has(s) && s.kind !== 'cav')
          .sort((a, b) => a.pos.distanceToSquared(e.landing) - b.pos.distanceToSquared(e.landing))
          .slice(0, AI.interceptors)
          .forEach((s) => intercept.set(s, e.landing));
      }
      for (const s of guards) {
        if (zone === 'inner' && palaceThreat && palaceGateOpen) { this.relocateToPalace(s); continue; }
        if (intercept.has(s)) { s.orderTarget = intercept.get(s); s.intent = 'intercept-ladder'; continue; }
        if (counter) { s.orderTarget = foeCenter; s.intent = 'counter-attack'; continue; }
        if (gate && !gate.open && gate.started && s.gatePost) { s.orderTarget = s.gatePost; s.intent = 'brace-gate'; continue; }
        s.orderTarget = null;
        s.intent = 'guard-post';
      }
    }
  }

  // ประตูแตก: โล่ตั้งแนวใหม่ขวางปากประตูด้านใน · ม้าไปตั้งหลักสองปีกพร้อมพุ่งตีขนาบ
  sealBreach(ring, guards) {
    const R = CFG.rings[ring];
    guards.filter((s) => s.utype === 'guardShield').forEach((s, i) => {
      const col = i % 12, row = Math.floor(i / 12);
      s.homePost = new THREE.Vector3((col - 5.5) * 1.15, 0, R.half - 1.6 - row * 1.4);
      s.gatePost = null;
    });
    const flankX = ring === 1 ? 14 : 9;
    guards.filter((s) => s.kind === 'cav').forEach((s, i) => {
      const sign = i % 2 ? 1 : -1;
      const k = Math.floor(i / 2);
      s.homePost = new THREE.Vector3(sign * (flankX + (k % 3) * 1.4), 0, R.half - 6 - Math.floor(k / 3) * 2.4);
    });
  }

  relocateToPalace(s) {
    if (s.relocating) return;
    const i = this.palacePostIndex++;
    const post = new THREE.Vector3(-7.7 + (i % 8) * 2.2, 0, 7 - (Math.floor(i / 8) % 5) * 2.2);
    s.relocating = true;
    s.orderTarget = null;
    s.waypoints = [gateFrontPoint(2), gateInsidePoint(2), post];
    s.homePost = post;
    s.intent = 'fall-back-to-palace';
  }
}
