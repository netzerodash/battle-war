# แผนปรับ Gameplay, Movement และ Combat Readability

เอกสารนี้เขียนสำหรับ model/engineer ที่จะรับช่วงพัฒนาเกมต่อจากสถานะปัจจุบัน เป้าหมายคือทำให้การสั่งทัพเข้าใจง่าย การเคลื่อนทัพสมเหตุสมผล รูปขบวนไม่กองซ้อน และการต่อสู้มองเห็น/อธิบายได้ โดยรักษาฟีเจอร์ล้อมเมืองที่มีอยู่แล้ว

## คำสั่งสำหรับผู้รับช่วง

1. อ่านเอกสารนี้, `README.md` และโค้ดที่เกี่ยวข้องก่อนแก้
2. ตรวจ `git status` ก่อนเสมอ เพราะ working tree ปัจจุบันมีการแก้ที่ยังไม่ commit ห้าม reset/revert หรือเขียนทับงานเดิมโดยไม่ตรวจ diff
3. ทำทีละ milestone ตามลำดับ แต่ละ milestone ต้องมี test และสามารถรันเกมทดสอบได้
4. ห้ามเริ่มด้วยการ rewrite `battle.js` ทั้งไฟล์ ให้แยก pure logic ออกทีละ seam และรักษาพฤติกรรมเดิมระหว่าง refactor
5. หลังทุก milestone ให้รัน `npm test` และ `npm run build`

## สถานะ implementation (อัปเดต 2026-09-14)

- Milestone 0: มี deterministic metrics สำหรับ wall violation, normal/choke overlap, stuck company และ combat frontage
- Milestone 1: ใช้ explicit order contract และมี route/formation preview ก่อนออกคำสั่ง
- Milestone 2: field/wall/gate/city navigation ใช้ route planner กลาง พร้อม stuck detection และ replan
- Milestone 3: มี spatial separation, company corridor yielding และ queue เดิมของ gate/stairs/ladders
- Milestone 4: มี engagement slots/claims จำกัดผู้รุมเป้าหมาย
- Milestone 5: มี 4 formations, 3 stances, archer hold-fire, cavalry charge/retreat และคำสั่งหลังยึดกำแพง
- Milestone 6: selection status, contextual company health bars, combat focus และ per-side reinforcement แสดงแล้ว
- Milestone 7: ลด standard battle จากประมาณ 2,840 เหลือประมาณ 1,634 ตัวรวมสองฝ่าย และปรับ ram/gate duty จาก telemetry
- Validation: automated rules 28 cases ผ่าน, production build ผ่าน และ browser smoke test พบ wall violation 0, stuck company 0, initial overlap 0

## Baseline ปัจจุบัน

- Stack: Three.js + Vite, JavaScript modules, fixed simulation step 30 Hz
- Baseline ณ วันที่ทำแผน: `npm test` ผ่าน 15/15 และ `npm run build` ผ่าน
- มีระบบ formation destination, unit slots, cross-side assault route, gate route, wall route, wall capture, city pursuit, gate HP, double-click selection และ soldier camera แล้ว
- standard battle เริ่มต้นประมาณ 1,634 ตัวรวมสองฝ่าย หลังลดจาก baseline เดิมประมาณ 2,840 ตัวเพื่อให้แนวรบอ่านง่ายขึ้น
- ไฟล์หลัก:
  - `src/battle.js`: orchestration, combat, wall/city/field updates, orders, ram, capture
  - `src/company.js`: company state machine และการเดินตาม formation slot
  - `src/soldier.js`: movement primitive และสถานะทหารรายคน
  - `src/navigation.js`: cross-side assault route
  - `src/world.js`: wall/gate geometry constraints และ route บนกำแพง
  - `src/defense.js`: defender commander, carriers, reserves
  - `src/ui.js`, `src/main.js`: selection, input, HUD และ feedback
  - `src/config.js`: balance parameters

## ปัญหาที่ต้องแก้

### P0 — กระทบการเล่นโดยตรง

1. คำสั่งเดินทั่วไปไม่ได้ผ่าน route planner เดียวกันทั้งหมด จึงยังมีกรณีเดินชน/ไถ/เลียบกำแพง
2. formation มีเฉพาะตำแหน่งปลายทาง แต่ไม่มี local avoidance หรือ corridor reservation ระหว่างทาง
3. เมื่อเข้าสู้ ทหารหลายตัววิ่งเข้าพิกัดศัตรูคนเดียว ไม่มี engagement frontage จึงกองซ้อน
4. ผู้เล่นไม่เห็นว่า right-click จะถูกแปลเป็นคำสั่งอะไร เส้นทางไหน หรือกองจะจัดรูปแบบใด
5. การต่อสู้ไกลกล้องและสถานะติดทางไม่มี feedback ที่ชัดเจน

### P1 — ความลึกทางกลยุทธ์

1. บทบาท shield, archer, cavalry และ ram ยังควบคุมอย่างมีเจตนาได้ไม่มาก
2. หลังยึดกำแพง ระบบเลือกส่งกำลังไปด้านอื่น/ลงเมืองอัตโนมัติ ผู้เล่นไม่มี tactical choice
3. AI intent เป็น string กระจายในหลาย state machine และไม่ได้อธิบายผ่าน UI
4. การเลือกเป้าหมายธนู/ม้า/ทหารราบยังเป็น nearest-target เป็นหลัก

### P2 — โครงสร้างและประสิทธิภาพ

1. `battle.js` รับผิดชอบมากเกินไป ทำให้แก้ระบบหนึ่งแล้วกระทบระบบอื่นง่าย
2. มีการสร้าง array ด้วย `filter()` และค้นหา nearest target ซ้ำจำนวนมากต่อ simulation step
3. tests ส่วนใหญ่เป็น pure rule tests ยังไม่มี deterministic integration simulation สำหรับ pathing, overlap และ idle combat

## หลักการออกแบบเป้าหมาย

อย่าให้ทหารทุกตัวตัดสินใจระดับยุทธศาสตร์เอง ให้แบ่งความรับผิดชอบดังนี้:

```text
Player/AI Order
    -> Company Plan: route + formation + stance + objective
        -> Squad/Company Execution: anchor + corridor + target allocation
            -> Soldier Steering: keep slot + avoid neighbors + occupy engagement slot
                -> Presentation: intent + route + combat/stuck feedback
```

- Company เป็นหน่วยตัดสินใจหลัก เพื่อรักษาความเป็นกองทัพ
- Soldier ตัดสินใจเฉพาะการหลบ, รักษาตำแหน่ง, เข้าช่องต่อสู้ และ animation timing
- ทุก movement ต้องมี plan ที่ตรวจสอบและแสดงผลได้
- การแก้ collision ต้องไม่ใช้การ teleport ยกเว้น recovery fallback ที่มี telemetry ชัดเจน

## Data contracts ที่ควรเพิ่ม

เริ่มด้วย plain objects และ pure functions ไม่ต้องสร้าง framework ใหม่

```js
company.order = {
  kind: 'move' | 'assault-wall' | 'enter-gate' | 'hold' | 'escort' | 'retreat',
  phase: 'regroup' | 'transit' | 'approach' | 'deploy' | 'engage' | 'complete',
  targetSide: null,
  targetPoint: THREE.Vector3,
  route: [],
  routeIndex: 0,
  formation: 'line' | 'column' | 'shield-front' | 'loose',
  stance: 'hold' | 'aggressive' | 'avoid-arrows',
  issuedAt: 0,
  stuckFor: 0,
  replanCount: 0,
};
```

ค่าเหล่านี้ต้องอยู่ใน `src/config.js` ไม่กระจายเป็น magic numbers:

- infantry/cavalry personal radius
- separation distance และ strength
- company corridor width
- stuck timeout, minimum progress และ replan cooldown
- engagement slot radius และ attacker capacity ต่อชนิดเป้าหมาย
- formation spacing ต่อประเภททหาร
- choke capacity ของ gate/stairs/ladders

## Milestone 0 — Characterization และ instrumentation

เป้าหมาย: วัดปัญหาได้ก่อนเปลี่ยน behavior

งาน:

1. เพิ่ม pure simulation metrics module เช่น `src/sim-metrics.js`
2. เก็บ counters แบบ development-only:
   - wall penetration violations
   - overlapping pairs แยก normal area/chokepoint
   - companies stuck เกิน threshold
   - units ที่มีศัตรูใน detection range แต่ idle เกิน threshold
   - attackers assigned ต่อ target สูงสุด
3. ทำ seeded headless scenarios ใน `test/`:
   - กองเดินข้ามจากทุก side ไปยังทุก side
   - สองกองเดินตัดกัน
   - กองผ่านประตู
   - ทหาร 20 คนเข้าปะทะเป้าหมายกลุ่มเล็ก
4. ห้ามเปลี่ยน balance ใน milestone นี้

Definition of done:

- tests ทำซ้ำ seed เดิมแล้วได้ผลเดิม
- metrics ระบุปัญหาปัจจุบันได้จริงอย่างน้อย wall contact, overlap และ dogpile
- baseline visual behavior ไม่เปลี่ยน

## Milestone 1 — Unified Order Model และ command preview

เป้าหมาย: ผู้เล่นและระบบเข้าใจคำสั่งเดียวกัน

งาน:

1. เพิ่ม `src/orders.js` สำหรับสร้าง/validate order และแปลง click context เป็น explicit order
2. เปลี่ยน `Battle.orderSelected()` ให้สร้าง order ก่อน แล้วค่อยส่งให้แต่ละ company
3. รักษา state เดิมใน `Company` ชั่วคราวด้วย adapter เพื่อลด regression
4. เพิ่ม preview ก่อนออกคำสั่ง:
   - สี/ข้อความชนิดคำสั่ง
   - route polyline
   - staging point
   - ghost formation ที่ปลายทาง
   - warning หาก unit type ใช้คำสั่งนั้นไม่ได้
5. mixed selection ต้องรายงานให้ชัดว่าหน่วยใดจะทำอะไร ห้าม silently เปลี่ยน ram เป็น ladder assault โดยไม่มีคำเตือน

Definition of done:

- preview route ตรงกับ route ที่ execute จริง
- right-click จุดเดิมด้วย selection เดิมให้ order kind เดิมเสมอ
- UI แสดงจำนวนกองที่รับคำสั่ง/ถูกปฏิเสธพร้อมเหตุผล
- controls เดิมบน desktop/touch ยังใช้ได้

## Milestone 2 — Unified Navigation และ stuck recovery

เป้าหมาย: ไม่มีคำสั่งภาคพื้นใดเดินตรงทะลุหรือไถกำแพง

งาน:

1. ขยาย `src/navigation.js` ให้มี planner สำหรับ:
   - field move
   - assault wall
   - enter/exit gate
   - move inside city
   - retreat
   - wall redeployment ใช้ `world.wallRoute()`
2. ทุก company ใช้ movement phases:
   - regroup
   - safe transit
   - final approach
   - deploy
3. วาง waypoint ตาม company anchor ไม่คำนวณ independent shortest path ให้ทหารทุกคน
4. ใช้ `constrainFieldOutsideWall()` เป็น safety invariant หลัง steering ไม่ใช่ primary navigation
5. เพิ่ม progress tracker:
   - เทียบระยะถึง waypoint ทุกช่วงเวลา
   - ถ้าไม่คืบหน้าตามเกณฑ์ให้ replan
   - จำกัด replan rate ป้องกัน oscillation
6. threat cost ใช้เวลาเดินในระยะธนู, defender density และ congestion แทน count แบบหยาบเพียงอย่างเดียว
7. ประตู/บันได/บันไดปีนเป็น explicit portal ห้ามเปลี่ยน zone ด้วยพิกัดหรือ y-clamp โดยไม่มี portal transition

Definition of done:

- field unit ไม่อยู่ใน solid wall volume แม้เดินข้าม side
- ไม่มี company ไถกำแพงเกิน stuck timeout โดยไม่ replan
- path length ไม่เกิน 1.6 เท่าของ safe shortest route ใน scenario มาตรฐาน
- unit เข้า/ออกเมืองได้เฉพาะ gate หรือ traversal ที่ประเภทนั้นใช้ได้

## Milestone 3 — Formation cohesion และ local avoidance

เป้าหมาย: กองเดินเป็นกองและไม่ซ้อนกันในพื้นที่เปิด

งาน:

1. เพิ่ม `src/spatial-hash.js` หรือ uniform grid เพื่อ query เพื่อนบ้าน โดย rebuild หนึ่งครั้งต่อ fixed step
2. เพิ่ม steering components:
   - seek formation slot
   - separation จาก unit ใกล้เคียง
   - alignment กับทิศทางกอง
   - soft avoidance ระหว่าง company
3. จำกัด steering correction เพื่อไม่ให้ทหารสั่นหรือเดินถอยหน้าอย่างรวดเร็ว
4. company anchor จอง corridor ตามความกว้าง formation; เมื่อเส้นทางตัดกันให้กองหนึ่ง yield ตาม priority/เวลารอ
5. บริเวณ gate, stairs และ ladders เปลี่ยนเป็น column พร้อม queue token และลด spacing อย่างควบคุม
6. ถ้าหลุดจาก slot มาก ให้ regroup แทนการวิ่งตัดผ่านทั้งกอง

Definition of done:

- พื้นที่เปิด: infantry center distance เป้าหมายไม่น้อยกว่า ~0.8 และ cavalry ~1.5 หน่วย
- overlap violations ลดอย่างน้อย 90% จาก baseline ใน seeded crossing scenario
- กองสองกองเดินตัดกันแล้วไม่ deadlock
- formation กลับเข้ารูปหลังผ่าน chokepoint ภายในเวลาที่กำหนด
- ไม่มี noticeable jitter เมื่อความเร็วเกม 1x และ 2x

## Milestone 4 — Engagement frontage และ combat allocation

เป้าหมาย: การปะทะมีแนวหน้า มองออก และไม่รุมกองเดียว

งาน:

1. เพิ่ม `src/engagement.js` สำหรับ target claims และ engagement slots
2. สร้างวง slot รอบเป้าหมายตามขนาด unit/อาวุธ/พื้นที่
3. จำกัด capacity เริ่มต้น:
   - infantry ต่อ infantry สูงสุด 3–4
   - cavalry ต่อ infantry สูงสุด 2
   - chokepoint ลด capacity ตาม frontage จริง
4. unit ที่ไม่มี slot:
   - รอในแถวสอง
   - หา target อื่น
   - flank เมื่อมีพื้นที่
   - ห้ามวิ่งเข้าพิกัดกลางตัวเป้าหมาย
5. target selection ใช้ score: objective relevance, distance, threat, existing claims และ formation cohesion
6. archers ใช้ firing positions และ line-of-fire reservations อย่างง่าย ไม่เดินเข้ากอง melee
7. ปล่อย claim เมื่อ target ตาย, หลุดระยะ, เปลี่ยน order หรือ unit ตาย

Definition of done:

- จำนวนผู้โจมตีเป้าหมายเดียวไม่เกิน capacity
- แนวหน้ากว้างตามจำนวนทหาร ไม่กลายเป็นก้อนจุดเดียว
- unit แถวหลังไม่ idle โดยไร้เหตุผล: มี intent ว่า reserve/flank/waiting-slot
- combat windup/impact เดิมยังสัมพันธ์กับจังหวะ damage

## Milestone 5 — Tactical roles และ player agency

เป้าหมาย: มีกลยุทธ์หลายแบบ แต่แต่ละแบบสมเหตุสมผลและอ่านออก

เพิ่ม formation:

- `line`: แนวกว้าง เข้าปะทะดี
- `column`: เดินทางและผ่านประตู/บันได
- `shield-front`: โล่อยู่หน้า หน่วยอื่นตามหลัง
- `loose`: ลดความเสียหายจากธนู แต่ cohesion ต่ำลง

เพิ่ม stance:

- `hold`: ไม่ไล่เกิน leash range
- `aggressive`: ไล่และปิดระยะ
- `avoid-arrows`: ยอมอ้อมเพื่อลด exposure

บทบาทเฉพาะ:

- Shield: explicit escort order, รักษาตำแหน่งหน้า ram/archer และความเร็วทั้งกลุ่มเท่าหน่วยช้าที่สุด
- Archer: focus wall section, suppress area, hold fire; ไม่เลือกเป้าหมายเองข้าม objective โดยไม่มีเหตุผล
- Cavalry: charge, pursue, disengage/regroup; หลีกเลี่ยง stairs/ladders และพื้นที่แคบ
- Ram: มี active ram ที่ประตูชัดเจน เครื่องอื่นรอเป็น reserve/support; แสดงเหตุผลหากไม่ได้กระแทก
- Infantry: assault, secure wall, reinforce adjacent wall หรือ descend to city

หลัง capture ให้ผู้เล่นเลือกอย่างน้อย 3 แบบ:

1. Hold wall
2. Reinforce adjacent wall
3. Descend and clear city

AI ใช้ default ที่อิง threat เมื่อผู้เล่นไม่เลือกภายในช่วงเวลาที่กำหนด

Definition of done:

- ทุก unit type มีอย่างน้อยสอง tactical uses ที่ต่างกันจริง
- หลังยึดกำแพง ไม่มีการกระจายกำลังด้วยเลข hardcoded โดยไม่แจ้งผู้เล่น
- cavalry สามารถ charge แล้ว disengage ได้ ไม่ติด melee blob
- escort group รักษาลำดับ shield -> protected unit ระหว่าง transit/approach

## Milestone 6 — Readability และ tactical UI

เป้าหมาย: ผู้เล่นตอบได้ทันทีว่า “กองนี้กำลังทำอะไร ทำไมไม่ไป และกำลังสู้ที่ไหน”

งาน:

1. Selection panel แสดง:
   - composition แยกประเภท
   - alive/total และ health โดยรวม
   - order, phase, formation, stance
   - destination/target
   - stuck/waiting reason
2. contextual health bars เฉพาะ selected, damaged และ actively engaged units; หลีกเลี่ยงเปิดทุกตัวพร้อมกัน
3. route line, waypoint, formation ghost และ objective marker
4. combat ping/event indicator พร้อมปุ่ม focus จุดปะทะ
5. แก้ HUD reinforcement ให้เป็นค่าของแต่ละ side จริง ไม่ใช้ global en-route count ซ้ำทุกด้าน
6. intent labels ใช้ canonical enum แล้ว map เป็นข้อความไทย ห้ามนำ raw debug string แสดงตรง ๆ
7. เพิ่ม optional tactical overlay สำหรับ development:
   - collision radius
   - slots/claims
   - company anchor/corridor
   - portal queues

Definition of done:

- หลังออกคำสั่งไม่เกิน 0.5 วินาที ผู้เล่นเห็น order และ route feedback
- unit ที่หยุดมีสถานะอธิบายได้ เช่น regrouping, waiting gate, waiting combat slot, holding
- จุดปะทะนอกกล้องหาเจอได้ในหนึ่ง action
- HUD ไม่แสดงข้อมูล aggregate ซ้ำเหมือนเป็นข้อมูลราย side

## Milestone 7 — Balance, scale และ performance

ทำหลัง movement/combat correctness เท่านั้น เพื่อไม่ให้การปรับเลขกลบ bug

งาน:

1. สร้าง battle telemetry จาก seeded simulation:
   - time to first contact
   - time to breach gate / capture wall
   - losses แยก role และ damage source
   - arrow exposure time ต่อ company
   - idle/stuck/overlap time
2. ลดจำนวนเริ่มต้นสำหรับ tutorial/standard preset เพื่อให้อ่านสนามรบง่ายขึ้น; เก็บ full-scale เป็น large battle preset
3. ปรับ archer range/damage จากเวลาตอบสนองที่ต้องการ ไม่ใช่ระยะภาพอย่างเดียว
4. ตรวจ ram count และ breach contribution ให้จำนวนเครื่องมีความหมายชัด
5. profile allocation ใน fixed update; reuse arrays/vectors และ spatial queries
6. ถ้ายังจำเป็นจึงพิจารณา InstancedMesh/LOD แต่ห้ามใช้ optimization นี้แทนการแก้ AI logic

เป้าหมายสมดุลเบื้องต้น:

- deployment เริ่มต้นต้องมีเวลาอย่างน้อย 8–12 วินาทีก่อนโดนลูกธนูนัดแรก หากไม่ได้สั่งเดินเข้า danger zone
- กลยุทธ์อย่างน้อย 3 แนวทางชนะได้ภายใต้ skill ที่เหมาะสม: wall assault, gate breach, mixed feint
- กลยุทธ์ spam ทุกด้านควรด้อยกว่า แต่ไม่ควรแพ้เพราะ pathing bug
- standard scenario ต้องอ่านชนิดกองและแนวปะทะออกจาก tactical camera

## Test matrix ขั้นสุดท้าย

### Automated

- ทุก source side -> target side route ไม่ผ่าน solid wall
- gate closed/open transition ไม่ทำให้ unit teleport
- unit type climbing rules ถูกต้อง
- two-company crossing ไม่ deadlock
- formation slots + avoidance ไม่ overlap เกิน tolerance
- engagement capacity และ claim release ถูกต้อง
- dead target ทำให้ attacker retarget ภายในเวลาที่กำหนด
- hold stance ไม่ไล่เกิน leash
- cavalry charge/disengage state cycle
- wall capture choice ทั้งสามเส้นทาง
- per-side HUD reinforcement data
- seeded battle simulation deterministic

### Manual browser QA

1. เลือกหลายกองต่างชนิดและ hover เป้าหมายทุกโซน ตรวจ preview/warning
2. สั่งกองจากเหนือไปใต้และตะวันออกไปตะวันตกพร้อมกัน ดู route และการ yield
3. สั่ง 3 กองผ่านประตู ตรวจ column queue และ regroup หลังเข้าเมือง
4. สั่งกองใหญ่รุมศัตรูกลุ่มเล็ก ตรวจแนวหน้าและแถวสอง
5. ทดสอบ shield escort + ram และ shield escort + archer
6. ทดสอบม้า charge, pursue, disengage ในเมือง
7. ยึดกำแพงและเลือก hold/reinforce/descend
8. ตรวจความเร็ว 0.5x/1x/2x ว่าไม่มี jitter หรือ state skip
9. เปิด soldier camera ระหว่าง transit/combat แล้วกลับ tactical camera
10. เล่นจนจบทั้งชนะและแพ้ ตรวจว่าไม่มี unit อยู่ใน geometry หรือ idle แบบไร้ intent

## ลำดับ commit ที่แนะนำ

1. `test: add deterministic movement and combat metrics`
2. `refactor: introduce explicit company order contract`
3. `feat: unify field wall gate and city navigation`
4. `feat: add stuck detection and route replanning`
5. `feat: add spatial separation and company corridor yielding`
6. `feat: add chokepoint queues and formation transitions`
7. `feat: add engagement slots and target claims`
8. `feat: add formations stances and role-specific orders`
9. `feat: let players choose post-capture objective`
10. `feat: add tactical order and combat feedback`
11. `fix: report reinforcement state per wall side`
12. `balance: tune standard battle from telemetry`
13. `perf: reduce hot-loop allocation and spatial query cost`

ทุก commit ควรผ่าน tests และ build ด้วยตัวเอง หลีกเลี่ยง commit ที่รวม refactor, behavior change, UI และ balance ไว้พร้อมกัน

## สิ่งที่ไม่ควรทำ

- ไม่ใช้ teleport เป็นวิธีแก้ unit ติดทางตามปกติ
- ไม่เพิ่ม random offset เพื่อซ่อน unit overlap
- ไม่ให้ Soldier แต่ละตัวรัน global pathfinding หรือ scan ศัตรูทั้งสนาม
- ไม่ใช้ nearest target อย่างเดียวโดยไม่คำนึงถึง claims/objective/cohesion
- ไม่แก้ปัญหาความชัดเจนด้วย health bar ทุกตัวพร้อมกัน
- ไม่ลดจำนวนทหารอย่างเดียวแล้วถือว่า pathing ถูกแก้แล้ว
- ไม่เปลี่ยน balance ก่อนมี telemetry และ deterministic scenario
- ไม่ลบ state machine เดิมครั้งเดียวทั้งก้อน

## เกณฑ์ส่งมอบรวม

งานถือว่าเสร็จเมื่อ:

1. ไม่มี field unit เดินทะลุกำแพงหรือไถกำแพงโดยไม่ replan
2. กองรักษาฟอร์มระหว่างเดินและกลับเข้าฟอร์มหลัง chokepoint
3. การต่อสู้สร้างแนวปะทะ ไม่กองทหารทั้งหมดบนพิกัดเดียว
4. ทุก unit/company ที่หยุดมี reason/intent ที่ตรวจสอบและแสดงได้
5. ผู้เล่นเห็นคำสั่ง เส้นทาง รูปขบวน และผลของคำสั่งก่อน/หลังคลิก
6. มี formation, stance และ role orders ที่สร้างกลยุทธ์อย่างน้อยสามแบบ
7. automated tests, production build และ manual QA checklist ผ่าน
8. performance ที่ 1x ไม่แย่กว่า baseline อย่างมีนัยสำคัญใน standard preset
