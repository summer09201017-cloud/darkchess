// 🔬 3D 棋盤的「純幾何」驗收(v12,不開 WebGL,node 直接跑;借 Board3D.prototype 的純數學方法,skill board3d-kit 四的做法)
//   ① index 0–31 ↔ (row,col) ↔ 世界 ↔ 格 來回一致;yaw 0 時 row 0 在遠端(畫面上方)、col 0 在左
//   ② yaw 0/90/180/270 × 俯角 20/34/58/88 × 五種螢幕比例:32 格格心都在畫面內、盤角在 ±FIT_EDGE 內,
//      而且「從格心投影點打回去的射線」(= 真手指點在那一格的畫面位置)落回同一格 —— 四角 + 中央 + 每一格都驗
//   ③ 規則鄰接:idx 3 右邊不是 idx 4(跨列)、idx 31 下面點不到任何格
//   ④ 反例(防空測試):8 欄換算 / row-col 互換 / 只改 aspect 不重新取景(390×844),每條都要被抓到
// 跑法:node test/board3d-geom.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
globalThis.THREE = require("../vendor/three.r128.min.js");
const THREE = globalThis.THREE;
const { Board3D } = await import("../js/board3d.js");
const Core = require("../banqi-core.js");

let pass = 0, fail = 0;
const ok = (cond, msg, note = "") => { if (cond) { pass++; } else { fail++; console.error("  🔴 " + msg + (note ? " → " + note : "")); } };
const section = (t) => console.log("  · " + t);

/* 跟 js/scene3d.js 建盤的參數一模一樣 */
function fakeBoard({ aspect = 1.5, yaw = 0, view = "top", pitch = null } = {}) {
  const b = Object.create(Board3D.prototype);
  b.opt = { cols: 4, rows: 8, mode: "cell", pitch: 0.3, margin: 0.55, centerFit: true };
  b.cols = 4; b.rows = 8; b.view = view; b.yaw = yaw; b.pitchOverride = null;
  b.target = new THREE.Vector3(0, 0, 0);
  b.camera = new THREE.PerspectiveCamera(38, aspect, 0.05, 60);
  b.camera.updateProjectionMatrix();
  if (pitch != null) b.setPitch(pitch); else b.fitCamera();
  return b;
}
const idxToRC = (i) => ({ row: Math.floor(i / 4), col: i % 4 });
const ndcOf = (b, x, z) => new THREE.Vector3(x, 0, z).project(b.camera);
/** 螢幕 NDC → 射線打盤面 → 格(跟 Board3D.pickWorld + worldToCell 同一條路,只是不經 canvas rect) */
function pickNdc(b, nx, ny) {
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(nx, ny), b.camera);
  const hit = new THREE.Vector3();
  if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null;
  return b.worldToCell(hit.x, hit.z);
}

section("① 32 格來回 + 方向");
{
  const b = fakeBoard();
  for (let i = 0; i < 32; i++) {
    const { row, col } = idxToRC(i);
    ok(row * 4 + col === i, `idx ${i} → row/col 回不去`);
    const w = b.cellToWorld(row, col);
    const back = b.worldToCell(w.x, w.z);
    ok(back && back.idx === i && back.row === row && back.col === col, `idx ${i} 世界來回`, JSON.stringify(back));
  }
  const a0 = ndcOf(b, b.cellToWorld(0, 0).x, b.cellToWorld(0, 0).z);
  const a3 = ndcOf(b, b.cellToWorld(0, 3).x, b.cellToWorld(0, 3).z);
  const a28 = ndcOf(b, b.cellToWorld(7, 0).x, b.cellToWorld(7, 0).z);
  ok(a0.y > a28.y, "yaw 0:row 0 在畫面上方(遠端)", `${a0.y} vs ${a28.y}`);
  ok(a0.x < a3.x, "yaw 0:col 0 在左", `${a0.x} vs ${a3.x}`);
}

section("② 4 yaw × 4 俯角 × 5 螢幕:每一格格心在畫面內、點回同一格;盤角在邊界內");
const SCREENS = [[1200, 800], [390, 844], [844, 390], [768, 1024], [1280, 720]];
let combos = 0;
for (const yaw of [0, 90, 180, 270]) for (const pitch of [20, 34, 58, 88]) for (const [w, h] of SCREENS) {
  combos++;
  const b = fakeBoard({ aspect: w / h, yaw, pitch });
  const tag = `yaw${yaw} pitch${pitch} ${w}×${h}`;
  let worst = 0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const q = new THREE.Vector3(sx * b.halfX, 0, sz * b.halfZ).project(b.camera);
    worst = Math.max(worst, Math.abs(q.x) / 0.96, Math.abs(q.y) / 0.90);
  }
  ok(worst <= 1.01, `${tag} 盤角在邊界內`, worst.toFixed(3));
  for (let i = 0; i < 32; i++) {
    const { row, col } = idxToRC(i);
    const c = b.cellToWorld(row, col);
    const q = ndcOf(b, c.x, c.z);
    ok(Math.abs(q.x) <= 1 && Math.abs(q.y) <= 1, `${tag} idx ${i} 格心在畫面內`);
    const hit = pickNdc(b, q.x, q.y);
    ok(hit && hit.idx === i, `${tag} 點 idx ${i} 的格心回到同一格`, JSON.stringify(hit));
    // 格內偏一點(四分之一格)也還是同一格
    const q2 = ndcOf(b, c.x + 0.3 * 0.24, c.z - 0.3 * 0.24);
    const hit2 = pickNdc(b, q2.x, q2.y);
    ok(hit2 && hit2.idx === i, `${tag} idx ${i} 格內偏 1/4 格仍同格`, JSON.stringify(hit2));
  }
}
console.log(`    ${combos} 種視角 × 32 格`);

section("③ 規則鄰接與盤外");
ok(!Core.getAdjacentIndexes(3).includes(4), "idx 3 右邊不是 idx 4(那是下一列)");
ok(Core.getAdjacentIndexes(3).includes(7) && Core.getAdjacentIndexes(3).includes(2), "idx 3 的鄰格是 2 與 7");
{
  const b = fakeBoard();
  const c = b.cellToWorld(7, 3);
  ok(b.worldToCell(c.x, c.z + 0.3) === null, "idx 31 下面一格的位置點不到任何格(盤外 → null)");
  ok(b.worldToCell(c.x + 0.3, c.z) === null, "idx 31 右邊一格的位置點不到任何格");
  ok(b.worldToCell(99, 0) === null, "背景 → null");
}

section("④ 反例:錯的換算 / 錯的取景一定要被抓到");
{
  // (a) 用 8 欄換算 index(把盤當成 8×4)
  let caught = 0;
  const b = fakeBoard();
  for (let i = 0; i < 32; i++) {
    const wrong = { row: Math.floor(i / 8), col: i % 8 };
    const w = b.cellToWorld(wrong.row, wrong.col);
    const back = b.worldToCell(w.x, w.z);
    if (!back || back.idx !== i) caught++;
  }
  ok(caught > 0, "反例 a:8 欄換算必須有格子來回對不上", `抓到 ${caught}`);
  // (b) row/col 互換
  caught = 0;
  for (let i = 0; i < 32; i++) {
    const { row, col } = idxToRC(i);
    const w = b.cellToWorld(col, row);
    const back = b.worldToCell(w.x, w.z);
    if (!back || back.idx !== i) caught++;
  }
  ok(caught > 0, "反例 b:row/col 互換必須被抓到", `抓到 ${caught}`);
  // (c) 桌機取好景,只把 aspect 改成直向手機、不重新 fitCamera ⇒ 盤角爆出畫面
  const d = fakeBoard({ aspect: 1200 / 800 });
  d.camera.aspect = 390 / 844;
  d.camera.updateProjectionMatrix();
  let worst = 0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const q = new THREE.Vector3(sx * d.halfX, 0, sz * d.halfZ).project(d.camera);
    worst = Math.max(worst, Math.abs(q.x), Math.abs(q.y));
  }
  ok(worst > 0.95, "反例 c:只改 aspect 不重新取景,390×844 盤角必須爆出 0.95", worst.toFixed(3));
  const e = fakeBoard({ aspect: 390 / 844 });
  let fine = 0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const q = new THREE.Vector3(sx * e.halfX, 0, sz * e.halfZ).project(e.camera);
    fine = Math.max(fine, Math.abs(q.x) / 0.96, Math.abs(q.y) / 0.90);
  }
  ok(fine <= 1.01, "對照:重新取景後 390×844 盤角回到邊界內", fine.toFixed(3));
}

section("⑤ 垂直置中(centerFit)不改命中:置中前後,同一個畫面點打到的格一樣是那一格的投影");
{
  const b = fakeBoard({ aspect: 1280 / 720 });
  b.fitExtra = () => [new THREE.Vector3(0, 0.95, -1.7)];   // 模擬動物頭頂
  b.fitCamera();
  ok(Math.abs(b.viewShiftY || 0) > 0.01, "有動物頭頂時真的有置中位移", String(b.viewShiftY));
  for (const i of [0, 3, 28, 31, 13]) {
    const { row, col } = idxToRC(i);
    const c = b.cellToWorld(row, col);
    const q = ndcOf(b, c.x, c.z);
    const hit = pickNdc(b, q.x, q.y);
    ok(hit && hit.idx === i, `置中後點 idx ${i} 仍回到 idx ${i}`, JSON.stringify(hit));
  }
}

console.log(`🔬 board3d-geom:${pass} 過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
