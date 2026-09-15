// เมืองสามชั้นแบบวังต้องห้าม (นอก → ใน): half = ระยะจากกลางเมืองถึงหน้าในของกำแพง
const RINGS = Object.freeze([
  Object.freeze({ half: 64, thick: 8, h: 14 }), // กำแพงเมืองชั้นนอก — ปีนด้วยบันไดพาด มีบันไดในลงเมือง
  Object.freeze({ half: 38, thick: 5, h: 9 }),  // กำแพงเมืองชั้นใน — ทุบประตูหรือพาดบันไดข้าม
  Object.freeze({ half: 18, thick: 4, h: 7 }),  // กำแพงวังต้องห้าม — ด่านสุดท้ายก่อนลานวัง
]);
const OUTER = RINGS[0];

// ค่าคงที่ของเกมทั้งหมด (ปรับดุลย์ที่นี่) — v4 "เมืองสามชั้น"
export const CFG = {
  rings: RINGS,
  wallHalf: OUTER.half,
  wallThick: OUTER.thick,
  wallH: OUTER.h,
  walkY: OUTER.h + 0.3,

  timeLimit: 900,          // 15 นาที — เมืองใหญ่สามชั้นต้องใช้เวลาเดินทัพเข้าไปถึงวัง
  captureHoldTime: 5,
  captureSoldiersNeeded: 6,

  spawnDist: OUTER.half + OUTER.thick + 50, // จุดตั้งทัพเริ่มเกม (พ้นระยะธนูกำแพง)

  // ---------- กองทัพฝ่ายโจมตี: large battle — เพิ่มกำลังพลเป็นสองเท่า ----------
  army: {
    composition: [
      ...Array(24).fill('spear'), // พลหอก — แบกบันได ปีน ปะทะ
      ...Array(12).fill('shield'), // พลโล่ — กำบังธนูให้ทัพ เดินช้า แกร่ง
      ...Array(8).fill('archer'), // นักธนู — ยิงกดกำแพงจากระยะ
    ],
    ramCompanies: 6,             // รถทุบทั้งหมดตั้งทัพเฉพาะด้านใต้หน้าประตู
    cavalryCompanies: 16,
    cavalryPerCompany: 10,
  },

  unit: {
    spear: { hp: 6, dmg: 1, atkCd: 0.95, speed: 3.6, climb: 1.7 },
    shield: { hp: 7, dmg: 1, atkCd: 0.9, speed: 2.9, climb: 1.5, coverRadius: 4.2, coverChance: 0.65 },
    atkArch: { hp: 3, dmg: 1, atkCd: 5.0, range: 64, projSpeed: 30, gravity: 10, standDist: OUTER.half + OUTER.thick + 40, speed: 3.4 },
    cav: { hp: 7, dmg: 2, atkCd: 1.0, speed: 8.6 },
    ram: { crew: 6, crewHp: 5, ramHp: 240, batterRate: 0.02, speed: 1.7, rockDmg: 20 },
  },

  // ---------- ฝ่ายรับ ----------
  wallMelee: 80,
  wallArchers: 28,
  archerCd: 2.4,
  archerRange: 45,          // ไม่ถึงแนวตั้งทัพเริ่มต้น แต่ยิงโต้ธนูที่เข้าประจำตำแหน่งได้
  defender: { hp: 9, dmg: 1, atkCd: 1.3, speed: 2.4 },
  archerStat: { hp: 3, dmg: 1, atkCd: 2.4, speed: 1.4 },

  // โลจิสติกส์หิน — กองหินบนกำแพงหมดต้องให้พลขนหินแบกขึ้นจากคลัง
  rockLogi: {
    pileStart: 30, pileMax: 45,
    reorderAt: 20,
    stock: 500,
    carriers: 20, carryAmount: 4,
    stairSpeed: 4.0, spacing: 1.1,
  },
  rock: {
    telegraph: 1.0, killRadius: 1.2, killChance: 0.42,
    speed0: 7, accel: 10, baseKillRadius: 2.3,
  },
  ladder: { baseDist: 3.2, maxClimbers: 4, plantTime: 1.6, breakChance: 0.18, replantTime: 4.0 },
  arrow: { dmg: 1, spread: 0.7, dmgWall: 2 }, // ธนูฝ่ายบุกแทงทะลุเกราะบนกำแพง (แรง 2)

  // AI ผู้บัญชาการฝ่ายเมือง
  ai: {
    reinforceThreshold: 0.6,    // กำแพงเหลือ < 60% → ขอกำลังเสริม
    reinforceInterval: 3,
    reinforceSquads: 12,        // จำนวนกองสูงสุดต่อรอบเสริม
    minReinforceAlive: 0.22,
    detachMax: 16,              // ยกพลข้ามด้านช่วยเพื่อนบ้าน (เมื่อด้านตัวเองสงบ)
    detachCooldown: 20,
    detachThreat: 36,           // ผู้บุกบนกำแพง >= 36 นาย = ความคุกคามสูง
  },

  // กองสำรองในเมืองชั้นนอก (ยืนเป็นแถวรอบวงแหวนระหว่างกำแพงนอกกับกำแพงชั้นใน)
  reserveSquads: 120,
  squadSize: 4,

  // ทหารรักษาเมืองชั้นในและวัง — เก่งกว่าทหารกำแพงนอก ตั้งรับอยู่ในชั้นของตัวเอง
  garrison: {
    shield: { hp: 13, dmg: 1, atkCd: 1.1, speed: 2.2, coverRadius: 4, coverChance: 0.55 },
    spear: { hp: 11, dmg: 2, atkCd: 1.3, speed: 2.5 },
    cav: { hp: 11, dmg: 3, atkCd: 1.0, speed: 8.2, detectRange: 42 },
    archer: { hp: 4, dmg: 1, cd: 2.3, range: 40 },
    inner: { shields: 36, spears: 36, cav: 24, archersPerSide: 12 },
    palace: { shields: 24, spears: 30, cav: 16, archersPerSide: 8 },
  },

  // ประตูชั้นใน: ทหารราบฟันประตูจากด้านนอกได้ (ไม่ต้องใช้รถทุบ) หรือคนที่ข้ามไปแล้วแงะเปิดจากด้านใน
  innerGates: {
    hp: [0, 110, 150],   // ตามลำดับชั้น (ชั้น 0 = ประตูเมืองนอก ใช้ระบบรถทุบเดิม)
    halfWidth: 3.4,
    hackRadius: 6,
    hackRate: 0.3,       // ความเสียหายต่อวินาทีต่อทหาร 1 นาย
    hackCap: 14,         // ฟันพร้อมกันได้ไม่เกินนี้ (หน้าประตูแคบ)
    openRadius: 4,
    insideBase: 0.1, insidePer: 0.06,
  },

  // ชัยชนะ: ยึดลานวังชั้นในสุด — ทหารเรามากกว่าทหารเมืองในลานวังต่อเนื่องจนแถบเต็ม
  palace: { holdTime: 20, decayRate: 0.5, minHolders: 3 },

  // บันไดพาดข้ามกำแพงชั้นใน
  escalade: { plantTime: 1.4, maxClimbers: 3, climbFactor: 0.45 },

  // ม้าซอง (sally) — เมืองเปิดประตูส่งม้าออกไปถล่มเครื่องโจมตีแล้วถอย
  sortie: {
    cooldown: 60, duration: 16, horses: 32,
    hp: 7, dmg: 2, atkCd: 1.0, speed: 8.6,
    triggerRange: 75, minReserves: 110, retreatBelow: 8,
  },

  // ประตูเมือง (ฝั่งใต้): เปิดได้ทั้งจากใน (แงะ) และนอก (รถทุบ)
  gate: {
    frontPoint: OUTER.half + OUTER.thick + 5.5,
    insidePoint: OUTER.half - 3,
    openRadius: 5.5,
    insideBase: 0.08, insidePer: 0.05,
    openerLimit: 20,
  },

  maxAssaultPerSide: 48,
  stairAssault: { maxEnRoute: 16 }, // ผู้บุกในเมืองที่ขึ้นบันไดในพร้อมกันต่อด้าน (ไปกวาดทหารค้างบนกำแพง)
  descendAtOnce: 32,   // จำนวนลงบันไดในพร้อมกันต่อด้าน

  movement: {
    spatialCell: 4,
    infantryRadius: 0.78,
    cavalryRadius: 1.35,
    separationStrength: 0.82,
    stuckSample: 0.5,
    stuckMinProgress: 0.12,
    stuckTimeout: 1.8,
    replanCooldown: 1.2,
  },

  combat: {
    infantryCapacity: 3,
    cavalryCapacity: 2,
    chokeCapacity: 2,
    detectionRange: 26,
  },
};

export const SIDE_NAMES = ['เหนือ', 'ตะวันออก', 'ใต้', 'ตะวันตก'];
export const GATE_NAMES = ['ประตูเมืองชั้นนอก', 'ประตูเมืองชั้นใน', 'ประตูวังต้องห้าม'];
export const WALL_NAMES = ['กำแพงเมืองชั้นนอก', 'กำแพงเมืองชั้นใน', 'กำแพงวังต้องห้าม'];
export const SIDE_CHARS = ['𝐍', '𝐄', '𝐒', '𝐖'];
export const UNIT_LABEL = {
  spear: '🔴 หอกปีนกำแพง', shield: '🟤 พลโล่กำบัง', archer: '🟢 นักธนูกดกำแพง',
  ram: '⚫ รถทุบประตู', cav: '🟡 ทหารม้า',
};

const ROCK_PATTERNS = [
  { key: 'wave', name: 'กลิ้งเป็นระลอก', burst: 2, rollGap: 1.1, pause: 4.2 },
  { key: 'rapid', name: 'กลิ้งรัวต่อเนื่อง', burst: 3, rollGap: 0.85, pause: 3.6 },
  { key: 'sparse', name: 'กลิ้งเบาบาง', burst: 1, rollGap: 0, pause: 2.9 },
  { key: 'longGap', name: 'ทิ้งช่วงยาว', burst: 3, rollGap: 1.0, pause: 6.8 },
];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// สุ่มการวางกำลังฝ่ายเมืองของแต่ละภารกิจ (seed เดิม = ภารกิจเดิม)
export function genMission(seed = Math.floor(Math.random() * 1e9)) {
  const rng = mulberry32(seed);
  const sides = [];
  for (let i = 0; i < 4; i++) {
    sides.push({
      melee: CFG.wallMelee,
      archers: CFG.wallArchers,
      archerCd: CFG.archerCd * (0.85 + rng() * 0.3),
      pattern: ROCK_PATTERNS[Math.floor(rng() * ROCK_PATTERNS.length)],
    });
  }
  return { seed, sides };
}
