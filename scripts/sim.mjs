#!/usr/bin/env node
// จำลองศึกแบบ headless เพื่อวัดสมดุลเกม: บอท × seed × ระดับความยาก → ตารางอัตราชนะ เวลาจบ และทหารที่รอด
//
//   npm run sim                                   # ทุกบอท · 6 seed · ระดับปกติ
//   npm run sim -- --bots brute,planned --levels easy,normal,hard --seeds 101,202
//   npm run sim -- --seeds 3 --workers 3 --verbose
//
// บอทสั่งทัพผ่าน API เดียวกับผู้เล่น (battle.orderSelected) จึงวัดเกมจริง ไม่ใช่เกมจำลองอีกชุด
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const DEFAULT_SEEDS = [101, 202, 303, 404, 505, 606];
const BOT_NAMES = ['brute', 'planned', 'escalade', 'commander'];
const BOT_LABELS = { brute: 'รุมมั่ว', planned: 'วางแผน', escalade: 'พาดบันได', commander: 'แม่ทัพ' };
// บอทแม่ทัพเลือกยุทธปัจจัยตายตัวไว้ล่วงหน้า (ไม่มี UI ให้บอทเลือกเอง) — บอทอื่นไม่เลือกเลย (ค่าเริ่มต้น)
const BOT_LOADOUTS = { commander: ['armoredRam', 'fireVolley'] };

if (isMainThread) {
  main().catch((err) => { console.error(err); process.exit(1); });
} else {
  runBattle(workerData).then((r) => parentPort.postMessage(r), (err) => parentPort.postMessage({ ...workerData, error: String(err?.stack || err) }));
}

// ---------- ฝั่งคุมงาน ----------
function parseArgs(argv) {
  const opts = { bots: BOT_NAMES, seeds: DEFAULT_SEEDS, levels: ['normal'], workers: Math.max(1, Math.min(6, os.cpus().length - 1)), verbose: false, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--bots') opts.bots = next().split(',').filter(Boolean);
    else if (a === '--levels') opts.levels = next().split(',').filter(Boolean);
    else if (a === '--workers') opts.workers = Math.max(1, +next());
    else if (a === '--verbose') opts.verbose = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--seeds') {
      const v = next();
      opts.seeds = /^\d+$/.test(v) ? DEFAULT_SEEDS.slice(0, +v).concat(Array.from({ length: Math.max(0, +v - DEFAULT_SEEDS.length) }, (_, k) => 707 + k * 101)) : v.split(',').map(Number);
    }
  }
  for (const b of opts.bots) if (!BOT_NAMES.includes(b)) throw new Error(`ไม่รู้จักบอท "${b}" (มี ${BOT_NAMES.join(', ')})`);
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const jobs = [];
  for (const level of opts.levels) for (const bot of opts.bots) for (const seed of opts.seeds) jobs.push({ bot, seed, level });
  const started = Date.now();
  const results = [];
  let next = 0;
  const file = fileURLToPath(import.meta.url);
  await new Promise((resolve) => {
    let running = 0;
    const launch = () => {
      if (next >= jobs.length && running === 0) { resolve(); return; }
      while (running < opts.workers && next < jobs.length) {
        const job = jobs[next++];
        running++;
        const w = new Worker(file, { workerData: job });
        w.once('message', (r) => {
          results.push(r);
          if (!opts.json) {
            const line = r.error ? `✖ ${job.level}/${job.bot}/${job.seed}: ${r.error.split('\n')[0]}`
              : `${r.result === 'win' ? '✔' : '✖'} ${job.level.padEnd(6)} ${job.bot.padEnd(8)} seed ${String(job.seed).padEnd(4)} ${r.result.padEnd(9)} ${fmt(r.time)}  รอด ${Math.round(r.alive * 100)}%`;
            console.error(`[${results.length}/${jobs.length}] ${line}`);
          }
        });
        w.once('exit', () => { running--; launch(); });
      }
    };
    launch();
  });
  if (opts.json) { console.log(JSON.stringify(results, null, 2)); return; }
  printSummary(results, opts);
  console.log(`\nใช้เวลาจริง ${Math.round((Date.now() - started) / 1000)} วิ · ${jobs.length} ศึก · ${opts.workers} worker`);
}

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function printSummary(results, opts) {
  console.log('\nระดับ   บอท        ชนะ     เวลาจบ(เฉลี่ยที่ชนะ)  ทหารรอด  ถึงลานวัง(เฉลี่ย)');
  for (const level of opts.levels) for (const bot of opts.bots) {
    const rs = results.filter((r) => r.level === level && r.bot === bot && !r.error);
    const wins = rs.filter((r) => r.result === 'win');
    const winTime = mean(wins.map((r) => r.time));
    const palace = rs.map((r) => r.palaceAt).filter((t) => t != null);
    console.log(`${level.padEnd(7)} ${(BOT_LABELS[bot] || bot).padEnd(9)} ${`${wins.length}/${rs.length}`.padEnd(7)} ${Number.isNaN(winTime) ? '   —   ' : fmt(winTime).padStart(7)}               ${String(Math.round(mean(rs.map((r) => r.alive)) * 100)).padStart(3)}%     ${palace.length ? fmt(mean(palace)) : '—'}`);
    if (opts.verbose) for (const r of rs) console.log(`         seed ${r.seed}: ${r.result} ${fmt(r.time)} รอด ${Math.round(r.alive * 100)}% ประตู ${r.gatesAt.map((t) => (t == null ? '—' : fmt(t))).join(' / ')}`);
  }
}

// ---------- ฝั่ง worker: หนึ่งศึก ----------
async function runBattle({ bot, seed, level }) {
  globalThis.window ??= {}; // เสียงสังเคราะห์อ้าง window เฉพาะตอนเล่นเสียง
  const THREE = await import('three');
  const { CFG, genMission } = await import('../src/config.js');
  const { Battle } = await import('../src/battle.js');
  const { buildCity } = await import('../src/city.js');
  const { worldPoint } = await import('../src/world.js');
  const scene = new THREE.Scene();
  const city = buildCity(scene);
  const log = { palaceAt: null, gatesAt: [null, null, null] };
  let battle = null;
  const onEvent = (type, data) => {
    if (!battle) return;
    if (type === 'palace_contest' && log.palaceAt == null) log.palaceAt = battle.time;
    if (type === 'gate_open' || type === 'gate_breached') log.gatesAt[0] ??= battle.time;
    if (type === 'inner_gate_open') log.gatesAt[data.ring] ??= battle.time;
  };
  battle = new Battle(genMission(seed, level, BOT_LOADOUTS[bot] || []), scene, city, onEvent);
  battle.spawnMarker = () => {};
  const player = makeBot(bot, battle, { THREE, CFG, worldPoint });
  const dt = 1 / 30;
  while (!battle.ended && battle.time <= CFG.timeLimit + 1) {
    battle.update(dt);
    player.tick();
  }
  const deployed = battle.stats.deployedTotal || 1;
  return { bot, seed, level, result: battle.result || 'timeout', time: battle.time, alive: battle.stats.attackersAlive / deployed, ...log };
}

// ---------- บอท ----------
function makeBot(name, battle, ctx) {
  const { THREE, CFG, worldPoint } = ctx;
  const V = (x, z) => new THREE.Vector3(x, 0, z);
  const select = (pred) => {
    battle.clearSelection();
    for (const c of battle.companies) if (c.aliveSoldiers.length && pred(c)) { c.selected = true; battle.selection.add(c); }
    return battle.selection.size;
  };
  const order = (point, cls) => { if (battle.selection.size) battle.orderSelected(point, cls); };
  const assault = (pred, side) => { if (select(pred)) order(V(0, 0), { type: 'assault', side }); };
  const palaceTarget = V(0, 4);
  const handled = [false, false, false, false];
  let lastCity = -Infinity;
  const escaladeSent = [false, false, false];
  const doEscalade = name === 'escalade';

  // ทุกบอท: ยึดกำแพงได้ = ลงเมือง · ประตูนอกเปิดแล้ว = สั่งทุกกองเข้าลานวังทุก 10 วิ
  const followUp = () => {
    for (let s = 0; s < 4; s++) if (battle.captured[s] && !handled[s]) { handled[s] = true; battle.chooseCaptureAction(s, 'descend'); }
    if (doEscalade) {
      for (const ring of [1, 2]) {
        const g = battle.innerGates[ring - 1];
        if (escaladeSent[ring] || g.open || !g.started) continue;
        // ประตูเริ่มถูกฟัน → แบ่งทหารราบครึ่งหนึ่งที่อยู่หน้ากำแพงชั้นนั้นไปพาดบันไดข้ามด้านตะวันออก
        const zone = ring === 1 ? 'city' : 'inner';
        const ready = battle.companies.filter((c) => c.kind === 'inf' && c.ctype !== 'archer' && !c.escalade
          && c.aliveSoldiers.length && c.aliveSoldiers.every((s) => s.zone === zone));
        if (ready.length < 4) continue;
        escaladeSent[ring] = true;
        battle.clearSelection();
        for (const c of ready.slice(0, Math.ceil(ready.length / 2))) { c.selected = true; battle.selection.add(c); }
        const R = CFG.rings[ring];
        order(V(R.half + R.thick / 2, 0), { type: 'escalade', ring, side: 1 });
      }
    }
    if (battle.gate.open && battle.time - lastCity > 10) {
      lastCity = battle.time;
      if (select((c) => !c.escalade)) order(palaceTarget, { type: 'city' });
    }
  };

  if (name === 'brute') {
    // รุมมั่ว: ทุกกองบุกด้านของตัวเองพร้อมกัน
    for (let side = 0; side < 4; side++) assault((c) => c.side === side && c.ctype !== 'cav', side);
    return { tick: followUp };
  }

  // วางแผน (และแม่ทัพที่ใช้แผนเดียวกันเป็นฐาน): หลอกล่อด้านเหนือ/ตะวันตกด้วยพลโล่ · ธนูกดกำแพงสองด้านที่บุก
  // · บุกใต้ (มีรถทุบ) + ตะวันออก · ระลอกสองตามเข้าไป
  const W = CFG.wallHalf + CFG.wallThick;
  for (const side of [0, 3]) if (select((c) => c.side === side && c.ctype === 'shield')) order(worldPoint(side, 0, W + 34, 0), { type: 'field' });
  assault((c) => c.ctype === 'archer' && (c.side === 2 || c.side === 3), 2);
  assault((c) => c.ctype === 'archer' && (c.side === 1 || c.side === 0), 1);
  assault((c) => c.side === 2 && c.ctype !== 'cav' && c.ctype !== 'archer', 2);
  assault((c) => c.side === 1 && (c.ctype === 'spear' || c.ctype === 'shield'), 1);
  let wave2 = false;
  const plannedTick = () => {
    if (!wave2 && battle.time > 40) {
      wave2 = true;
      assault((c) => c.side === 3 && c.ctype === 'spear' && c.state === 'idle', 2);
      assault((c) => c.side === 0 && c.ctype === 'spear' && c.state === 'idle', 1);
    }
    followUp();
  };
  if (name !== 'commander') return { tick: plannedTick };

  // แม่ทัพ: แผนเดียวกับ "วางแผน" + ใช้ท่าแม่ทัพและยุทธปัจจัยเชิงรุกทุกครั้งที่มีสิทธิ์
  // (คัดกองที่กำลังรบ/บุกอยู่จริงมาเป็นเป้าของแต่ละท่า แล้วคืนตัวเลือกให้ plannedTick คุมต่อตามปกติ)
  const useOnFighting = (useFn) => {
    const fighting = battle.companies.filter((c) => c.aliveSoldiers.length
      && (c.state === 'cityMarch' || c.mode === 'city' || c.mode === 'assault'));
    if (!fighting.length) return false;
    battle.clearSelection();
    for (const c of fighting) { c.selected = true; battle.selection.add(c); }
    return useFn();
  };
  return {
    tick() {
      plannedTick();
      if (battle.abilities.hornCd <= 0) useOnFighting(() => battle.useHornRally());
      if (battle.abilities.reinforceCharges > 0) battle.useReinforcementWave();
      if (battle.loadouts.has('fireVolley') && battle.abilities.fireVolleyCd <= 0) useOnFighting(() => battle.useFireVolley());
      battle.clearSelection(); // ไม่ทิ้งตัวเลือกค้างไว้ให้ followUp รอบหน้าสับสน
    },
  };
}
