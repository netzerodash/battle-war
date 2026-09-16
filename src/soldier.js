import * as THREE from 'three';
import { makeSoldierMesh } from './models.js';

const _v = new THREE.Vector3();
let nextSoldierId = 1;

export class Soldier {
  constructor({ type, faction, side, kind = 'inf', utype = type, hp, speed, atkCd, dmg, rng = () => 0.5 }) {
    this.id = nextSoldierId++;
    this.mesh = makeSoldierMesh(type);
    this.mesh.userData.soldier = this;
    this.mesh.scale.setScalar(0.94 + rng() * 0.12);
    this.faction = faction; // 'atk' | 'def'
    this.side = side;       // ด้านของผู้โจมตี (0-3), ฝ่ายเมือง = -1
    this.kind = kind;       // 'inf' | 'cav'
    this.utype = utype;     // 'spear'|'shield'|'atkArch'|'crew'|'cav'|'def'|'carrier'|'archer'|'sally'
    this.hpMax = hp; this.hp = hp;
    this.speed = speed;
    this.atkCd = atkCd; this.dmg = dmg;
    this.cd = rng() * atkCd;
    this.state = 'idle';
    this.alive = true;
    this.zone = 'field';    // 'field' | 'wall' | 'city'
    this.company = null;
    this.onCrest = false;   // ยืนรบอยู่บนสันกำแพงชั้นใน (โซน wall2/wall3) — กองไม่ลากตัวลงมา
    this.climb = null;      // { ladder, s } ตอนปีนบันได
    this.stair = null;      // { dir: 'up'|'down', s } ตอนใช้บันไดใน
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.bob = rng() * 10;
    this.moving = false;
    this.attackAnim = 0;
    this.attackWindup = 0;
    this.attackTarget = null;
    this.hitAnim = 0;
    this.hitDir = new THREE.Vector3();
    this.dieT = 0;
    this.fallDir = rng() < 0.5 ? 1 : -1;
    this.homePost = null;
    this.orderTarget = null; // จุดหมายที่คุมทัพสั่ง (ใช้โดย combat loop เมื่อไม่มีศัตรู)
    this.waypoints = null;
    this.detached = false;
    this.swayT = rng() * 10;
    this.counted = false;
    this.intent = 'idle';
    this.chargeReady = false;
  }

  damage(n) {
    if (!this.alive) return;
    this.hp -= n;
    if (this.hp <= 0) this.die();
  }

  die() {
    if (!this.alive) return;
    this.alive = false;
    this.state = 'dying';
    this.dieT = 0;
    this.climb = null;
    this.stair = null;
  }

  // เดิน/วิ่งไปยังจุดหมาย คืน true เมื่อถึง
  stepToward(dt, target, speed = this.speed, arriveR = 0.35) {
    _v.subVectors(target, this.pos);
    _v.y = 0;
    const d = _v.length();
    if (d <= arriveR) { this.moving = false; return true; }
    _v.normalize();
    this.pos.addScaledVector(_v, Math.min(d, speed * dt));
    this.faceDir(_v, dt);
    this.moving = true;
    this.bob += dt * (this.kind === 'cav' ? 1.4 : 1);
    return false;
  }

  faceDir(dir, dt) {
    const target = Math.atan2(dir.x, dir.z);
    let diff = target - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.yaw += diff * Math.min(1, dt * 10);
  }

  facePoint(p, dt) {
    _v.subVectors(p, this.pos); _v.y = 0;
    if (_v.lengthSq() > 1e-6) this.faceDir(_v.normalize(), dt);
  }

  syncMesh(dt) {
    const m = this.mesh;
    if (this.state === 'dying') {
      this.dieT += dt;
      const k = Math.min(1, this.dieT / 0.45);
      m.rotation.set(0, this.yaw, k * (Math.PI / 2) * this.fallDir, 'YXZ');
      m.position.copy(this.pos);
      m.position.y += 0.15 * k;
      if (this.dieT > 2.4) m.position.y -= (this.dieT - 2.4) * 1.1;
      return;
    }
    const cav = this.kind === 'cav';
    const bobY = this.moving ? Math.abs(Math.sin(this.bob * (cav ? 6 : 9))) * (cav ? 0.12 : 0.06) : 0;
    let lungeX = 0, lungeZ = 0;
    if (this.attackWindup > 0) {
      const k = Math.min(1, this.attackWindup / 0.24) * (cav ? 0.18 : 0.1);
      lungeX -= Math.sin(this.yaw) * k;
      lungeZ -= Math.cos(this.yaw) * k;
    }
    if (this.attackAnim > 0) {
      this.attackAnim -= dt;
      const k = Math.sin((1 - Math.max(0, this.attackAnim) / 0.28) * Math.PI) * (cav ? 0.48 : 0.34);
      lungeX += Math.sin(this.yaw) * k; lungeZ += Math.cos(this.yaw) * k;
    }
    if (this.hitAnim > 0) {
      this.hitAnim = Math.max(0, this.hitAnim - dt);
      const k = Math.sin((this.hitAnim / 0.16) * Math.PI) * 0.22;
      lungeX += this.hitDir.x * k;
      lungeZ += this.hitDir.z * k;
    }
    m.position.set(this.pos.x + lungeX, this.pos.y + bobY, this.pos.z + lungeZ);
    if (this.state === 'climb' || this.state === 'stairUp' || this.state === 'stairDown') {
      m.rotation.set(-0.35, this.yaw, 0, 'YXZ');
    } else if (this.state === 'hold' || this.state === 'waitBase' || this.state === 'idle') {
      this.swayT += dt;
      m.rotation.set(0, this.yaw + Math.sin(this.swayT * 2.2) * 0.12, cav ? 0 : Math.sin(this.swayT * 1.1) * 0.015, 'YXZ');
    } else if (cav && this.moving) {
      m.rotation.set(Math.sin(this.bob * 6) * 0.05, this.yaw, Math.sin(this.bob * 3) * 0.05, 'YXZ');
    } else {
      m.rotation.set(0, this.yaw, 0, 'YXZ');
    }
  }
}
