import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { battleOutcome, canUnitClimb } from '../src/rules.js';
import { formationDestinations, unitSlot } from '../src/formation.js';
import { gateRoute, constrainFieldOutsideWall, stairPoints, wallRoute, SIDE_VECS } from '../src/world.js';
import { CFG, mulberry32 } from '../src/config.js';
import { Battle, orderVisual } from '../src/battle.js';
import { buildCity, gateDoorAngle } from '../src/city.js';
import { assaultRoute } from '../src/navigation.js';
import { fieldRoute, routeLength } from '../src/navigation.js';
import { createOrder, ORDER_KIND, orderKindFromContext } from '../src/orders.js';
import { SpatialHash } from '../src/spatial-hash.js';
import { EngagementRegistry } from '../src/engagement.js';
import { DefenseSide, ReserveForce } from '../src/defense.js';
import { chooseTacticalTarget, targetScore } from '../src/tactical-ai.js';
import { BATTLEFIELD_CLEAR_RADIUS, mountainSpec } from '../src/scene.js';
import { Company } from '../src/company.js';

test('victory requires both no defenders and an open gate', () => {
  const base = { defendersAlive: 0, attackersAlive: 1, time: 10, timeLimit: 20 };
  assert.equal(battleOutcome({ ...base, gateOpen: false }), null);
  assert.equal(battleOutcome({ ...base, gateOpen: true }), 'win');
});

test('mission RNG repeats exactly for the same seed', () => {
  const a = mulberry32(42), b = mulberry32(42);
  assert.deepEqual(Array.from({ length: 20 }, a), Array.from({ length: 20 }, b));
});

test('large battle doubles both starting armies', () => {
  const attackerInfantry = CFG.army.composition.length * 4 * 10;
  const attackerRams = CFG.army.ramCompanies * CFG.unit.ram.crew;
  const attackerCavalry = CFG.army.cavalryCompanies * CFG.army.cavalryPerCompany;
  const defenders = 4 * (CFG.wallMelee + CFG.wallArchers + CFG.rockLogi.carriers)
    + CFG.reserveSquads * CFG.squadSize;
  assert.equal(attackerInfantry + attackerRams + attackerCavalry, 1956);
  assert.equal(defenders, 1312);
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
  const target = new THREE.Vector3(0, 0, 12);
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
  const cavalry = {
    ctype: 'cav', aliveSoldiers: [{ chargeReady: false }], formation: 'line', stance: 'aggressive',
    mode: 'idle', enteredCity: false, pendingCityTarget: null, waitingGate: false,
    anchor: new THREE.Vector3(26, 0, -90),
    battle: { gate: { open: true }, time: 1, onEvent() {} },
    setTactics: Company.prototype.setTactics,
    buildRideRoute: Company.prototype.buildRideRoute,
    routeThreats() { return [0, 0, 0, 0]; },
  };
  assert.equal(Company.prototype.orderRide.call(cavalry, new THREE.Vector3(0, 0, 10)), true);
  assert.equal(cavalry.enteredCity, false);
  assert.ok(cavalry.waypoints.length >= 4);
  assert.ok(cavalry.waypoints[0].x > 0);
});

test('field units cannot remain inside a closed wall', () => {
  const p = new THREE.Vector3(45, 0, 3);
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
    new THREE.Vector3(0, 4, 60),
    new THREE.Vector3(0, 0, -1),
    0,
    24,
  );
  assert.equal(ray.intersectObject(city.group, true).length, 0);
});

test('inner stairs have a walkable slope instead of a near-vertical ramp', () => {
  for (let side = 0; side < 4; side++) {
    const { base, top } = stairPoints(side);
    const rise = top.y - base.y;
    const run = Math.hypot(top.x - base.x, top.z - base.z);
    assert.ok(Math.atan2(rise, run) < Math.PI / 4);
    const v = SIDE_VECS[side];
    const delta = top.clone().sub(base);
    assert.ok(v.n.dot(top) >= CFG.wallHalf + 0.8 && v.n.dot(top) <= CFG.wallHalf + 1.6);
    assert.ok(v.n.dot(base) <= CFG.wallHalf - 3.5);
    assert.ok(Math.abs(v.t.dot(delta)) > Math.abs(v.n.dot(delta)) * 5.5);
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
    const target = new THREE.Vector3().addScaledVector(SIDE_VECS[toSide].n, 54);
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
  assert.ok(routeLength(from, route) < 400);
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
  const from = new THREE.Vector3(0, 0, 0);
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
  const battle = { companies: [south, archer, climbing, otherWall] };
  const count = Battle.prototype.routeOpenGateAttackers.call(battle);
  assert.equal(count, 1);
  assert.equal(entered[0].company, south);
  assert.ok(Math.max(Math.abs(entered[0].point.x), Math.abs(entered[0].point.z)) < CFG.wallHalf);
});
