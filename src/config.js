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

  // ---------- กองทัพฝ่ายโจมตี ----------
  // ทัพเราใหญ่ขึ้นและแกร่งขึ้น เพื่อให้มีกำลังพอฝ่าถึงชั้นในจริง ๆ ไม่ใช่หมดแรงตั้งแต่กำแพงนอก
  army: {
    composition: [
      ...Array(28).fill('spear'), // พลหอก — แบกบันได ปีน ปะทะ
      ...Array(14).fill('shield'), // พลโล่ — กำบังธนูให้ทัพ เดินช้า แกร่ง
      ...Array(10).fill('archer'), // นักธนู — ยิงกดกำแพง และตามเข้าไปกดพลธนูกำแพงชั้นใน
    ],
    ramCompanies: 6,             // รถทุบทั้งหมดตั้งทัพเฉพาะด้านใต้หน้าประตู
    cavalryCompanies: 32,        // กระจายด้านละ 8 กอง (เดิมกระจุกอยู่ด้านใต้ด้านเดียว)
    cavalryPerCompany: 10,
  },

  unit: {
    // หอก/โล่แกร่งขึ้นให้สู้องครักษ์ชั้นในไหว (เดิมองครักษ์แลกชนะ ~3:1 ฝ่ายเราแทบไม่มีทางฝ่า)
    spear: { hp: 8, dmg: 2, atkCd: 0.95, speed: 3.6, climb: 1.7 },
    shield: { hp: 10, dmg: 1, atkCd: 0.9, speed: 2.9, climb: 1.5, coverRadius: 4.2, coverChance: 0.65 },
    atkArch: { hp: 3, dmg: 1, atkCd: 5.0, range: 64, projSpeed: 30, gravity: 10, standDist: OUTER.half + OUTER.thick + 40, speed: 3.4 },
    cav: { hp: 10, dmg: 3, atkCd: 1.0, speed: 8.6 },
    ram: { crew: 6, crewHp: 5, ramHp: 240, batterRate: 0.016, speed: 1.7, rockDmg: 20 },
  },

  // ---------- ฝ่ายรับ ----------
  wallMelee: 90,
  wallArchers: 28,
  archerCd: 2.4,
  archerRange: 45,          // ไม่ถึงแนวตั้งทัพเริ่มต้น แต่ยิงโต้ธนูที่เข้าประจำตำแหน่งได้
  // hp ขึ้นจาก 11 หักล้างที่หอกเราแรงขึ้นเท่าตัว — ไม่งั้นกำแพงนอกแตกเร็วจนทัพเรา
  // ไปถึงชั้นในโดยแทบไม่เสียกำลัง (วัดได้ว่าทหารรอดพุ่งจาก 16% เป็น 69%)
  defender: { hp: 16, dmg: 1, atkCd: 1.3, speed: 2.4 },
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
  // บันไดพาด: โคนห่างหน้ากำแพง baseDist, ปลายเอนชนหน้ากำแพง (ยื่นพ้น topOut) โผล่เหนือทางเดิน topRise
  ladder: { baseDist: 4.3, topOut: 0.15, topRise: 1.4, maxClimbers: 4, plantTime: 1.6, breakChance: 0.18, replantTime: 4.0 },
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
  // ลดลงจาก 150 กอง เพื่อให้ทัพเราไม่ถูกบดทิ้งหมดแรงก่อนถึงศึกจริงที่ชั้นใน
  // และเพื่อคืนงบจำนวนหน่วยให้ทหารม้าที่เพิ่มขึ้น (เฟรมเรตขึ้นกับจำนวนหน่วยรวมสองฝ่าย)
  reserveSquads: 105,
  squadSize: 4,

  // ทหารรักษาเมืองชั้นในและวัง — เก่งกว่าทหารกำแพงนอก ตั้งรับอยู่ในชั้นของตัวเอง
  garrison: {
    shield: { hp: 14, dmg: 1, atkCd: 1.1, speed: 2.2, coverRadius: 4, coverChance: 0.55 },
    spear: { hp: 12, dmg: 2, atkCd: 1.3, speed: 2.5 },
    cav: { hp: 12, dmg: 3, atkCd: 1.0, speed: 8.2, detectRange: 42 },
    archer: { hp: 4, dmg: 1, cd: 2.3, range: 40 },
    inner: { shields: 42, spears: 42, cav: 26, archersPerSide: 14 },
    palace: { shields: 28, spears: 34, cav: 18, archersPerSide: 9 },
    // สมององครักษ์: คิดทุก thinkInterval วิ · ตีสวนเมื่อผู้บุกที่หลุดเข้ามา ≤ counterRatio × องครักษ์ในชั้น
    // (หรือน้อยกว่า smallGroupHunt นาย ก็ล่าเสมอ ไม่ว่าองครักษ์จะเหลือเท่าไหร่ — กันไม่ให้กลุ่มเล็กที่รอดมา
    // ถูกปล่อยผ่านเพราะกองรักษาเองก็บาดเจ็บจนสัดส่วนไม่ถึงเกณฑ์) · ส่งคนไปดักจุดลงบันไดพาดบันไดละ interceptors นาย
    ai: { thinkInterval: 0.5, counterRatio: 0.5, smallGroupHunt: 6, interceptors: 6 },
  },

  // ประตูชั้นใน: ทหารราบฟันประตูจากด้านนอกได้ (ไม่ต้องใช้รถทุบ) หรือคนที่ข้ามไปแล้วแงะเปิดจากด้านใน
  innerGates: {
    // ตามลำดับชั้น (ชั้น 0 = ประตูเมืองนอก ใช้ระบบรถทุบเดิม) — หนาขึ้นเพื่อให้ศึกชั้นใน
    // เป็นศึกจริง: เป็นช่วงที่น้ำมันเดือดและพลธนูบนสันกำแพง (ที่ปราบได้แล้ว) ต้องถูกจัดการ
    hp: [0, 200, 280],
    halfWidth: 3.4,
    hackRadius: 6,
    hackRate: 0.3,       // ความเสียหายต่อวินาทีต่อทหาร 1 นาย
    hackCap: 14,         // ฟันพร้อมกันได้ไม่เกินนี้ (หน้าประตูแคบ)
    openRadius: 4,
    insideBase: 0.1, insidePer: 0.06,
    // น้ำมันเดือดจากซุ้มประตู: ทุก interval วิขณะถูกฟัน เตือน telegraph วิ แล้วราดรัศมี radius ม. (มีจำกัด pots หม้อ)
    oil: { interval: 6, telegraph: 1.0, radius: 3.5, dmg: 3, pots: 8 },
  },

  // ชัยชนะ: ยึดลานวังชั้นในสุด — ทหารเรามากกว่าทหารเมืองในลานวังต่อเนื่องจนแถบเต็ม
  palace: { holdTime: 20, decayRate: 0.5, minHolders: 3 },

  // บันไดพาดข้ามกำแพงชั้นใน — ขึ้นถึงสันกำแพงแล้วกวาดพลธนูบนสันก่อน ค่อยโดดลงลานด้านใน
  // sweepRange = ระยะบนสันกำแพงที่ชุดขึ้นบันไดจะไล่กวาดพลธนู (เกินนี้ถือว่าไกลเกินไป ลงลานเลย)
  // sweepTimeout เป็นแค่วาล์วกันค้าง (ถ้ากวาดไม่ลงสักที ก็ลงลานต่อ) — ทางออกปกติคือสันกำแพงโล่ง
  escalade: { plantTime: 1.4, maxClimbers: 3, climbFactor: 0.45, sweepRange: 18, sweepTimeout: 45 },

  // ท่าแม่ทัพระหว่างศึก — ให้ผู้เล่นมีอะไรตัดสินใจตลอดศึก ไม่ใช่แค่ช่วงเปิดฉาก
  commander: {
    // 📯 แตรรวมพล: กองที่เลือกเดินเร็วขึ้นและตีถี่ขึ้นชั่วคราว ไม่จำกัดจำนวนครั้ง แค่มีคูลดาวน์
    horn: { cooldown: 60, duration: 10, speedMul: 1.35, atkCdMul: 0.78 },
    // 🐎 กองหนุน: ต้องยึดกำแพงนอกได้ก่อนถึงมีสิทธิ์ใช้ (1 สิทธิ์ต่อด้านที่ยึดได้ สูงสุด 4 ครั้งต่อศึก)
    reinforce: { composition: { spear: 4, shield: 2 }, squadSize: 10 },
  },

  // ยุทธปัจจัย: เลือกก่อนศึก 2 ใน 4 ใบ (หน้าเริ่มเกม) — ทำให้แต่ละศึกไม่เหมือนกัน
  // ระยะสั่ง: 🔥/⛏️ อ่านด้านจากกองที่กำลังเลือกอยู่ตอนใช้ (ด้านที่มีกองเลือกมากที่สุด)
  loadouts: {
    fireVolley: { cooldown: 45, duration: 8 }, // 🔥 ห่าธนูไฟ: ยิงกดฝ่ายเมืองด้านที่เลือกไว้ ยิงธนู/กลิ้งหินไม่ได้ชั่วคราว
    spySabotage: {},                            // 🕵️ ไส้ศึก: ใช้ได้ครั้งเดียว — ประตูชั้นในที่ใกล้แตกที่สุดเสียความแข็งแรงทันทีครึ่งหนึ่ง
    sapperTunnel: { channelTime: 40, casualtyFrac: 0.35 }, // ⛏️ กองขุดอุโมงค์: ใช้ได้ครั้งเดียว — ขุด 40 วิแล้วกำแพงด้านนั้นถล่ม
    armoredRam: { ramHpMul: 1.6, ramRateMul: 1.25 }, // 🛡️ รถทุบหุ้มเหล็ก: ติดตัวตลอดศึก ไม่ต้องกดใช้
  },

  // จังหวะดราม่า: กล้องตัดฉาก + สโลว์โมชันชั่วครู่ตอนเหตุการณ์สำคัญ (ประตูนอกแตก/ถึงลานวังครั้งแรก/ยึดวังใกล้สำเร็จ)
  // ปรับแค่ความเร็ว "ฉาก" ในลูปเรนเดอร์เท่านั้น ไม่แตะ fixed timestep ของการจำลอง ผลศึกจึงเหมือนเดิมทุกประการ
  drama: { easeTime: 0.6, holdTime: 1.3, slowMoScale: 0.4, palaceThreshold: 0.75 },

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

// ---------- ระดับความยาก ----------
// ค่าฐาน (ระดับปกติ) เก็บไว้ก่อน แล้วแต่ละระดับคูณจากค่าฐานเสมอ — เปลี่ยนระดับไปมาได้โดยค่าไม่เพี้ยนสะสม
const BASE = JSON.parse(JSON.stringify({
  defender: CFG.defender, wallMelee: CFG.wallMelee, reserveSquads: CFG.reserveSquads,
  garrison: CFG.garrison, innerGates: CFG.innerGates, ram: CFG.unit.ram, palace: CFG.palace, timeLimit: CFG.timeLimit,
}));

export const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({
    label: 'ง่าย', blurb: 'ทหารเมืองน้อยและเปราะกว่า ประตูพังง่าย ยืนยึดวัง 15 วิ มีเวลา 18 นาที',
    defenderHp: 0.8, wallMelee: 0.8, reserves: 0.75, guards: 0.75, guardHp: 0.85, gateHp: 0.75, ramRate: 1.3, holdTime: 15, timeLimit: 1080, oilPots: 4,
  }),
  normal: Object.freeze({
    label: 'ปกติ', blurb: 'รุมมั่วมีสิทธิ์แพ้ — วางแผนหลอกล่อ รวมพลบุก และเลือกทางฝ่าชั้นในถึงชนะ',
    defenderHp: 1, wallMelee: 1, reserves: 1, guards: 1, guardHp: 1, gateHp: 1, ramRate: 1, holdTime: 20, timeLimit: 900, oilPots: 8,
  }),
  hard: Object.freeze({
    label: 'ยาก', blurb: 'ทหารเมืองแน่นและทน องครักษ์มากขึ้น ประตูหนา ยืนยึดวัง 25 วิ มีเวลา 14 นาที',
    defenderHp: 1.2, wallMelee: 1.2, reserves: 1.25, guards: 1.3, guardHp: 1.15, gateHp: 1.3, ramRate: 0.8, holdTime: 25, timeLimit: 840, oilPots: 12,
  }),
});

export function applyDifficulty(name = 'normal') {
  const key = DIFFICULTIES[name] ? name : 'normal';
  const d = DIFFICULTIES[key];
  CFG.difficulty = key;
  CFG.defender.hp = Math.round(BASE.defender.hp * d.defenderHp);
  CFG.wallMelee = Math.round(BASE.wallMelee * d.wallMelee);
  CFG.reserveSquads = Math.round(BASE.reserveSquads * d.reserves);
  for (const ring of ['inner', 'palace']) {
    for (const f of ['shields', 'spears', 'cav', 'archersPerSide']) CFG.garrison[ring][f] = Math.max(1, Math.round(BASE.garrison[ring][f] * d.guards));
  }
  for (const u of ['shield', 'spear', 'cav', 'archer']) CFG.garrison[u].hp = Math.round(BASE.garrison[u].hp * d.guardHp);
  CFG.innerGates.hp = BASE.innerGates.hp.map((h) => Math.round(h * d.gateHp));
  CFG.innerGates.oil.pots = d.oilPots;
  CFG.unit.ram.batterRate = BASE.ram.batterRate * d.ramRate;
  CFG.palace.holdTime = d.holdTime;
  CFG.timeLimit = d.timeLimit;
  return key;
}
CFG.difficulty = 'normal';

// สีประจำฝ่าย: ทัพเรา = แดง, ฝ่ายเมือง = น้ำเงิน (ธงเมืองเปลี่ยนเป็นแดงเมื่อเรายึดได้)
export const TEAM_COLORS = Object.freeze({ attacker: 0xb03030, city: 0x2f5fa8 });

export const SIDE_NAMES = ['เหนือ', 'ตะวันออก', 'ใต้', 'ตะวันตก'];
export const GATE_NAMES = ['ประตูเมืองชั้นนอก', 'ประตูเมืองชั้นใน', 'ประตูวังต้องห้าม'];
export const WALL_NAMES = ['กำแพงเมืองชั้นนอก', 'กำแพงเมืองชั้นใน', 'กำแพงวังต้องห้าม'];
export const SIDE_CHARS = ['𝐍', '𝐄', '𝐒', '𝐖'];
export const UNIT_LABEL = {
  spear: '🔴 หอกปีนกำแพง', shield: '🟤 พลโล่กำบัง', archer: '🟢 นักธนูกดกำแพง',
  ram: '⚫ รถทุบประตู', cav: '🟡 ทหารม้า',
};

// ยุทธปัจจัย: ข้อมูลสำหรับหน้าเลือกก่อนศึกและ HUD — ตัวเลขจริงอยู่ที่ CFG.loadouts ด้านบน
export const LOADOUT_INFO = Object.freeze({
  fireVolley: {
    label: 'ห่าธนูไฟ', icon: '🔥', kind: 'active', key: 'c',
    blurb: 'สั่งยิงธนูไฟใส่ฝ่ายเมืองด้านที่กำลังเลือกอยู่ — ยิงธนู/กลิ้งหินไม่ได้ 8 วิ · คูลดาวน์ 45 วิ',
  },
  spySabotage: {
    label: 'ไส้ศึก', icon: '🕵️', kind: 'once', key: 'c',
    blurb: 'ใช้ได้ครั้งเดียว: ประตูชั้นในที่ใกล้แตกที่สุดเสียความแข็งแรงทันทีครึ่งหนึ่ง',
  },
  sapperTunnel: {
    label: 'กองขุดอุโมงค์', icon: '⛏️', kind: 'once', key: 'c',
    blurb: 'ใช้ได้ครั้งเดียว: เลือกกองที่กำลังบุกด้านไหน ขุด 40 วิแล้วกำแพงด้านนั้นถล่ม',
  },
  armoredRam: {
    label: 'รถทุบหุ้มเหล็ก', icon: '🛡️', kind: 'passive',
    blurb: 'ติดตัวตลอดศึก ไม่ต้องกดใช้: รถทุบทนขึ้น 60% และทุบประตูเร็วขึ้น 25%',
  },
});

const ROCK_PATTERNS = [
  { key: 'wave', name: 'กลิ้งเป็นระลอก', burst: 2, rollGap: 1.1, pause: 4.2 },
  { key: 'rapid', name: 'กลิ้งรัวต่อเนื่อง', burst: 3, rollGap: 0.85, pause: 3.6 },
  { key: 'sparse', name: 'กลิ้งเบาบาง', burst: 1, rollGap: 0, pause: 2.9 },
  { key: 'longGap', name: 'ทิ้งช่วงยาว', burst: 3, rollGap: 1.0, pause: 6.8 },
];

// เมืองสุ่มตาม seed: แต่ละด้านได้ "ลักษณะ" ไม่ซ้ำกัน (seed เดิม = เมืองเดิม) — ไม่แตะแกนประตู/รูปทรงเมือง
// สามชั้นเดิมเลย เพราะระบบเส้นทาง/ช่องประตู/บันไดในผูกกับแกนใต้อยู่หลายสิบจุด เปลี่ยนแค่ "จำนวน/ความเร็ว"
export const CITY_VARIATION = Object.freeze({
  weakMeleeMul: 0.7,      // 🟥 กำแพงร้าว: ทหารกำแพงน้อยกว่า ยึดได้เร็วกว่า
  reinforcedArcherMul: 1.35, // 🟨 หอธนูเสริม: พลธนูด้านนั้นเพิ่มขึ้น
  moatSlowFactor: 0.5,    // 🟦 คูเมือง: ความเร็วเดินของฝ่ายบุกช้าลงครึ่งหนึ่งช่วงหน้ากำแพงด้านนั้น
  moatDepth: 14,          // ความลึกของแถบคูเมืองนับจากหน้ากำแพงนอกออกมา
});
export const SIDE_FEATURE_LABELS = Object.freeze({
  normal: 'ปกติ', weak: '🟥 กำแพงร้าว', reinforced: '🟨 หอธนูเสริม', moat: '🟦 คูเมือง',
});
// ด้านใต้ (index 2) มีประตู+รถทุบตั้งทัพอยู่แล้ว ไม่ให้เป็นคูเมือง (ถือว่ามีสะพานชักข้ามไว้แล้ว)
const FEATURE_POOL = ['normal', 'normal', 'weak', 'reinforced', 'moat'];
const FEATURE_POOL_SOUTH = ['normal', 'normal', 'weak', 'reinforced'];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// สุ่มการวางกำลังฝ่ายเมืองของแต่ละภารกิจ (seed เดิม + ระดับเดิม = ภารกิจเดิม)
// ยุทธปัจจัยที่เลือกได้ก่อนศึก (สูงสุด 2 ใบ) — ค่าไม่ถูกต้องถูกกรองทิ้งเงียบ ๆ กันหน้าเริ่มเกมพัง
const LOADOUT_KEYS = new Set(['fireVolley', 'spySabotage', 'sapperTunnel', 'armoredRam']);
export function genMission(seed = Math.floor(Math.random() * 1e9), difficulty = 'normal', loadouts = []) {
  const key = DIFFICULTIES[difficulty] ? difficulty : 'normal';
  const rng = mulberry32(seed);
  const sides = [];
  for (let i = 0; i < 4; i++) {
    const pool = i === 2 ? FEATURE_POOL_SOUTH : FEATURE_POOL;
    const feature = pool[Math.floor(rng() * pool.length)];
    sides.push({
      melee: Math.round(BASE.wallMelee * DIFFICULTIES[key].wallMelee * (feature === 'weak' ? CITY_VARIATION.weakMeleeMul : 1)),
      archers: Math.round(CFG.wallArchers * (feature === 'reinforced' ? CITY_VARIATION.reinforcedArcherMul : 1)),
      archerCd: CFG.archerCd * (0.85 + rng() * 0.3),
      pattern: ROCK_PATTERNS[Math.floor(rng() * ROCK_PATTERNS.length)],
      feature,
    });
  }
  const chosenLoadouts = [...new Set(loadouts)].filter((k) => LOADOUT_KEYS.has(k)).slice(0, 2);
  return { seed, sides, difficulty: key, loadouts: chosenLoadouts };
}
