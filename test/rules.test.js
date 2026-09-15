import test from 'node:test';
globalThis.window ??= {}; // เสียงสังเคราะห์เรียก window เฉพาะตอนเล่นเสียง — ในเทสต์ไม่มีเบราว์เซอร์
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { battleOutcome, canUnitClimb, palaceProgressStep } from '../src/rules.js';
import { formationDestinations, unitSlot } from '../src/formation.js';
import {
  gateRoute, constrainFieldOutsideWall, stairPoints, wallRoute, SIDE_VECS,
  constrainToRegion, regionOf, classifyOrderPoint, gateFrontPoint, gateInsidePoint, RINGS,
} from '../src/world.js';
import { CFG, mulberry32 } from '../src/config.js';
import { Battle, orderVisual, cityRallyPoint } from '../src/battle.js';
import { buildCity, gateDoorAngle } from '../src/city.js';
import { assaultRoute } from '../src/navigation.js';
import { fieldRoute, routeLength, routeBetween } from '../src/navigation.js';
import { createOrder, ORDER_KIND, orderKindFromContext } from '../src/orders.js';
import { SpatialHash } from '../src/spatial-hash.js';
import { EngagementRegistry } from '../src/engagement.js';
import { DefenseSide, ReserveForce, Garrison } from '../src/defense.js';
import { chooseTacticalTarget, targetScore } from '../src/tactical-ai.js';
import { BATTLEFIELD_CLEAR_RADIUS, mountainSpec } from '../src/scene.js';
import { Company } from '../src/company.js';

test('victory comes from holding the innermost palace courtyard, not from wiping out the city', () => {
  const base = { attackersAlive: 10, time: 10, timeLimit: 20 };
  assert.equal(battleOutcome({ ...base, palaceProgress: 0.99 }), null);
  assert.equal(battleOutcome({ ...base, palaceProgress: 1 }), 'win');
  assert.equal(battleOutcome({ ...base, attackersAlive: 0 }), 'lose_dead');
  assert.equal(battleOutcome({ ...base, time: 21 }), 'lose_time');
});

test('palace progress only advances while attackers outnumber the guards in the courtyard', () => {
  const opts = CFG.palace;
  assert.ok(palaceProgressStep(0, 5, 2, 1, opts) > 0);
  assert.equal(palaceProgressStep(0, 5, 5, 1, opts), 0);
  assert.equal(palaceProgressStep(0, opts.minHolders - 1, 0, 1, opts), 0);
  assert.ok(palaceProgressStep(0.5, 1, 4, 1, opts) < 0.5, 'contested courtyard slowly loses progress');
  let p = 0;
  for (let t = 0; t < opts.holdTime + 0.5; t += 0.5) p = palaceProgressStep(p, 10, 0, 0.5, opts);
  assert.equal(p, 1);
});

test('mission RNG repeats exactly for the same seed', () => {
  const a = mulberry32(42), b = mulberry32(42);
  assert.deepEqual(Array.from({ length: 20 }, a), Array.from({ length: 20 }, b));
});

test('starting armies keep their intended size across the three-ring city', () => {
  const attackerInfantry = CFG.army.composition.length * 4 * 10;
  const attackerRams = CFG.army.ramCompanies * CFG.unit.ram.crew;
  const attackerCavalry = CFG.army.cavalryCompanies * CFG.army.cavalryPerCompany;
  const guards = (plan) => plan.shields + plan.spears + plan.cav + plan.archersPerSide * 4;
  const defenders = 4 * (CFG.wallMelee + CFG.wallArchers + CFG.rockLogi.carriers)
    + CFG.reserveSquads * CFG.squadSize
    + guards(CFG.garrison.inner) + guards(CFG.garrison.palace);
  assert.equal(attackerInfantry + attackerRams + attackerCavalry, 1956);
  assert.equal(defenders, 1238);
});

test('move and attack orders use unmistakably different map symbols', () => {
  const move = orderVisual('field');
  const attack = orderVisual('assault');
  assert.equal(move.icon, '👣');
  assert.equal(move.iconColor, '#ffffff');
  assert.equal(attack.icon, '⚔');
  assert.notEqual(move.color, attack.color);
});

test('background mountains stay outside the full deployment area', () => {
  for (let i = 0; i < 10; i++) {
    const mountain = mountainSpec(i);
    assert.ok(mountain.centerRadius - mountain.baseRadius >= BATTLEFIELD_CLEAR_RADIUS,
      `mountain ${i} enters the battlefield`);
  }
});

test('a multi-company order gives every company a distinct destination', () => {
  const companies = Array.from({ length: 9 }, (_, i) => ({ anchor: new THREE.Vector3(i, 0, 90) }));
  const points = formationDestinations(companies, new THREE.Vector3(0, 0, 70));
  assert.equal(new Set(points.map((p) => `${p.x.toFixed(2)}|${p.z.toFixed(2)}`)).size, 9);
});

test('individual formation slots do not overlap', () => {
  const slots = Array.from({ length: 10 }, (_, i) => unitSlot(i, 10));
  assert.equal(new Set(slots.map((s) => `${s.lateral}|${s.depth}`)).size, 10);
});

test('gate routes stay outside the wall ring', () => {
  const starts = [
    new THREE.Vector3(10, 0, -90),
    new THREE.Vector3(90, 0, 10),
    new THREE.Vector3(-90, 0, 10),
  ];
  for (const [side, start] of [[0, starts[0]], [1, starts[1]], [3, starts[2]]]) {
    for (const p of gateRoute(side, start)) {
      assert.ok(Math.max(Math.abs(p.x), Math.abs(p.z)) > CFG.wallHalf + CFG.wallThick);
    }
  }
});

test('gate route follows the current position even when the old assault side is stale', () => {
  const north = new THREE.Vector3(-24, 0, -90);
  const route = gateRoute(2, north);
  assert.ok(route.length >= 2, 'north-side soldiers still need an around-wall route');
  assert.ok(route[0].x < 0, 'the shorter west route should be selected from the current position');
});

test('open gate routing chooses the shorter valid side around the wall', () => {
  const from = new THREE.Vector3(34, 0, -88);
  const target = cityRallyPoint();
  const route = fieldRoute(from, target, [0, 0, 0, 0], true);
  assert.ok(route[0].x > 0, 'the closer east corner should be used');
  const c = CFG.wallHalf + CFG.wallThick + 4;
  const longWay = [
    new THREE.Vector3(-c, 0, -c), new THREE.Vector3(-c, 0, c),
    new THREE.Vector3(0, 0, CFG.gate.frontPoint),
    new THREE.Vector3(0, 0, CFG.gate.insidePoint), target,
  ];
  assert.ok(routeLength(from, route) < routeLength(from, longWay), 'route should not circle the long side of the city');
});

test('cavalry outside an open gate keeps a portal route until it physically enters', () => {
  const battle = { rng: () => 0.5, group: new THREE.Group(), gate: { open: true }, time: 1, onEvent() {}, wallThreats: () => [0, 0, 0, 0] };
  const cavalry = new Company(0, 0, 'cav', new THREE.Vector3(26, 0, -90), battle);
  assert.equal(cavalry.orderRide(cityRallyPoint()), true);
  assert.equal(cavalry.enteredCity, false);
  assert.ok(cavalry.waypoints.length >= 4);
  assert.ok(cavalry.waypoints[0].x > 0);
  assert.equal(cavalry.pendingGate, null);
});

test('cavalry ordered into the palace waits at the first closed inner gate, then rides on', () => {
  const events = [];
  const battle = {
    rng: () => 0.5, group: new THREE.Group(), gate: { open: true }, time: 1, onEvent: (t, d) => events.push([t, d]),
    wallThreats: () => [0, 0, 0, 0], gatesOpen: () => [true, false, false],
  };
  const cavalry = new Company(0, 2, 'cav', cityRallyPoint(), battle);
  for (const s of cavalry.soldiers) s.zone = 'city';
  assert.equal(cavalry.orderRide(new THREE.Vector3(0, 0, 0)), true);
  assert.equal(cavalry.pendingGate, 1);
  assert.ok(cavalry.waypoints.at(-1).distanceTo(gateFrontPoint(1)) < 0.01);
  assert.equal(events.at(-1)[0], 'cav_wait_gate');
});

test('field units cannot remain inside a closed wall', () => {
  const p = new THREE.Vector3(CFG.wallHalf + 3, 0, 3);
  constrainFieldOutsideWall(p, false);
  assert.ok(Math.max(Math.abs(p.x), Math.abs(p.z)) > CFG.wallHalf + CFG.wallThick);
});

test('wall archers cannot reach the initial deployment line', () => {
  const nearestInitialDistance = CFG.spawnDist - (CFG.wallHalf + CFG.wallThick / 2);
  assert.ok(CFG.archerRange < nearestInitialDistance);
  const attackerVolleyDistance = CFG.unit.atkArch.standDist - (CFG.wallHalf + CFG.wallThick / 2);
  assert.ok(CFG.archerRange >= attackerVolleyDistance);
});

test('all infantry roles except archers can climb', () => {
  assert.equal(canUnitClimb('spear'), true);
  assert.equal(canUnitClimb('shield'), true);
  assert.equal(canUnitClimb('ram'), true);
  assert.equal(canUnitClimb('archer'), false);
  assert.equal(canUnitClimb('cav'), false);
});

test('cavalry joins and leaves city combat tracking', () => {
  const battle = { cityAttackers: new Set() };
  const cavalry = { kind: 'cav', zone: 'city' };
  Battle.prototype.onCavEnteredCity.call(battle, cavalry);
  assert.equal(battle.cityAttackers.has(cavalry), true);
  Battle.prototype.onCavLeftCity.call(battle, cavalry);
  assert.equal(battle.cityAttackers.has(cavalry), false);
});

test('double-click selection keeps only nearby companies of the same type', () => {
  const make = (ctype, x) => ({
    ctype,
    flagPos: new THREE.Vector3(x, 0, 0),
    aliveSoldiers: [{}],
    selected: false,
  });
  const spear = make('spear', 0);
  const nearbySpear = make('spear', 30);
  const farSpear = make('spear', 60);
  const nearbyShield = make('shield', 10);
  const battle = {
    companies: [spear, nearbySpear, farSpear, nearbyShield],
    selection: new Set(),
    clearSelection: Battle.prototype.clearSelection,
  };
  const count = Battle.prototype.selectNearbySameType.call(battle, spear, 45);
  assert.equal(count, 2);
  assert.deepEqual([...battle.selection], [spear, nearbySpear]);
});

test('city gate opens from closed to a realistic right angle', () => {
  assert.equal(gateDoorAngle(0), 0);
  assert.ok(gateDoorAngle(0.5) > 0 && gateDoorAngle(0.5) < gateDoorAngle(1));
  assert.ok(gateDoorAngle(1) > 1.4 && gateDoorAngle(1) < Math.PI / 2);
});

test('fully opened gate leaves a clear passage through the south wall', () => {
  const scene = new THREE.Scene();
  const city = buildCity(scene);
  city.doorL.rotation.y = gateDoorAngle(1);
  city.doorR.rotation.y = -gateDoorAngle(1);
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(0, 4, CFG.wallHalf + CFG.wallThick + 8),
    new THREE.Vector3(0, 0, -1),
    0,
    CFG.wallThick + 12,
  );
  assert.equal(ray.intersectObject(city.group, true).length, 0);
});

test('opened inner gates leave a clear passage through each inner ring', () => {
  const scene = new THREE.Scene();
  const city = buildCity(scene);
  for (const g of city.gates) { g.doorL.rotation.y = gateDoorAngle(1); g.doorR.rotation.y = -gateDoorAngle(1); }
  scene.updateMatrixWorld(true);
  for (let ring = 1; ring < RINGS.length; ring++) {
    const R = RINGS[ring];
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 3, R.half + R.thick + 4), new THREE.Vector3(0, 0, -1), 0, R.thick + 6);
    assert.equal(ray.intersectObject(city.group, true).length, 0, `ring ${ring} gate passage is blocked`);
  }
});

test('inner stairs run beside the inner wall face and land on the wall walk', () => {
  for (let side = 0; side < 4; side++) {
    const { base, top, landing } = stairPoints(side);
    const rise = top.y - base.y;
    const run = Math.hypot(top.x - base.x, top.z - base.z);
    assert.ok(Math.atan2(rise, run) < Math.PI / 4);
    const v = SIDE_VECS[side];
    for (let k = 0; k <= 20; k++) {
      const p = base.clone().lerp(top, k / 20);
      assert.ok(v.n.dot(p) + 2 <= CFG.wallHalf, 'stair flight (4 m wide) cuts into the wall body');
    }
    assert.equal(top.y, CFG.walkY);
    assert.equal(landing.y, CFG.walkY);
    assert.ok(v.n.dot(landing) >= CFG.wallHalf + 0.8 && v.n.dot(landing) <= CFG.wallHalf + CFG.wallThick - 0.8);
    const delta = top.clone().sub(base);
    assert.ok(Math.abs(v.t.dot(delta)) > Math.abs(v.n.dot(delta)) * 5.5);
  }
});

test('siege ladders lean on the outer wall face and rise above the battlements', () => {
  const battle = {
    rng: () => 0.5, group: new THREE.Group(), gate: { open: false }, time: 0, nextLadderId: 0,
    wallThreats: () => [0, 0, 0, 0], assignPlantSlot: () => 10, onEvent() {},
  };
  const company = new Company(0, 2, 'spear', new THREE.Vector3(0, 0, 130), battle);
  assert.equal(company.orderAssault(2), true);
  const { base, top, len } = company.ladder;
  const n = SIDE_VECS[2].n;
  const face = CFG.wallHalf + CFG.wallThick;
  assert.ok(top.y > CFG.wallH + 1.5, 'ladder top should clear the battlements');
  for (let k = 0; k <= 40; k++) {
    assert.ok(n.dot(base.clone().lerp(top, k / 40)) > face, 'ladder passes through the wall');
  }
  const angle = Math.atan2(top.y - base.y, n.dot(base) - n.dot(top));
  assert.ok(angle > 1.2 && angle < 1.4, 'ladder should lean at a climbable 70-80 degrees');
  assert.ok(Math.abs(len - base.distanceTo(top)) < 1e-6, 'ladder mesh must not overshoot into the wall');
});

test('escalade ladders lean on inner walls without entering the wall or its tiled roof', () => {
  for (let ring = 1; ring < RINGS.length; ring++) {
    const battle = {
      rng: () => 0.5, group: new THREE.Group(), gate: { open: true }, time: 0,
      wallThreats: () => [0, 0, 0, 0], gatesOpen: () => [true, true, false], onEvent() {},
    };
    const R = RINGS[ring];
    const start = ring === 1 ? cityRallyPoint() : new THREE.Vector3(0, 0, 30);
    const company = new Company(0, 2, 'spear', start, battle);
    for (const s of company.soldiers) s.zone = ring === 1 ? 'city' : 'inner';
    assert.equal(company.orderEscalade(ring, new THREE.Vector3(10, 0, R.half + R.thick / 2)), true);
    const { foot, top } = company.escalade;
    const n = SIDE_VECS[2].n;
    assert.ok(top.y > R.h + 0.45, `ring ${ring} ladder should reach over the wall top`);
    for (let k = 0; k <= 40; k++) {
      assert.ok(n.dot(foot.clone().lerp(top, k / 40)) >= R.half + R.thick + 0.45, `ring ${ring} ladder clips the wall or roof tiles`);
    }
  }
});

test('wall reinforcement routes stay on the wall ring for every side pair', () => {
  for (let from = 0; from < 4; from++) for (let to = 0; to < 4; to++) {
    for (const p of wallRoute(from, to)) {
      const edge = Math.max(Math.abs(p.x), Math.abs(p.z));
      assert.ok(edge >= CFG.wallHalf && edge <= CFG.wallHalf + CFG.wallThick);
      assert.equal(p.y, CFG.walkY);
    }
  }
});

test('city pursuit can target melee, archers, carriers, and reserves', () => {
  const unit = (utype, x) => ({ utype, alive: true, zone: 'city', pos: new THREE.Vector3(x, 0, 0) });
  const reserve = unit('def', 30);
  const melee = unit('def', 20);
  const archer = unit('archer', 10);
  const carrier = unit('carrier', 5);
  const battle = {
    reserves: { squads: [{ soldiers: [reserve] }] },
    defenses: [{ melee: [melee], archers: [archer], carriers: [{ s: carrier }] }],
  };
  assert.equal(Battle.prototype.nearestCityDefender.call(battle, new THREE.Vector3(), 180), carrier);
  carrier.alive = false;
  assert.equal(Battle.prototype.nearestCityDefender.call(battle, new THREE.Vector3(), 180), archer);
});

test('cross-side assault routes stay outside the wall until final approach', () => {
  const starts = [
    new THREE.Vector3(0, 0, -90), new THREE.Vector3(90, 0, 0),
    new THREE.Vector3(0, 0, 90), new THREE.Vector3(-90, 0, 0),
  ];
  for (let fromSide = 0; fromSide < 4; fromSide++) for (let toSide = 0; toSide < 4; toSide++) {
    if (fromSide === toSide) continue;
    const target = new THREE.Vector3().addScaledVector(SIDE_VECS[toSide].n, CFG.wallHalf + CFG.wallThick + 5);
    const route = assaultRoute(starts[fromSide], toSide, target);
    assert.ok(route.length >= 2, `route ${fromSide}->${toSide} needs safe perimeter waypoints`);
    for (const p of route.slice(0, -1)) {
      assert.ok(Math.max(Math.abs(p.x), Math.abs(p.z)) >= CFG.wallHalf + CFG.wallThick + 3);
    }
    const approach = route.at(-1).clone().sub(route.at(-2)).normalize();
    assert.ok(approach.dot(SIDE_VECS[toSide].n.clone().multiplyScalar(-1)) > 0.9);
  }
});

test('explicit orders clone their route and normalize tactical options', () => {
  const point = new THREE.Vector3(10, 0, 20);
  const order = createOrder({ kind: ORDER_KIND.MOVE, targetPoint: point, route: [point], formation: 'invalid', stance: 'invalid' });
  point.x = 999;
  assert.equal(order.targetPoint.x, 10);
  assert.equal(order.route[0].x, 10);
  assert.equal(order.formation, 'line');
  assert.equal(order.stance, 'aggressive');
  assert.equal(orderKindFromContext({ type: 'city' }, true), ORDER_KIND.ENTER_GATE);
});

test('general field movement routes around the closed wall', () => {
  const from = new THREE.Vector3(0, 0, -90);
  const target = new THREE.Vector3(0, 0, 90);
  const route = fieldRoute(from, target, [0, 0, 0, 0], false);
  assert.ok(route.length >= 3);
  for (const p of route.slice(0, -1)) {
    assert.ok(Math.max(Math.abs(p.x), Math.abs(p.z)) > CFG.wallHalf + CFG.wallThick);
  }
  assert.ok(routeLength(from, route) < CFG.wallHalf * 8, 'route should not take an absurd detour around the city');
});

test('spatial hash only returns nearby units', () => {
  const hash = new SpatialHash(4);
  const near = { alive: true, pos: new THREE.Vector3(2, 0, 1) };
  const far = { alive: true, pos: new THREE.Vector3(30, 0, 30) };
  hash.rebuild([near, far]);
  assert.deepEqual(hash.query(new THREE.Vector3(), 4), [near]);
});

test('engagement registry enforces frontage and releases dead targets', () => {
  const registry = new EngagementRegistry();
  const target = { alive: true, kind: 'inf', zone: 'city', pos: new THREE.Vector3() };
  const attackers = Array.from({ length: 4 }, (_, id) => ({ id, alive: true, zone: 'city' }));
  assert.ok(registry.claim(attackers[0], target, 3));
  assert.ok(registry.claim(attackers[1], target, 3));
  assert.ok(registry.claim(attackers[2], target, 3));
  assert.equal(registry.claim(attackers[3], target, 3), null);
  target.alive = false;
  registry.cleanup();
  assert.equal(registry.byAttacker.size, 0);
});

test('column and loose formations have distinct geometry', () => {
  const column = Array.from({ length: 10 }, (_, i) => unitSlot(i, 10, 1.5, 'column'));
  const loose = Array.from({ length: 10 }, (_, i) => unitSlot(i, 10, 1.5, 'loose'));
  assert.ok(Math.max(...column.map((s) => Math.abs(s.lateral))) < 1);
  assert.ok(Math.max(...loose.map((s) => Math.abs(s.lateral))) > 3);
});

test('wall reinforcement count is reported per side', () => {
  const make = (side, state, alive = true) => ({ side, state, soldiers: [{ alive }, { alive }] });
  const reserves = { squads: [make(0, 'toStair'), make(1, 'ascending'), make(0, 'idle')] };
  assert.equal(ReserveForce.prototype.enRouteMen.call(reserves, 0), 2);
  assert.equal(ReserveForce.prototype.enRouteMen.call(reserves, 1), 2);
  assert.equal(ReserveForce.prototype.enRouteMen.call(reserves), 4);
});

test('rock carriers have distinct visible staging positions', () => {
  const defense = { side: 2 };
  const positions = Array.from({ length: CFG.rockLogi.carriers }, (_, slot) =>
    DefenseSide.prototype.stockPoint.call(defense, slot));
  assert.equal(new Set(positions.map((p) => `${p.x.toFixed(2)}|${p.z.toFixed(2)}`)).size, positions.length);
  for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
    assert.ok(positions[i].distanceTo(positions[j]) >= CFG.movement.infantryRadius * 2);
  }
});

test('routes leaving the city use the open gate portal', () => {
  const from = new THREE.Vector3(0, 0, CFG.wallHalf - 8);
  const target = new THREE.Vector3(0, 0, -90);
  const route = fieldRoute(from, target, [0, 0, 0, 0], true);
  assert.ok(route[0].distanceTo(new THREE.Vector3(0, 0, CFG.gate.insidePoint)) < 0.01);
  assert.ok(route[1].distanceTo(new THREE.Vector3(0, 0, CFG.gate.frontPoint)) < 0.01);
});

test('cavalry tactical AI prioritizes exposed archers over generic infantry', () => {
  const attacker = { utype: 'cav', faction: 'atk', zone: 'city', pos: new THREE.Vector3() };
  const infantry = { utype: 'def', faction: 'def', zone: 'city', alive: true, hp: 9, hpMax: 9, pos: new THREE.Vector3(3, 0, 0) };
  const archer = { utype: 'archer', faction: 'def', zone: 'city', alive: true, hp: 3, hpMax: 3, pos: new THREE.Vector3(8, 0, 0) };
  assert.ok(targetScore(attacker, archer, 8) > targetScore(attacker, infantry, 3));
  assert.equal(chooseTacticalTarget(attacker, [infantry, archer], 30), archer);
});

test('first attackers descending into a closed city receive gate duty', () => {
  const soldier = { faction: 'atk', alive: true, zone: 'wall', state: 'wall', pos: new THREE.Vector3() };
  const battle = {
    gate: { open: false },
    gateOpeners: new Set(),
    wallFighters: [new Set([soldier]), new Set(), new Set(), new Set()],
    cityAttackers: new Set(),
  };
  Battle.prototype.onStairBottomArrived.call(battle, 0, soldier);
  assert.equal(soldier.gateDuty, true);
  assert.equal(battle.gateOpeners.has(soldier), true);
  assert.equal(battle.cityAttackers.has(soldier), true);
});

test('capture directive holds troops or releases them to descend', () => {
  const held = { alive: true, stair: null, state: 'wall', intent: '', waypoints: null };
  const events = [];
  const battle = {
    captured: [true, false, false, false],
    captureDirective: ['pending', null, null, null],
    wallFighters: [new Set([held]), new Set(), new Set(), new Set()],
    onEvent: (type, data) => events.push([type, data]),
    assignWallSupport() {},
  };
  assert.equal(Battle.prototype.chooseCaptureAction.call(battle, 0, 'hold'), true);
  assert.equal(held.intent, 'hold-captured-wall');
  assert.equal(held.wallSupport, true);
  assert.equal(events.at(-1)[0], 'capture_action');
});

test('a held captured-wall company accepts a later city descent order', () => {
  const soldier = {
    alive: true, stair: null, zone: 'wall', state: 'wall', side: 0,
    wallSupport: true, wallObjectiveSide: 0, intent: 'hold-captured-wall',
  };
  const company = {
    ctype: 'spear', kind: 'inf', isLadderCarrier: true,
    aliveSoldiers: [soldier],
  };
  soldier.company = company;
  const events = [];
  const battle = {
    selection: new Set([company]),
    captured: [true, false, false, false],
    captureDirective: ['hold', null, null, null],
    wallFighters: [new Set([soldier]), new Set(), new Set(), new Set()],
    gate: { open: false },
    commandFormation: 'column', commandStance: 'aggressive',
    clearOrderPreview() {}, spawnMarker() {},
    issueAssault() { return 0; },
    orderWallCompaniesToCity(...args) {
      return Battle.prototype.orderWallCompaniesToCity.call(this, ...args);
    },
    onEvent: (type, data) => events.push([type, data]),
  };

  Battle.prototype.orderSelected.call(battle, new THREE.Vector3(0, 0, 0), { type: 'city' });

  assert.equal(soldier.wallSupport, false);
  assert.equal(soldier.forceCityDescent, true);
  assert.equal(soldier.intent, 'descend-to-city');
  assert.equal(events.at(-1)[0], 'order_result');
  assert.equal(events.at(-1)[1].n, 1);
});

test('company corridor makes a trailing company yield without deadlocking the leader', () => {
  const leader = { id: 1, state: 'march', anchor: new THREE.Vector3(0, 0, 0), waypoints: [new THREE.Vector3(0, 0, -30)] };
  const trailing = { id: 2, state: 'march', anchor: new THREE.Vector3(0, 0, 8), waypoints: [new THREE.Vector3(0, 0, -30)] };
  const battle = { companies: [leader, trailing] };
  const direction = new THREE.Vector3(0, 0, -1);
  assert.equal(Battle.prototype.canCompanyAdvance.call(battle, trailing, direction), false);
  assert.equal(Battle.prototype.canCompanyAdvance.call(battle, leader, direction), true);
});

test('shield-front company formation places shield companies in the leading rank', () => {
  const companies = [
    ...Array.from({ length: 8 }, (_, i) => ({ ctype: 'spear', anchor: new THREE.Vector3(i, 0, 30) })),
    { ctype: 'shield', anchor: new THREE.Vector3(9, 0, 30) },
  ];
  const target = new THREE.Vector3(0, 0, 0);
  const points = formationDestinations(companies, target, 10, 'shield-front');
  const forward = target.clone().sub(companies.reduce((v, c) => v.add(c.anchor), new THREE.Vector3()).multiplyScalar(1 / companies.length)).normalize();
  assert.ok(points[8].clone().sub(target).dot(forward) > points[7].clone().sub(target).dot(forward));
});

test('archers automatically claim an abandoned intact ram when every ram crew is dead', () => {
  const abandonedRam = {
    ctype: 'ram', aliveSoldiers: [], ramMesh: {}, ramHp: 120,
    ramClaimedBy: null, anchor: new THREE.Vector3(0, 0, 55),
  };
  let claimed = null;
  const archer = {
    ctype: 'archer', aliveSoldiers: [{}], gateCrew: false,
    anchor: new THREE.Vector3(0, 0, 80),
    takeOverRam(ram) { claimed = ram; ram.ramClaimedBy = this; return true; },
  };
  const battle = { gate: { open: false }, companies: [abandonedRam, archer] };
  assert.equal(Battle.prototype.assignArcherRamFallback.call(battle), true);
  assert.equal(claimed, abandonedRam);
});

test('an archer company can rearm as spear infantry after a wall is captured', () => {
  const battle = { rng: () => 0.5, group: new THREE.Group() };
  const company = new Company(0, 2, 'archer', new THREE.Vector3(0, 0, 90), battle);
  assert.equal(company.rearmAsSpear(), true);
  assert.equal(company.ctype, 'spear');
  assert.equal(company.isLadderCarrier, true);
  assert.ok(company.soldiers.every((s) => s.utype === 'spear'
    && s.hpMax === CFG.unit.spear.hp && s.forceCityAfterCapture));
});

test('capturing a wall rearms its supporting archers and sends them to the city route', () => {
  const events = [];
  const battle = {
    rng: () => 0.5,
    group: new THREE.Group(),
    gate: { open: false },
    time: 30,
    assignPlantSlot: () => 0,
    wallThreats: () => [0, 0, 0, 0],
    onEvent: (type, data) => events.push([type, data]),
  };
  const company = new Company(0, 1, 'archer', new THREE.Vector3(90, 0, 0), battle);
  battle.companies = [company];
  assert.equal(Battle.prototype.rearmArchersAfterCapture.call(battle, 1), 10);
  assert.equal(company.ctype, 'spear');
  assert.equal(company.state, 'march');
  assert.ok(company.ladder);
  assert.equal(events.at(-1)[0], 'archer_rearmed');
});

test('attacker archers can target enemy soldiers on walls, in the city, and in the field', () => {
  const make = (utype, zone) => ({ utype, zone, alive: true, faction: 'def' });
  const wall = make('def', 'wall');
  const cityMelee = make('def', 'city');
  const cityArcher = make('archer', 'city');
  const carrier = make('carrier', 'city');
  const reserve = make('def', 'city');
  const sally = make('sally', 'field');
  const battle = {
    gate: { open: true },
    wallDefenders: () => [wall],
    defenses: [{ melee: [cityMelee], archers: [cityArcher], carriers: [{ s: carrier }] }],
    reserves: { squads: [{ soldiers: [reserve] }] },
    sally: { horses: [sally] },
  };
  assert.deepEqual(Battle.prototype.attackerArcherTargets.call(battle),
    [wall, cityMelee, cityArcher, carrier, reserve, sally]);
});

test('a replacement archer crew rearms and enters the city when the gate opens', () => {
  let entered = false, ramRemoved = false;
  let forceCityAfterCapture;
  const company = {
    ctype: 'archer', gateCrew: true, ramSource: null, ramMesh: {}, state: 'battering',
    aliveSoldiers: [{}],
    rearmAsSpear(forceCity) {
      forceCityAfterCapture = forceCity;
      this.ctype = 'spear';
      return true;
    },
    destroyRamMesh() { this.ramMesh = null; ramRemoved = true; },
    orderCity() { entered = true; return true; },
  };
  Battle.prototype.releaseGateAssaultCompanies.call({ companies: [company] });
  assert.equal(company.ctype, 'spear');
  assert.equal(forceCityAfterCapture, false);
  assert.equal(company.gateCrew, false);
  assert.equal(ramRemoved, true);
  assert.equal(entered, true);
});

test('opening the gate automatically reroutes grounded south assault troops into the city', () => {
  const entered = [];
  const make = (overrides = {}) => ({
    kind: 'inf', ctype: 'spear', mode: 'assault', side: 2, state: 'march', enteredCity: false,
    aliveSoldiers: [{ zone: 'field' }],
    orderable() { return true; },
    orderCity(point) { entered.push({ company: this, point }); return true; },
    ...overrides,
  });
  const south = make();
  const archer = make({ ctype: 'archer' });
  const climbing = make({ state: 'climbing', orderable() { return false; } });
  const otherWall = make({ side: 1 });
  const battle = { companies: [south, archer, climbing, otherWall], rerouteBlockedCompanies: Battle.prototype.rerouteBlockedCompanies };
  const count = Battle.prototype.routeOpenGateAttackers.call(battle);
  assert.equal(count, 1);
  assert.equal(entered[0].company, south);
  assert.ok(Math.max(Math.abs(entered[0].point.x), Math.abs(entered[0].point.z)) < CFG.wallHalf);
});

test('city march leaves fighting soldiers to melee combat and still completes', () => {
  const battle = {
    rng: () => 0.5, group: new THREE.Group(), gate: { open: true }, time: 0,
    wallThreats: () => [0, 0, 0, 0], onEvent() {}, onInfEnteredCity() {}, onInfLeftCity() {},
  };
  const company = new Company(0, 2, 'spear', new THREE.Vector3(0, 0, 55), battle);
  for (const s of company.soldiers) s.zone = 'city';
  assert.equal(company.orderCity(new THREE.Vector3(0, 0, 50)), true);
  const fighter = company.soldiers[3];
  fighter.pos.set(20, 0, 58);
  const before = fighter.pos.clone();
  for (let i = 0; i < 200; i++) {
    fighter.inCombat = true; // melee loop ตั้งค่านี้ทุกเฟรมที่ทหารกำลังประชิดศัตรู
    battle.time += 0.1;
    company.update(0.1);
  }
  assert.ok(fighter.pos.equals(before), 'company dragged a soldier out of his fight');
  assert.equal(company.state, 'holdAt');
  assert.equal(fighter.zone, 'city');
});

test('entering the city is shown as an attack order', () => {
  assert.equal(orderVisual('city').kind, 'attack');
});

test('city orders pack every company around the clicked point inside the walls', () => {
  const companies = Array.from({ length: 30 }, (_, i) => ({ anchor: new THREE.Vector3(i * 3 - 45, 0, 90) }));
  const points = Battle.prototype.cityOrderDestinations.call({}, companies, new THREE.Vector3(5, 0, 39));
  assert.equal(points.length, 30);
  for (const p of points) {
    assert.ok(Math.max(Math.abs(p.x), Math.abs(p.z)) <= CFG.wallHalf - 4, 'destination left the city interior');
    assert.ok(p.distanceTo(new THREE.Vector3(5, 0, 36)) < 30, 'destination strayed far from the click');
  }
});

test('wall defender counts follow real positions from any side and ignore the city', () => {
  const unit = (zone, x, y, z) => ({ alive: true, zone, stair: null, pos: new THREE.Vector3(x, y, z) });
  const battle = {
    wallDefenderCounts: [9, 9, 9, 9],
    defenses: [
      { melee: [unit('wall', 0, CFG.walkY, CFG.wallHalf + 4), unit('city', 0, 0, CFG.wallHalf - 10)], archers: [] },
      { melee: [], archers: [unit('wall', CFG.wallHalf + 4, CFG.walkY, 0)] },
    ],
  };
  Battle.prototype.refreshWallDefenders.call(battle);
  assert.deepEqual(battle.wallDefenderCounts, [0, 1, 1, 0]);
});

test('idle city attackers climb the inner stair toward defenders left on a wall', () => {
  const battle = {
    wallDefenderCounts: [0, 0, 3, 0],
    stairAssaultEnRoute: [0, 0, 0, 0],
    engagements: new EngagementRegistry(),
    sendUpInnerStair: Battle.prototype.sendUpInnerStair,
  };
  const spear = { kind: 'inf', pos: new THREE.Vector3(0, 0, 10), state: 'order' };
  const horse = { kind: 'cav', pos: new THREE.Vector3(0, 0, 10), state: 'order' };
  assert.equal(Battle.prototype.autoClimbToWall.call(battle, spear), true);
  assert.equal(spear.state, 'toStairUp');
  assert.equal(spear.stairClimbSide, 2);
  assert.equal(Battle.prototype.autoClimbToWall.call(battle, horse), false);
});

test('an attacker reaching the top of an inner stair joins the wall fight', () => {
  const s = { faction: 'atk', zone: 'stair', state: 'stairUp', pos: new THREE.Vector3(), wallObjectiveSide: 1 };
  const battle = { cityAttackers: new Set([s]), wallFighters: [0, 1, 2, 3].map(() => new Set()) };
  Battle.prototype.onStairTopArrived.call(battle, 0, s);
  assert.equal(s.zone, 'wall');
  assert.equal(battle.wallFighters[0].has(s), true);
  assert.equal(battle.cityAttackers.has(s), false);
  assert.equal(s.wallSupport, true);
  assert.ok(s.waypoints.at(-1).distanceTo(wallRoute(0, 1).at(-1)) < 0.001);
});

test('inner-stair climbers head back down once no wall defender remains', () => {
  const s = { alive: true, stair: null, wallSupport: true, wallObjectiveSide: 2, stairAssault: true, pos: new THREE.Vector3(0, CFG.walkY, CFG.wallHalf + 4) };
  const battle = {
    wallFighters: [new Set(), new Set(), new Set([s]), new Set()],
    wallDefenderCounts: [0, 0, 0, 0],
    nearestDefendedWall: Battle.prototype.nearestDefendedWall,
  };
  Battle.prototype.updateWallSupport.call(battle);
  assert.equal(s.wallSupport, false);
  assert.equal(s.forceCityDescent, true);
});

test('a broken ladder never pulls soldiers who already reached the wall back into the ladder queue', () => {
  const battle = {
    rng: () => 0.5, group: new THREE.Group(), gate: { open: false }, time: 0, nextLadderId: 0,
    wallThreats: () => [0, 0, 0, 0], assignPlantSlot: () => 0, onEvent() {},
  };
  const company = new Company(0, 1, 'spear', new THREE.Vector3(90, 0, 0), battle);
  assert.equal(company.orderAssault(1), true);
  const onWall = company.soldiers[0];
  onWall.zone = 'wall';
  onWall.state = 'toStair';
  company.onLadderBroken();
  assert.equal(onWall.state, 'toStair');
  company.resetLadderTo(1, 0);
  company.plantLadder();
  assert.equal(onWall.state, 'toStair');
  assert.equal(company.soldiers[1].state, 'waitBase');

  // ทุกคนพ้นพื้นแล้ว (บนกำแพง/ในเมือง) → กองต้องกลับมาสั่งได้ ไม่ค้างสถานะ climbing
  for (const s of company.soldiers) { s.zone = s === onWall ? 'wall' : 'city'; s.state = 'order'; }
  company.updateClimbing(0.1);
  assert.equal(company.state, 'done');
  assert.equal(company.orderable(), true);
});

test('reserve squads stop climbing toward a wall that has just been captured', () => {
  const soldier = { alive: true, inCombat: false, stair: null, pos: new THREE.Vector3(), state: 'order' };
  const sq = { state: 'toStair', side: 2, soldiers: [soldier] };
  ReserveForce.prototype.updateSquad.call({ battle: { captured: [false, false, true, false] } }, sq);
  assert.equal(sq.state, 'idle');
});

test('routes into the palace pass every gate in order and stop at the first closed one', () => {
  const from = cityRallyPoint();
  const target = new THREE.Vector3(0, 0, -4);
  const blocked = routeBetween(from, target, [0, 0, 0, 0], [true, false, false]);
  assert.equal(blocked.blockedAt, 1);
  assert.ok(blocked.at(-1).distanceTo(gateFrontPoint(1)) < 0.01);
  const open = routeBetween(from, target, [0, 0, 0, 0], [true, true, true]);
  assert.equal(open.blockedAt, undefined);
  const idx = (p) => open.findIndex((q) => q.distanceTo(p) < 0.01);
  assert.ok(idx(gateFrontPoint(1)) < idx(gateInsidePoint(1)));
  assert.ok(idx(gateInsidePoint(1)) < idx(gateFrontPoint(2)));
  assert.ok(idx(gateFrontPoint(2)) < idx(gateInsidePoint(2)));
  assert.equal(regionOf(open.at(-1)), 3);
});

test('routes inside the outer city walk around the inner wall instead of through it', () => {
  const from = new THREE.Vector3(0, 0, -55);
  const target = cityRallyPoint();
  const route = routeBetween(from, target, [0, 0, 0, 0], [true, false, false]);
  let prev = from;
  const R = RINGS[1];
  for (const p of route) {
    for (let k = 1; k < 20; k++) {
      const x = prev.x + (p.x - prev.x) * (k / 20), z = prev.z + (p.z - prev.z) * (k / 20);
      assert.ok(Math.max(Math.abs(x), Math.abs(z)) >= R.half + R.thick, 'route cuts through the inner wall');
    }
    prev = p;
  }
});

test('ground units stay in their ring unless they pass through an open gate', () => {
  const R = RINGS[1];
  const wallSide = new THREE.Vector3(10, 0, R.half + R.thick - 1);
  constrainToRegion(wallSide, 1, [true, true, false]);
  assert.ok(wallSide.z >= R.half + R.thick + 0.8, 'city unit was left inside the inner wall');
  const closedLane = new THREE.Vector3(0, 0, R.half + 1);
  constrainToRegion(closedLane, 1, [true, false, false]);
  assert.ok(closedLane.z >= R.half + R.thick + 0.8, 'city unit walked through a closed inner gate');
  const openLane = new THREE.Vector3(0, 0, R.half + 1);
  constrainToRegion(openLane, 1, [true, true, false]);
  assert.ok(Math.abs(openLane.z - (R.half + 1)) < 0.01, 'open gate lane should be passable');
  const inner = new THREE.Vector3(0, 0, R.half + 3);
  constrainToRegion(inner, 2, [true, false, false]);
  assert.ok(inner.z <= R.half - 0.8, 'inner-city unit pushed back inside its own ring');
});

test('right-clicking an inner wall orders an escalade, clicking its gate orders a march', () => {
  const R = RINGS[1];
  const onWall = classifyOrderPoint(new THREE.Vector3(R.half + R.thick / 2, 0, 6));
  assert.equal(onWall.type, 'escalade');
  assert.equal(onWall.ring, 1);
  assert.equal(onWall.side, 1);
  assert.equal(classifyOrderPoint(new THREE.Vector3(0, 0, R.half + R.thick / 2)).type, 'city');
});

test('infantry escalade a closed inner wall and land in the inner city', () => {
  const events = [];
  const battle = {
    rng: () => 0.5, group: new THREE.Group(), gate: { open: true }, time: 0,
    wallThreats: () => [0, 0, 0, 0], gatesOpen: () => [true, false, false],
    onEvent: (t) => events.push(t), onInfEnteredCity() {}, onInfLeftCity() {},
  };
  const company = new Company(0, 2, 'spear', cityRallyPoint(), battle);
  for (const s of company.soldiers) s.zone = 'city';
  const R = RINGS[1];
  assert.equal(company.orderEscalade(1, new THREE.Vector3(20, 0, R.half + R.thick / 2)), true);
  for (let i = 0; i < 900 && company.state !== 'holdAt'; i++) { battle.time += 0.1; company.update(0.1); }
  assert.equal(company.state, 'holdAt');
  assert.equal(company.escalade, null);
  assert.ok(company.soldiers.every((s) => s.zone === 'inner'), 'every soldier should be over the wall');
  assert.ok(company.soldiers.every((s) => regionOf(s.pos) === 2));
  assert.ok(events.includes('escalade_start'));
});

test('infantry hacking a closed inner gate break it open and release waiting companies', () => {
  const front = gateFrontPoint(1);
  const hackers = Array.from({ length: 10 }, () => ({
    alive: true, kind: 'inf', zone: 'city', inCombat: false, pos: front.clone(), facePoint() {},
  }));
  const events = [];
  let rerouted = null;
  const battle = {
    innerGates: [{ ring: 1, open: false, hp: 5, hpMax: 5, progress: 0, anim: 0, started: false, hackT: 0 }],
    gateDoors: [], cityAttackers: new Set(hackers), rng: () => 0.5, shake: 0,
    spawnSpark() {}, onEvent: (t, d) => events.push([t, d]),
    rerouteBlockedCompanies(ring) { rerouted = ring; return 0; },
  };
  for (let i = 0; i < 20 && !battle.innerGates[0].open; i++) Battle.prototype.updateInnerGates.call(battle, 0.5);
  assert.equal(battle.innerGates[0].open, true);
  assert.equal(rerouted, 1);
  assert.deepEqual(events.map((e) => e[0]), ['inner_gate_attack', 'inner_gate_open']);
});

test('inner garrisons deploy inside their own ring with archers on the inner walls', () => {
  const garrison = new Garrison({ rng: () => 0.5, group: new THREE.Group() });
  const guards = (plan) => plan.shields + plan.spears + plan.cav + plan.archersPerSide * 4;
  assert.equal(garrison.aliveCount(), guards(CFG.garrison.inner) + guards(CFG.garrison.palace));
  for (const s of garrison.soldiers) {
    assert.equal(regionOf(s.pos), s.zone === 'inner' ? 2 : 3, `${s.utype} deployed outside its ring`);
  }
  assert.ok(garrison.soldiers.some((s) => s.utype === 'guardCav' && s.kind === 'cav'));
  assert.ok(garrison.soldiers.some((s) => s.utype === 'guardShield'));
  assert.ok(garrison.archers.every((a) => a.zone === 'wall2' || a.zone === 'wall3'));
});

test('city defenders get team-coloured ground markers by role, sized up when zoomed out', async () => {
  const { DefenderMarkers, markerKindOf, markerScaleForDistance } = await import('../src/markers.js');
  assert.equal(markerKindOf({ utype: 'def' }), 'melee');
  assert.equal(markerKindOf({ utype: 'guardArcher' }), 'archer');
  assert.equal(markerKindOf({ utype: 'carrier' }), 'worker');
  assert.equal(markerKindOf({ utype: 'guardCav' }), 'guard');
  assert.ok(markerScaleForDistance(300) > markerScaleForDistance(60));
  const markers = new DefenderMarkers(new THREE.Group(), 10);
  const unit = (alive) => ({ alive, utype: 'def', kind: 'inf', pos: new THREE.Vector3(1, 0, 2) });
  assert.equal(markers.update([unit(true), unit(false), unit(true)], 1), 2);
  assert.equal(markers.mesh.count, 2);
});

test('defender count labels group soldiers by where they really stand', () => {
  const unit = (zone, x, z, y = 0) => ({ alive: true, zone, stair: null, pos: new THREE.Vector3(x, y, z) });
  const battle = {
    defenses: [{ melee: [unit('wall', 0, CFG.wallHalf + 4, CFG.walkY), unit('wall', 5, CFG.wallHalf + 4, CFG.walkY)], archers: [], carriers: [] }],
    reserves: { squads: [{ soldiers: [unit('city', 0, CFG.wallHalf - 10)] }] },
    garrison: { soldiers: [unit('palace', 0, 2), unit('inner', 30, 0)], archers: [unit('wall3', 0, -20, 7)] },
    sally: { horses: [] },
    defenderUnits: Battle.prototype.defenderUnits,
  };
  const groups = Object.fromEntries(Battle.prototype.defenderGroups.call(battle).map((g) => [g.key, g]));
  assert.equal(groups.wall2.count, 2);
  assert.equal(groups.city2.count, 1);
  assert.equal(groups.palace.count, 2, 'palace guards and palace-wall archers share the palace label');
  assert.equal(groups.inner1.count, 1);
  assert.equal(groups.wall2.y, CFG.walkY);
});

test('HUD gate status reports strength and state for every ring', async () => {
  const { gateStatus } = await import('../src/ui.js');
  const battle = {
    gate: { open: false, breach: 0.25, progress: 0 },
    ramUnderGate: () => null,
    innerGates: [
      { open: false, hp: 55, hpMax: 110, progress: 0, started: true },
      { open: true, hp: 0, hpMax: 150, progress: 0, started: true },
    ],
  };
  const outer = gateStatus(battle, 0);
  assert.equal(outer.pct, 75);
  assert.equal(outer.hit, true);
  assert.equal(gateStatus(battle, 1).pct, 50);
  assert.equal(gateStatus(battle, 2).open, true);
});

test('minimap draws north up and maps clicks back to the same world point', async () => {
  const { worldToMinimap, minimapToWorld } = await import('../src/minimap.js');
  const [px, py] = worldToMinimap(50, -80, 190);
  assert.ok(py < 95, 'north should be drawn above the centre');
  assert.ok(px > 95, 'east should be drawn right of the centre');
  const [x, z] = minimapToWorld(px, py, 190);
  assert.ok(Math.abs(x - 50) < 1e-9 && Math.abs(z + 80) < 1e-9);
});

test('control groups save, recall, prune dead companies, and badge the lowest group', () => {
  const company = (id, alive = true) => ({ id, selected: false, kind: 'inf', ctype: 'spear', state: 'holdAt', flagPos: new THREE.Vector3(id, 0, 0), aliveSoldiers: alive ? [{ zone: 'field' }] : [] });
  const a = company(1), b = company(2), c = company(3);
  const events = [];
  const battle = {
    companies: [a, b, c], selection: new Set(), controlGroups: new Map(), onEvent: (t, d) => events.push([t, d]),
  };
  for (const name of ['clearSelection', 'saveControlGroup', 'groupMembers', 'recallControlGroup', 'refreshGroupNumbers', 'controlGroupSummary', 'groupCenter']) {
    battle[name] = Battle.prototype[name];
  }
  battle.clearOrderPreview = () => {};
  assert.equal(battle.saveControlGroup(1), 0, 'nothing selected, nothing saved');
  a.selected = true; b.selected = true; battle.selection.add(a); battle.selection.add(b);
  assert.equal(battle.saveControlGroup(3), 2);
  battle.clearSelection();
  b.selected = true; battle.selection.add(b);
  battle.saveControlGroup(1);
  assert.equal(b.groupNumber, 1, 'a company in several groups shows the lowest number');
  assert.equal(a.groupNumber, 3);
  battle.clearSelection();
  assert.equal(battle.recallControlGroup(3), 2);
  assert.deepEqual([...battle.selection], [a, b]);
  assert.equal(battle.controlGroupSummary().find((g) => g.n === 3).active, true);
  a.aliveSoldiers = [];
  assert.equal(battle.recallControlGroup(3), 1, 'dead companies drop out of the group');
  assert.ok(Math.abs(battle.groupCenter(3).x - 2) < 1e-9);
  assert.equal(events[0][0], 'group_saved');
});

test('quick-select keys pick infantry inside the walls and idle companies', () => {
  const company = (kind, ctype, zone, state, inCombat = false) => ({
    kind, ctype, state, selected: false, aliveSoldiers: [{ zone, inCombat }],
  });
  const inside = company('inf', 'spear', 'inner', 'cityMarch');
  const outside = company('inf', 'spear', 'field', 'holdAt');
  const archer = company('inf', 'archer', 'city', 'holdAt');
  const fighting = company('inf', 'shield', 'city', 'holdAt', true);
  const battle = { companies: [inside, outside, archer, fighting], selection: new Set(), clearOrderPreview() {} };
  battle.clearSelection = Battle.prototype.clearSelection;
  assert.equal(Battle.prototype.selectInsideInfantry.call(battle), 2);
  assert.ok(battle.selection.has(inside) && battle.selection.has(fighting));
  assert.equal(Battle.prototype.selectIdleCompanies.call(battle), 2);
  assert.ok(battle.selection.has(outside) && battle.selection.has(archer), 'moving or fighting companies are not idle');
});
