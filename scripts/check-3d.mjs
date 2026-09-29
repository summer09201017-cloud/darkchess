// 🔬 v12 真 3D 驗收(2026-09-29,規格 dark-3d-spec-draft.md §5)—— playwright-core + 系統 Edge/Chrome
// 跑法:py -m http.server 8797 → node scripts/check-3d.mjs   (線上:CHECK_URL=https://darkchesscodex.pages.dev)
//       SHOTS=1 會把三個視角 + 標記截圖存到 scripts/out/(目視用,不進版控)
//
// ★ 驗法鐵則:點棋盤一律用 renderer.cellToScreen / pieceTopToScreen 算出來的**真座標** + page.mouse(skill canvas-playwright-verify
//   第四次踩坑那條:裸座標);等狀態用 waitForFunction(無頭 rAF 慢,固定毫秒是假紅溫床,記憶 headless-dt-cap)。
// ★ 硬體聲明:無頭 Chromium(SwiftShader / 無 GPU)。「主執行緒不被搜尋卡住」那條量的是 rAF 間隔,不是 fps;
//   無頭低 fps 不等於 AI 卡住 —— 判準是「AI 搜尋期間沒有 > 200ms 的單一空窗」,並對照同一個搜尋放主執行緒時的耗時。
import { chromium, devices } from "playwright-core";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = (process.env.CHECK_URL || "http://localhost:8797").replace(/\/$/, "");
const SHOTS = process.env.SHOTS === "1";
if (SHOTS) mkdirSync("scripts/out", { recursive: true });
let browser = null;
for (const channel of ["msedge", "chrome"]) {
  try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* 換下一個 */ }
}
if (!browser) { console.error("找不到系統 Edge/Chrome"); process.exit(1); }
const ua = await browser.version();

let pass = 0, fail = 0;
const ok = (cond, msg, note = "") => {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.error("  ✗ " + msg + (note ? " → " + note : "")); }
};
const errors = [];
const section = (t) => console.log("── " + t + " ──");

async function open({ viewport = { width: 1200, height: 800 }, dpr = 1, init = null, reduced = false, sw = "block", ctxOpts = {}, query = "" } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, serviceWorkers: sw, reducedMotion: reduced ? "reduce" : "no-preference", ...ctxOpts });
  if (init) await ctx.addInitScript(init.fn, init.arg);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?v=${Date.now()}${query}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__banqi && window.__banqi.rendererMode !== "pending", null, { timeout: 20000 });
  await page.waitForTimeout(300);
  return { ctx, page };
}
const ready = (page) => page.waitForFunction(() => { const B = window.__banqi; return !B.animBusy && !B.state.aiThinking; }, null, { timeout: 20000 });
/** 真座標:有棋子點棋頂中心,空格點格心 */
async function screenOf(page, i) {
  return page.evaluate((i) => { const R = window.__banqi.renderer; return R.pieceTopToScreen(i) || R.cellToScreen(i); }, i);
}
async function tap(page, i) {
  await page.locator("#board3d").scrollIntoViewIfNeeded();
  const p = await screenOf(page, i);
  await page.mouse.click(p.x, p.y);
  return p;
}
const st = (page) => page.evaluate(() => {
  const B = window.__banqi, s = B.state;
  return { turnCount: s.turnCount, turnSide: s.turnSide, winner: s.winner, hidden: s.pieces.filter((p) => !p.revealed && !p.captured).length,
    board: s.board.slice(), selected: s.selectedIndex, aiThinking: s.aiThinking, animBusy: B.animBusy, msg: document.querySelector("#statusMessage").textContent };
});
/** 擺一個固定局面:spec.pieces = [{cell, side, type, revealed}],其餘棋子一律吃掉 */
async function setup(page, spec) {
  await page.evaluate((spec) => {
    const B = window.__banqi, s = B.state;
    for (const p of s.pieces) { p.captured = true; p.position = -1; p.revealed = true; }
    s.board = Array(32).fill(null);
    const used = new Set();
    for (const want of spec.pieces) {
      const p = s.pieces.find((x) => !used.has(x.id) && x.side === want.side && x.type === want.type);
      used.add(p.id);
      p.captured = false; p.revealed = want.revealed !== false; p.position = want.cell;
      s.board[want.cell] = p.id;
    }
    s.mode = spec.mode || "local";
    s.turnSide = spec.turnSide; s.humanSide = spec.humanSide || null; s.aiSide = spec.aiSide || null;
    s.turnCount = spec.turnCount || 4; s.selectedIndex = null; s.legalTargets = []; s.winner = null; s.lastAction = null; s.hint = null;
    B.render({ fullBoard: true });
  }, spec);
  await page.waitForTimeout(80);
}

/* ════════ ① 開局:32 枚同背面、真 3D、三個視角截圖 ════════ */
section("① 開局 + 三視角");
{
  const { ctx, page } = await open();
  const p = await page.evaluate(() => {
    const R = window.__banqi.renderer, pr = R.probe();
    return { mode: window.__banqi.rendererMode, n: pr.pieces.length, allBack: pr.pieces.every((x) => x.hidden && x.faceKind === "back" && x.backShared),
      names: [...new Set(pr.pieces.map((x) => x.name))], ud: pr.pieces.some((x) => x.userDataKeys.length), canvases: document.querySelectorAll("canvas").length,
      counts: document.querySelector("#statusCounts").textContent, faceMats: pr.faceMats,
      side: (() => { const b = R.board; return b.scene.children.some((o) => o.type === "Group" && o.children.some((c) => c.geometry && c.geometry.type === "BoxGeometry")); })() };
  });
  ok(p.mode === "3d" && p.canvases === 1, "真 3D 模式、整頁一張 WebGL 畫布", JSON.stringify(p));
  ok(p.n === 32 && p.allBack, "32 枚全部是同一個背面材質(暗子)");
  ok(p.names.length === 1 && p.names[0] === "piece-hidden" && !p.ud, `暗子的 mesh 名稱只有「piece-hidden」、userData 全空(${p.names})`);
  ok(p.faceMats === 0, "開局一張正面貼圖都還沒畫(翻開才畫)");
  ok(/暗子 32/.test(p.counts) && /空格 0/.test(p.counts), `狀態列:${p.counts}`);
  ok(p.side, "盤身是有厚度的 Box(有側面)");
  if (SHOTS) {
    await page.locator("#board3d").scrollIntoViewIfNeeded();
    for (const key of ["top", "flat", "sit"]) {
      await page.click("#viewButton");
      await page.click(`[data-vk-view="${key}"]`);
      await page.click("#viewButton");
      await page.waitForTimeout(400);
      await page.locator(".board-card").screenshot({ path: `scripts/out/view-${key}.png` });
    }
  }
  await ctx.close();
}

/* ════════ ② 真座標點擊:首翻 → 定邊 → AI 回手(turnCount 精確 +2)════════ */
section("② 首翻定邊 + AI 回手(真座標)");
{
  const { ctx, page } = await open();
  await page.evaluate(() => { const B = window.__banqi; B.startNewGame("t"); });
  const before = await st(page);
  await tap(page, 0);
  await page.waitForFunction(() => window.__banqi.state.turnCount >= 2 && !window.__banqi.animBusy && !window.__banqi.state.aiThinking, null, { timeout: 20000 });
  const after = await st(page);
  const flips = await page.evaluate(() => window.__banqi.state.pieces.filter((p) => p.revealed).length);
  ok(after.turnCount === before.turnCount + 2, `turnCount 精確 +2(${before.turnCount} → ${after.turnCount})`);
  ok(after.hidden === 32 - flips, `暗子數 = 32 − 實際翻開數(${after.hidden} = 32 − ${flips})`);
  const side = await page.evaluate(() => ({ human: window.__banqi.state.humanSide, first: window.__banqi.state.pieces.find((p) => p.position === 0)?.side, txt: document.querySelector("#statusSide").textContent }));
  ok(side.human === side.first && side.txt.includes("你執"), `翻到哪色就執哪色(${side.first} ⇒ 你執 ${side.human};${side.txt})`);
  const log = await page.evaluate(() => window.__banqi.searchLog.slice(-1)[0]);
  ok(log && log.purpose === "ai" && log.replyGen === log.gen && log.replyReqId === log.reqId, "AI 那一手來自 Worker、而且是這一局最新的請求", JSON.stringify(log));
  await ctx.close();
}

/* ════════ ③ 規則(固定局面 + 真座標點擊,雙人同機)════════ */
section("③ 規則:相鄰走 / 兵吃將 / 將不能吃兵 / 炮隔 0-1-2 / 暗子 / 結局");
{
  const { ctx, page } = await open();
  await page.evaluate(() => { window.__psDoneCount = 0; const o = window.psDone; window.psDone = () => { window.__psDoneCount++; }; });
  // 相鄰走
  await setup(page, { turnSide: "red", pieces: [{ cell: 5, side: "red", type: "rook" }, { cell: 30, side: "black", type: "pawn" }, { cell: 31, side: "black", type: "pawn" }] });
  await tap(page, 5); await tap(page, 6); await ready(page);
  let s = await st(page);
  ok(s.board[6] !== null && s.board[5] === null && s.turnSide === "black", "紅俥 5 → 6(相鄰空格)走得過去、換黑方");
  // 跨列不相鄰:3 → 4
  await setup(page, { turnSide: "red", pieces: [{ cell: 3, side: "red", type: "rook" }, { cell: 30, side: "black", type: "pawn" }] });
  await tap(page, 3); await tap(page, 4); await ready(page);
  s = await st(page);
  ok(s.board[3] !== null && s.board[4] === null && s.turnSide === "red" && s.selected === null, "紅俥 3 → 4(跨列)不提交、取消選取、回合不變");
  // 兵吃將
  await setup(page, { turnSide: "red", pieces: [{ cell: 0, side: "red", type: "pawn" }, { cell: 1, side: "black", type: "general" }, { cell: 30, side: "black", type: "pawn" }] });
  await tap(page, 0); await tap(page, 1); await ready(page);
  s = await st(page);
  const eaten = await page.evaluate(() => window.__banqi.state.pieces.find((p) => p.side === "black" && p.type === "general").captured);
  ok(eaten && s.board[0] === null && s.board[1] !== null, "紅兵吃黑將");
  // 將不能吃兵
  await setup(page, { turnSide: "black", pieces: [{ cell: 0, side: "red", type: "pawn" }, { cell: 1, side: "black", type: "general" }, { cell: 31, side: "red", type: "rook" }] });
  await tap(page, 1); await tap(page, 0); await ready(page);
  s = await st(page);
  ok(s.board[0] !== null && s.board[1] !== null && s.turnSide === "black", "黑將不能吃紅兵(局面不變、還是黑方)");
  // 炮:隔 0 / 1 / 2
  const cannon = async (screens, label, expect) => {
    const pcs = [{ cell: 0, side: "red", type: "cannon" }, { cell: 31, side: "black", type: "pawn" }];
    for (let k = 0; k < screens; k++) pcs.push({ cell: 4 * (k + 1), side: "red", type: "pawn" });
    const target = 4 * (screens + 1);
    pcs.push({ cell: target, side: "black", type: "rook" });
    await setup(page, { turnSide: "red", pieces: pcs });
    const legal = await page.evaluate((t) => window.__banqi.getLegalActions(window.__banqi.state, "red").some((a) => a.type === "capture" && a.from === 0 && a.to === t), target);
    await tap(page, 0); await tap(page, target); await ready(page);
    const took = await page.evaluate((t) => window.__banqi.state.board[t] !== null && window.__banqi.state.pieces[window.__banqi.state.board[t]].type === "cannon", target);
    ok(legal === expect && took === expect, `炮隔 ${screens} 枚吃 ${target}:${expect ? "可以" : "不行"}(${label})`);
  };
  await cannon(0, "相鄰不能吃", false);
  await cannon(1, "隔一枚跳吃", true);
  await cannon(2, "隔兩枚不行", false);
  // 暗子不能被吃 / 不能被選
  await setup(page, { turnSide: "red", pieces: [{ cell: 0, side: "red", type: "general" }, { cell: 1, side: "black", type: "pawn", revealed: false }, { cell: 31, side: "black", type: "rook" }] });
  await tap(page, 0);
  const tg = await page.evaluate(() => window.__banqi.state.legalTargets.map((a) => a.to));
  ok(!tg.includes(1), `紅帥的合法目的格不含暗子那格(${tg})`);
  // 吃光結局:psDone 一次、狀態寫勝方
  await setup(page, { turnSide: "red", pieces: [{ cell: 0, side: "red", type: "rook" }, { cell: 1, side: "black", type: "pawn" }] });
  await tap(page, 0); await tap(page, 1); await ready(page);
  s = await st(page);
  const end = await page.evaluate(() => ({ done: window.__psDoneCount, turn: document.querySelector("#statusTurn").textContent }));
  ok(s.winner === "red" && end.done === 1 && /紅方獲勝/.test(end.turn), `吃光 ⇒ 紅方獲勝、完賽打點剛好一次(${end.done};${end.turn})`);
  await page.evaluate(() => { window.__banqi.render({ fullBoard: true }); window.__banqi.render({ fullBoard: true }); });
  ok((await page.evaluate(() => window.__psDoneCount)) === 1, "重畫兩次不會再打一次完賽");
  // 無合法手
  await setup(page, { turnSide: "red", pieces: [{ cell: 0, side: "red", type: "general" }, { cell: 1, side: "black", type: "pawn" }, { cell: 4, side: "black", type: "pawn" }, { cell: 31, side: "black", type: "rook" }, { cell: 5, side: "red", type: "advisor" }, { cell: 9, side: "black", type: "general" }, { cell: 6, side: "black", type: "cannon", revealed: true }] });
  const stuck = await page.evaluate(() => window.__banqi.getLegalActions(window.__banqi.state, "black").length > 0);
  ok(stuck, "對照局面合法(黑方有棋可走)");
  await ctx.close();
}

/* ════════ ④ 暗子不洩漏:交換兩枚暗子底細,DOM / ARIA / 3D 呈現快照不變;故意洩漏必抓到 ════════ */
section("④ 暗子反例(呈現層)");
{
  const { ctx, page } = await open();
  const snap = () => page.evaluate(() => {
    const R = window.__banqi.renderer;
    const pr = R.probe().pieces.map((x) => [x.index, x.hidden, x.faceKind, x.name, x.userDataKeys.join(","), x.backShared]);
    const dom = [...document.querySelectorAll("#board .cell")].map((c) => [c.className, c.getAttribute("aria-label"), c.textContent.replace(/\s+/g, "")]);
    return JSON.stringify({ pr, dom, pub: window.__banqi.publicCells() });
  });
  await page.evaluate(() => { const B = window.__banqi; B.startNewGame("t"); });
  const s1 = await snap();
  const swapped = await page.evaluate(() => {
    const B = window.__banqi, s = B.state;
    let a = null, b = null;
    for (let i = 0; i < 32 && b === null; i++) for (let j = i + 1; j < 32; j++) {
      const p = s.pieces[s.board[i]], q = s.pieces[s.board[j]];
      if (p.side !== q.side || p.type !== q.type) { a = i; b = j; break; }
    }
    const x = s.board[a], y = s.board[b];
    s.board[a] = y; s.board[b] = x; s.pieces[x].position = b; s.pieces[y].position = a;
    B.render({ fullBoard: true });
    return [a, b];
  });
  const s2 = await snap();
  ok(s1 === s2, `交換暗子 ${swapped} 的底細後,3D 探針 / DOM / ARIA / 公開資訊完全一樣`);
  await page.evaluate(() => { const it = [...window.__banqi.renderer.pieces.items.values()][3]; it.group.userData.type = "general"; });
  const s3 = await snap();
  ok(s3 !== s1, "反例:故意把 userData.type 寫進一枚暗子 ⇒ 快照不同(這支測試抓得到洩漏)");
  await ctx.close();
}

/* ════════ ⑤ 翻面動畫:0% / 25% / 49% 只有背面;過中點才露那一枚;reduced-motion 只提交一次 ════════ */
section("⑤ 翻面動畫分格");
{
  const { ctx, page } = await open();
  await page.evaluate(() => { const B = window.__banqi; B.startNewGame("t"); B.state.mode = "local"; B.render({ fullBoard: true }); });
  await page.locator("#board3d").scrollIntoViewIfNeeded();
  const p = await screenOf(page, 9);
  await page.evaluate(() => window.__banqi.renderer.board.renderer.setAnimationLoop(null));   // 停掉迴圈,手動推時間
  await page.mouse.click(p.x, p.y);
  const frame = (dt) => page.evaluate((dt) => {
    const R = window.__banqi.renderer;
    if (dt) R.pieces.update(dt);
    const pr = R.probe().pieces;
    const me = pr.find((x) => x.index === 9);
    return { me: me.faceKind, others: pr.filter((x) => x.index !== 9).every((x) => x.faceKind === "back" && x.backShared), aria: document.querySelector('#board .cell[data-index="9"]').getAttribute("aria-label"), turn: window.__banqi.state.turnCount };
  }, dt);
  const f0 = await frame(0);
  ok(f0.me === "back" && f0.others && /暗子/.test(f0.aria) && f0.turn === 1, `0%:規則已提交(turn ${f0.turn})但畫面只有背面、朗讀仍是「暗子」`);
  const f25 = await frame(0.32 * 0.25);
  ok(f25.me === "back" && f25.others, "25%:只有背面");
  const f49 = await frame(0.32 * 0.24);
  ok(f49.me === "back" && f49.others, "49%:只有背面");
  const f55 = await frame(0.32 * 0.06);
  ok(f55.me === "face" && f55.others, "過中點:只有這一枚露出正面,其他暗子仍是背面");
  await frame(0.5);
  await page.waitForTimeout(250);
  const aria = await page.evaluate(() => document.querySelector('#board .cell[data-index="9"]').getAttribute("aria-label"));
  ok(!/暗子/.test(aria), `動畫播完朗讀內容更新(${aria})`);
  await ctx.close();
  // reduced-motion
  const r = await open({ reduced: true });
  await r.page.evaluate(() => { const B = window.__banqi; B.startNewGame("t"); B.state.mode = "local"; B.render({ fullBoard: true }); });
  const t0 = Date.now();
  await tap(r.page, 2);
  await r.page.waitForFunction(() => !window.__banqi.animBusy, null, { timeout: 5000 });
  const took = Date.now() - t0;
  const rs = await st(r.page);
  ok(rs.turnCount === 1, `prefers-reduced-motion:只提交一次(turn ${rs.turnCount}),動畫很短(${took}ms 內解鎖)`);
  await r.ctx.close();
}

/* ════════ ⑥ 手勢:拖曳 / 盤外 / cancel / lostcapture / 多指 / 快速雙擊 / Enter 連按 都不多走一手 ════════ */
section("⑥ 手勢與重送");
{
  const { ctx, page } = await open();
  await page.evaluate(() => { const B = window.__banqi; B.startNewGame("t"); B.state.mode = "local"; B.render({ fullBoard: true }); });
  await page.locator("#board3d").scrollIntoViewIfNeeded();
  const p = await screenOf(page, 13);
  const yaw0 = await page.evaluate(() => window.__banqi.renderer.board.yaw);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 30, p.y, { steps: 4 }); await page.mouse.up();
  let s = await st(page);
  const yaw1 = await page.evaluate(() => window.__banqi.renderer.board.yaw);
  ok(s.turnCount === 0 && yaw1 !== yaw0, `在暗子上拖 30px:相機轉了(${yaw0}→${yaw1})、turnCount 不變(${s.turnCount})`);
  const cv = await page.evaluate(() => document.querySelector("#board3dCanvas").getBoundingClientRect().toJSON());
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(cv.right + 60, p.y, { steps: 5 }); await page.mouse.up();
  ok((await st(page)).turnCount === 0, "拖到盤外放開:不翻不走");
  const synth = (seq) => page.evaluate(({ seq, x, y }) => {
    const c = document.querySelector("#board3dCanvas");
    for (const [type, id, primary] of seq) c.dispatchEvent(new PointerEvent(type, { pointerId: id, isPrimary: primary, clientX: x, clientY: y, button: 0, pointerType: "touch", bubbles: true }));
  }, { seq, x: p.x, y: p.y });
  await synth([["pointerdown", 7, true], ["pointercancel", 7, true], ["pointerup", 7, true]]);
  ok((await st(page)).turnCount === 0, "pointercancel 之後的放開不算點擊");
  await synth([["pointerdown", 8, true], ["lostpointercapture", 8, true], ["pointerup", 8, true]]);
  ok((await st(page)).turnCount === 0, "lostpointercapture 之後的放開不算點擊");
  await synth([["pointerdown", 9, true], ["pointerdown", 10, false], ["pointerup", 10, false], ["pointerup", 9, true]]);
  ok((await st(page)).turnCount === 0, "第二根手指加入 ⇒ 這次手勢作廢");
  await synth([["pointerdown", 11, true], ["pointerup", 11, true]]);
  await ready(page);
  ok((await st(page)).turnCount === 1, "對照:同一點正常點一下 ⇒ 翻一枚(turn 1)");
  const q = await screenOf(page, 22);
  await page.mouse.dblclick(q.x, q.y);
  await ready(page);
  ok((await st(page)).turnCount === 2, "快速雙擊暗子:只翻一枚(第二下落在動畫鎖裡)");
  // 鍵盤:Tab 到格子按 Enter 兩次
  await page.focus('#board .cell[data-index="26"]');
  const focusMark = await page.evaluate(() => window.__banqi.keyboardFocusIndex);
  await page.keyboard.press("Enter"); await page.keyboard.press("Enter");
  await ready(page);
  s = await st(page);
  ok(focusMark === 26 && s.turnCount === 3 && s.hidden === 29, `鍵盤:焦點格 3D 有白框(${focusMark})、Enter 連按只翻一枚(turn ${s.turnCount})`);
  await ctx.close();
}

/* ════════ ⑦ Worker:structuredClone 過的純資料能實際送進 Worker 並回合法手;AI 想棋時主執行緒不卡、視角可動 ════════ */
section("⑦ Worker 與主執行緒");
{
  const { ctx, page } = await open();
  const w = await page.evaluate(async () => {
    const B = window.__banqi, s = B.createInitialState({ mode: "ai", difficulty: "master" });
    B.applyActualAction(s, { type: "flip", index: 0 }); s.turnCount = 1;
    const payload = structuredClone({ board: s.board, pieces: s.pieces, turnSide: s.turnSide, humanSide: s.humanSide, aiSide: s.aiSide, mode: "ai", difficulty: "master", turnCount: 1 });
    const worker = new Worker("./ai-worker.js");
    const reply = await new Promise((res) => { worker.onmessage = (e) => res(e.data); worker.postMessage({ gen: 1, reqId: 1, purpose: "ai", turnCount: 1, turnSide: s.turnSide, state: payload }); });
    worker.terminate();
    const legal = B.getLegalActions(s, s.aiSide).some((a) => JSON.stringify(a) === JSON.stringify(reply.action));
    const t0 = performance.now(); const probe = B.cloneState(s); probe.hintLevel = { depth: 3, thinkMs: 900, randomness: 0.08, topChoices: 2 }; B.chooseAiAction(probe); const mainMs = performance.now() - t0;
    return { legal, ms: reply.ms, mainMs: Math.round(mainMs), echoed: reply.gen === 1 && reply.reqId === 1 };
  });
  ok(w.legal && w.echoed, `structuredClone 的局面送進 Worker 回了一手合法動作(Worker 算 ${w.ms}ms;同一搜尋放主執行緒 ${w.mainMs}ms)`);
  /* AI 高手想棋期間:量 rAF 空窗 + 拖曳視角。
     ★ 局面用 test/fixtures/heavy-position.json(24 枚全明子,高手檔在 node 裡吃滿 900ms 預算)——開局那種局面搜尋只要幾 ms,
       量不出任何東西(0929 第一版就是這樣假綠)。同一個搜尋也放主執行緒跑一次當對照:那個數字就是「沒有 Worker 會凍住多久」。 */
  const heavy = JSON.parse(readFileSync(new URL("../test/fixtures/heavy-position.json", import.meta.url), "utf8"));
  await page.evaluate((h) => {
    const B = window.__banqi;
    B.startNewGame("t");
    const s = B.state;   // ★ 要在 startNewGame 之後才拿(它換掉整個 state 物件)
    s.board = h.board.slice(); s.pieces = h.pieces.map((p) => ({ ...p }));
    s.mode = "ai"; s.difficulty = "master"; s.humanSide = "black"; s.aiSide = "red"; s.turnSide = "red"; s.turnCount = 20;
    document.querySelector("#difficultySelect").value = "master";
    B.render({ fullBoard: true });
  }, heavy);
  const mainMs = await page.evaluate(() => { const B = window.__banqi; const p = B.cloneState(B.state); p.hintLevel = { depth: 3, thinkMs: 900, randomness: 0.08, topChoices: 2 }; const t = performance.now(); B.chooseAiAction(p); return Math.round(performance.now() - t); });
  await page.locator("#board3d").scrollIntoViewIfNeeded();
  await page.evaluate(() => { window.__gaps = []; let last = performance.now(); const until = last + 1300; const f = (t) => { window.__gaps.push(t - last); last = t; if (t < until) requestAnimationFrame(f); }; requestAnimationFrame(f); window.__banqi.retryAi(); });
  const c = await page.evaluate(() => document.querySelector("#board3dCanvas").getBoundingClientRect().toJSON());
  const yawA = await page.evaluate(() => window.__banqi.renderer.board.yaw);
  const cx0 = c.left + c.width / 2, cy0 = c.top + c.height / 2;   // 從畫布中央拖(左上角有 🎥 視角鈕)
  await page.mouse.move(cx0, cy0); await page.mouse.down(); await page.mouse.move(cx0 + 120, cy0 + 10, { steps: 8 }); await page.mouse.up();
  const blocked = 20;
  await page.waitForTimeout(1500);
  const g = await page.evaluate(() => ({ max: Math.round(Math.max(...window.__gaps.slice(1))), n: window.__gaps.length, yaw: window.__banqi.renderer.board.yaw, ms: (window.__banqi.searchLog.slice(-1)[0] || {}).purpose }));
  ok(mainMs >= 300, `對照:同一個高手搜尋放主執行緒要 ${mainMs}ms(≥ 300 才量得出差別)`);
  ok(g.max < 200 && g.yaw !== yawA, `AI 高手搜尋期間 rAF 最大空窗 ${g.max}ms(< 200,${g.n} 幀)、拖曳視角有反應(${yawA}→${g.yaw})`, `${ua}`);
  await page.waitForFunction(() => !window.__banqi.state.aiThinking && !window.__banqi.animBusy, null, { timeout: 15000 });
  ok((await st(page)).turnCount === blocked + 1, "AI 最後照樣走了一手");
  await page.evaluate(() => { const B = window.__banqi; B.state.difficulty = "standard"; document.querySelector("#difficultySelect").value = "standard"; B.startNewGame("t"); });
  await tap(page, 0);
  await ready(page);
  // AI 思考中棋盤鎖住、視角面板可用
  await page.evaluate(() => { window.__banqi.searchHooks.delayMs = 1500; });
  const hiddenIdx = await page.evaluate(() => window.__banqi.state.board.findIndex((id, i) => id !== null && !window.__banqi.state.pieces[id].revealed));
  await tap(page, hiddenIdx);
  await page.waitForFunction(() => window.__banqi.state.aiThinking, null, { timeout: 5000 });
  const tc = (await st(page)).turnCount;
  const other = await page.evaluate(() => window.__banqi.state.board.findIndex((id, i) => id !== null && !window.__banqi.state.pieces[id].revealed));
  await tap(page, other);
  await page.click("#viewButton"); await page.click("[data-vk-flip]");
  const lock = await page.evaluate(() => ({ turn: window.__banqi.state.turnCount, yaw: window.__banqi.renderer.board.yaw }));
  ok(lock.turn === tc && Math.round(lock.yaw) % 360 !== Math.round(yawA) % 360, `AI 思考中點棋盤不提交(turn ${lock.turn})、🔃 換邊照樣有反應(yaw ${lock.yaw})`);
  await page.click("[data-vk-reset]"); await page.click("#viewButton");
  await page.evaluate(() => { window.__banqi.searchHooks.delayMs = 0; });
  await ctx.close();
}

/* ════════ ⑧ 過期反例:延遲中重開 / 換每日 / 換模式 / 換難度,舊結果回來不改新局;拿掉守門應該紅 ════════ */
section("⑧ 過期搜尋");
{
  const { ctx, page } = await open();
  const staleCase = async (label, change) => {
    await page.evaluate(() => { const B = window.__banqi; document.querySelector("#modeSelect").value = "ai"; B.state.mode = "ai"; B.startNewGame("t"); B.searchHooks.delayMs = 1200; });
    await tap(page, 0);
    await page.waitForFunction(() => window.__banqi.state.aiThinking, null, { timeout: 5000 });
    await change();
    await page.waitForTimeout(100);
    const snap0 = await st(page);
    await page.waitForTimeout(1800);
    const snap1 = await st(page);
    const same = JSON.stringify([snap0.board, snap0.turnCount, snap0.winner, snap0.hidden]) === JSON.stringify([snap1.board, snap1.turnCount, snap1.winner, snap1.hidden]);
    const log = await page.evaluate(() => window.__banqi.searchLog.slice(-1)[0] || null);
    return { same, snap1, log };
  };
  let r = await staleCase("重開", () => page.click("#newGameButton"));
  ok(r.same && r.snap1.turnCount === 0 && r.snap1.hidden === 32, `延遲中按重新開局 ⇒ 舊 AI 結果回來,新局 32 枚、turn 0 完全不變`);
  r = await staleCase("每日", () => page.click("#dailyButton"));
  ok(r.same && r.snap1.turnCount === 0, "延遲中切每日同副牌 ⇒ 新局不被舊結果改動");
  r = await staleCase("模式", () => page.selectOption("#modeSelect", "local"));
  ok(r.same && r.snap1.turnCount === 0, "延遲中切雙人同機 ⇒ 新局不被舊結果改動");
  r = await staleCase("難度", async () => { await page.selectOption("#difficultySelect", "casual"); });
  const diff = await page.evaluate(() => ({ log: window.__banqi.searchLog.slice(-1)[0], turn: window.__banqi.state.turnCount }));
  ok(diff.turn === 2 && diff.log && diff.log.replyGen === diff.log.gen, `延遲中換難度 ⇒ 舊檔位結果作廢、用新檔位重算走一手(turn ${diff.turn})`, JSON.stringify(diff));
  // 反例:拿掉守門 ⇒ 舊局的回覆被新局採用(至少一條必須紅)
  await page.evaluate(() => { const B = window.__banqi; B.searchHooks.unsafeNoGuard = true; document.querySelector("#modeSelect").value = "ai"; B.state.mode = "ai"; B.startNewGame("t"); B.searchHooks.delayMs = 1200; });
  await tap(page, 0);
  await page.waitForFunction(() => window.__banqi.state.aiThinking, null, { timeout: 5000 });
  await page.click("#newGameButton");
  await page.waitForTimeout(150);
  await tap(page, 5);                                       // 新局也輪到 AI ⇒ 有一個新請求在等
  await page.waitForTimeout(2600);
  const bad = await page.evaluate(() => window.__banqi.searchLog.slice(-2));
  const leaked = bad.some((x) => x.replyGen !== x.gen || x.replyReqId !== x.reqId);
  ok(leaked, "反例:拿掉世代守門 ⇒ 舊局的回覆被新局採用(被抓到,證明守門不是擺設)", JSON.stringify(bad));
  await page.evaluate(() => { const B = window.__banqi; B.searchHooks.unsafeNoGuard = false; B.searchHooks.delayMs = 0; });
  await ctx.close();
}

/* ════════ ⑨ Worker 錯誤 / 逾時 → 重試 AI;提示失敗可繼續 ════════ */
section("⑨ AI 失敗與重試、提示失敗");
{
  const { ctx, page } = await open();
  await page.evaluate(() => { const B = window.__banqi; B.startNewGame("t"); B.searchHooks.fail = true; });
  await tap(page, 0);
  await page.waitForFunction(() => !document.querySelector("#retryAiButton").hidden, null, { timeout: 8000 });
  let s = await st(page);
  ok(!s.aiThinking && s.winner === null && /重試 AI/.test(s.msg), `Worker 出錯 ⇒ 不再思考中、winner 仍空、顯示「重試 AI」(${s.msg})`);
  const other = await page.evaluate(() => window.__banqi.state.board.findIndex((id, i) => i > 0 && id !== null && !window.__banqi.state.pieces[id].revealed));
  await tap(page, other);
  ok((await st(page)).turnCount === 1, "這時玩家不能代 AI 走(點棋盤沒反應)");
  await page.evaluate(() => { window.__banqi.searchHooks.fail = false; });
  await page.click("#retryAiButton");
  await page.waitForFunction(() => window.__banqi.state.turnCount === 2 && !window.__banqi.animBusy, null, { timeout: 15000 });
  await page.waitForTimeout(500);
  s = await st(page);
  ok(s.turnCount === 2 && (await page.evaluate(() => document.querySelector("#retryAiButton").hidden)), "按「重試 AI」⇒ AI 只走一手、重試鈕收起");
  // 逾時(10 秒)
  await page.evaluate(() => { const B = window.__banqi; B.startNewGame("t"); B.searchHooks.hang = true; });
  await tap(page, 3);
  await page.waitForFunction(() => !document.querySelector("#retryAiButton").hidden, null, { timeout: 14000 }).catch(() => {});
  s = await st(page);
  ok(!s.aiThinking && /重試 AI/.test(s.msg), "Worker 10 秒不回 ⇒ 顯示「重試 AI」(不會永遠停在思考中)");
  await page.evaluate(() => { window.__banqi.searchHooks.hang = false; });
  // 提示失敗
  await page.evaluate(() => { const B = window.__banqi; document.querySelector("#modeSelect").value = "local"; B.state.mode = "local"; B.startNewGame("t"); });
  await tap(page, 0); await ready(page);
  await page.evaluate(() => { window.__banqi.searchHooks.fail = true; });
  await page.click("#hintButton");
  await page.waitForFunction(() => /算不出來/.test(document.querySelector("#statusMessage").textContent), null, { timeout: 5000 }).catch(() => {});
  const h = await page.evaluate(() => ({ msg: document.querySelector("#statusMessage").textContent, disabled: document.querySelector("#hintButton").disabled }));
  ok(/算不出來/.test(h.msg) && !h.disabled, `提示失敗 ⇒「${h.msg}」、💡 鈕可再按`);
  await page.evaluate(() => { window.__banqi.searchHooks.fail = false; });
  const nx = await page.evaluate(() => window.__banqi.state.board.findIndex((id, i) => id !== null && !window.__banqi.state.pieces[id].revealed));
  await tap(page, nx); await ready(page);
  ok((await st(page)).turnCount === 2, "提示失敗後照樣能下");
  await ctx.close();
}

/* ════════ ⑩ 每日:升級前後逐位元相同;多日成績保留;重畫不加 played ════════ */
section("⑩ 每日同副牌");
{
  const golden = JSON.parse(readFileSync(new URL("../test/fixtures/daily-golden.json", import.meta.url), "utf8"));
  const store = { "2026-09-27": { decks: { 1: { best: 9, played: 2 } } }, "2026-09-28": { decks: { 2: { best: 14, played: 1 } } } };
  const { ctx, page } = await open({ init: { fn: (s) => { try { localStorage.setItem("cloud-banqi:daily:v1", JSON.stringify(s)); } catch {} }, arg: store } });
  const diffs = await page.evaluate((rows) => rows.filter((r) => JSON.stringify(window.__banqi.createInitialState({ dailyKey: r.date, dailyDeck: r.deck }).board) !== JSON.stringify(r.board)).length, golden.rows);
  ok(diffs === 0, `${golden.rows.length} 副(4 天 × 第 1/2/3 副)跟升級前 784d49e 逐位元相同`);
  const kept = await page.evaluate(() => localStorage.getItem("cloud-banqi:daily:v1"));
  ok(kept === JSON.stringify(store), "既有多日成績載入 3D 版後原封不動");
  await ctx.close();
}

/* ════════ ⑪ 螢幕矩陣 × DPR:盤在畫布內、四角真點得到、沒有橫向捲動、觸控目標 ≥ 44px、有動物盤寬 ≥ 75% ════════ */
section("⑪ 螢幕矩陣");
for (const dpr of [1, 3]) for (const [w, h] of [[1200, 800], [390, 844], [844, 390], [768, 1024], [1280, 720]]) {
  const { ctx, page } = await open({ viewport: { width: w, height: h }, dpr, ctxOpts: w < 900 ? { isMobile: true, hasTouch: true } : {} });
  await page.locator("#board3d").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const R = window.__banqi.renderer, cv = document.querySelector("#board3dCanvas").getBoundingClientRect();
    const box = R.boardScreenBox();
    const corners = [0, 3, 28, 31, 13].map((i) => { const p = R.cellToScreen(i); const el = document.elementFromPoint(p.x, p.y); return { i, hit: R.pick(p.x, p.y), el: el && el.id }; });
    const tb = [...document.querySelectorAll("#viewButton, #newGameButton, #hintButton, #dailyButton")].filter((b) => b.offsetParent).map((b) => Math.round(Math.min(b.getBoundingClientRect().height, 999)));
    return { inCanvas: box.l >= cv.left - 1 && box.r <= cv.right + 1 && box.t >= cv.top - 1 && box.b <= cv.bottom + 1, corners,
      hscroll: document.documentElement.scrollWidth > innerWidth + 1, minTap: Math.min(...tb), dpr: R.probe().dpr, w: box.w, pet: window.__banqi.pet ? window.__banqi.pet.visible : null };
  });
  const tag = `${w}×${h} @${dpr}x`;
  ok(m.inCanvas, `${tag} 整塊盤在畫布內`);
  ok(m.corners.every((c) => c.hit === c.i && c.el === "board3dCanvas"), `${tag} 四角 + 中央都點得到、沒被按鈕蓋住`, JSON.stringify(m.corners));
  ok(!m.hscroll, `${tag} 沒有橫向捲動`);
  ok(m.minTap >= 44, `${tag} 按鈕觸控高度 ≥ 44px(最小 ${m.minTap})`);
  ok(m.dpr === Math.min(dpr, 2), `${tag} DPR 夾在 2(${m.dpr})`);
  if (m.pet) {
    await page.click('#petControls [data-pet="off"]').catch(() => {});
    await page.waitForTimeout(150);
    const w0 = await page.evaluate(() => window.__banqi.renderer.boardScreenBox().w);
    await page.click('#petControls [data-pet="voice"]').catch(() => {});
    ok(m.w >= w0 * 0.75, `${tag} 有動物盤寬 ${Math.round(m.w)} ≥ 關閉 ${Math.round(w0)} 的 75%`);
  }
  if (SHOTS && dpr === 1) await page.screenshot({ path: `scripts/out/vp-${w}x${h}.png` });
  await ctx.close();
}

/* ════════ ⑫ 視角遷移與壞 storage ════════ */
section("⑫ 舊視角遷移 / 壞設定");
{
  const legacy = JSON.parse(readFileSync(new URL("../test/fixtures/legacy-view-golden.json", import.meta.url), "utf8"));
  for (const row of legacy.rows) {
    const { ctx, page } = await open({ init: { fn: (s) => { try { localStorage.setItem("cloud-banqi-settings-v1", JSON.stringify({ mode: "ai", difficulty: "standard", perspective: "angled", viewSpin: s, viewTilt: 44 })); localStorage.setItem("banqi-pet", "off"); } catch {} }, arg: row.spin } });
    const r = await page.evaluate(() => {
      const R = window.__banqi.renderer, pts = {};
      for (const i of [0, 3, 28, 31]) pts[i] = R.cellToScreen(i);
      const cx = (pts[0].x + pts[3].x + pts[28].x + pts[31].x) / 4, cy = (pts[0].y + pts[3].y + pts[28].y + pts[31].y) / 4;
      const ang = {}; for (const k of Object.keys(pts)) ang[k] = Math.atan2(pts[k].y - cy, pts[k].x - cx) * 180 / Math.PI;
      return { ang, view: R.getView(), pitch: R.probe().pitch, stored: localStorage.getItem("cloud-banqi-settings-v1") };
    });
    const worst = Math.max(...Object.keys(row.angles).map((k) => { const d = Math.abs(((r.ang[k] - row.angles[k]) % 360 + 540) % 360 - 180); return d; }));
    ok(worst <= 20, `舊 spin ${row.spin}/tilt 44 ⇒ yaw ${r.view.yaw}、俯角 ${r.pitch}°;四個角的畫面方位跟舊版差 ≤ 20°(最大 ${worst.toFixed(1)}°)`);
    if (row.spin === 350) ok(r.view.yaw === 350 && Math.abs(r.pitch - 46) < 0.01, `預設 tilt44/spin350 ⇒ 相機俯角 46°(${r.pitch})`);
    ok(JSON.parse(r.stored).viewSpin === row.spin && JSON.parse(r.stored).viewTilt === 44, "舊角度備份沒有被覆寫");
    await ctx.close();
  }
  let o = await open({ init: { fn: () => { try { localStorage.setItem("cloud-banqi-settings-v1", JSON.stringify({ perspective: "flat" })); } catch {} } } });
  let v = await o.page.evaluate(() => ({ view: window.__banqi.renderer.getView(), pitch: window.__banqi.renderer.probe().pitch }));
  ok(v.view.preset === "flat" && v.pitch === 88, `舊「平面」偏好 ⇒ 正俯視 88°(不是關掉 3D)(${JSON.stringify(v)})`);
  await o.ctx.close();
  o = await open({ init: { fn: () => { try { localStorage.setItem("cloud-banqi-3d-view-v1", "{壞掉的 JSON"); localStorage.setItem("cloud-banqi:daily:v1", "{\"2026-09-28\":{\"decks\":{\"1\":{\"best\":7,\"played\":1}}}}"); } catch {} } } });
  await tap(o.page, 0);
  await o.page.waitForFunction(() => window.__banqi.state.turnCount >= 1, null, { timeout: 8000 });
  v = await o.page.evaluate(() => ({ mode: window.__banqi.rendererMode, daily: localStorage.getItem("cloud-banqi:daily:v1") }));
  ok(v.mode === "3d" && v.daily.includes("\"best\":7"), "新視角鍵是壞 JSON ⇒ 照樣 3D 可玩、每日成績沒被清掉");
  await o.ctx.close();
  o = await open({ init: { fn: () => { const bad = () => { throw new Error("blocked"); }; Storage.prototype.getItem = bad; Storage.prototype.setItem = bad; } } });
  await tap(o.page, 0);
  await o.page.waitForFunction(() => window.__banqi.state.turnCount >= 1, null, { timeout: 8000 }).catch(() => {});
  v = await o.page.evaluate(() => ({ mode: window.__banqi.rendererMode, turn: window.__banqi.state.turnCount }));
  ok(v.mode === "3d" && v.turn >= 1, "storage 整個被擋 ⇒ 照樣 3D、照樣能翻子");
  await o.ctx.close();
}

/* ════════ ⑬ 平面退路:開場 WebGL 失敗 / 途中 context lost ════════ */
section("⑬ 平面退路");
{
  const noGL = { fn: () => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...a) { return /webgl/i.test(t) ? null : g.call(this, t, ...a); }; } };
  let o = await open({ init: noGL });
  let r = await o.page.evaluate(() => ({ mode: window.__banqi.rendererMode, notice: document.querySelector("#renderNotice").textContent, cells: document.querySelectorAll("#board .cell").length, visible: document.querySelector("#board").getBoundingClientRect().width > 100, has3d: document.body.classList.contains("has-3d") }));
  ok(r.mode === "flat" && !r.has3d && r.cells === 32 && r.visible, "WebGL 建不起來 ⇒ 平面棋盤 32 格看得見");
  ok(r.notice === "此裝置暫時無法顯示 3D，已切換平面棋盤，這局可以繼續。", `說明文案(${r.notice})`);
  await o.page.focus('#board .cell[data-index="6"]');
  await o.page.keyboard.press("Enter");
  await o.page.waitForFunction(() => window.__banqi.state.turnCount >= 1, null, { timeout: 5000 }).catch(() => {});
  ok((await st(o.page)).turnCount >= 1, "平面退路鍵盤 Enter 可翻子");
  await o.ctx.close();
  o = await open();
  await o.page.evaluate(() => { const B = window.__banqi; document.querySelector("#modeSelect").value = "local"; B.state.mode = "local"; B.startNewGame("t"); });
  await tap(o.page, 0); await ready(o.page);
  await tap(o.page, 9); await ready(o.page);
  const before = await st(o.page);
  const lost = await o.page.evaluate(() => window.__banqi.renderer.loseContext());
  await o.page.waitForFunction(() => window.__banqi.rendererMode === "flat", null, { timeout: 5000 }).catch(() => {});
  const after = await st(o.page);
  r = await o.page.evaluate(() => ({ notice: document.querySelector("#renderNotice").textContent, revealedDom: [...document.querySelectorAll("#board .cell")].filter((c) => !/暗子|空格/.test(c.getAttribute("aria-label"))).length }));
  ok(lost && after.turnCount === before.turnCount && JSON.stringify(after.board) === JSON.stringify(before.board) && after.hidden === before.hidden, `途中 context lost ⇒ 同一局接著下(turn ${after.turnCount}、暗子 ${after.hidden} 不變)`);
  ok(r.notice === "3D 畫面已中斷，已切換平面棋盤，這局可以繼續。" && r.revealedDom === 2, `中斷說明文案 + 平面盤顯示已翻的 2 枚(${r.notice})`);
  await o.ctx.close();
}

/* ════════ ⑭ 20 次新局 / 轉向:只有一個 renderer、一條迴圈、一個 Worker ════════ */
section("⑭ 資源不增長");
{
  const { ctx, page } = await open();
  await page.evaluate(() => { window.__r0 = window.__banqi.renderer; window.__t0 = window.__banqi.renderer.board._ticks.size; });
  for (let i = 0; i < 20; i++) {
    await page.click("#newGameButton");
    await page.setViewportSize(i % 2 ? { width: 1200, height: 800 } : { width: 800, height: 1100 });
  }
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({ same: window.__banqi.renderer === window.__r0, ticks: window.__banqi.renderer.board._ticks.size, t0: window.__t0, canvases: document.querySelectorAll("canvas").length, pieces: window.__banqi.renderer.probe().pieces.length, sceneKids: window.__banqi.renderer.board.scene.children.length }));
  ok(r.same && r.ticks === r.t0 && r.canvases === 1 && r.pieces === 32, `20 次新局 + 轉向:同一個 renderer、tick 數 ${r.ticks} 不變、1 張畫布、32 枚`, JSON.stringify(r));
  await ctx.close();
}

/* ════════ ⑮ 新檔是真的 JS(不是首頁冒充)+ SW 名單 ════════ */
section("⑮ 新檔與 SW");
{
  const { ctx, page } = await open();
  const files = ["banqi-core.js", "ai-worker.js", "js/three-full.js", "js/board3d.js", "js/pieces3d.js", "js/view-kit.js", "js/scene3d.js", "js/opponent.js", "vendor/three.r128.min.js"];
  const res = await page.evaluate(async (files) => Promise.all(files.map(async (f) => { const r = await fetch("./" + f, { cache: "no-store" }); const t = await r.text(); return { f, ok: r.ok, html: /^\s*<!doctype|^\s*<html/i.test(t), type: r.headers.get("content-type") || "" }; })), files);
  ok(res.every((x) => x.ok && !x.html && /javascript/.test(x.type)), "新檔都回 200 + JavaScript(不是首頁 HTML 冒充)", JSON.stringify(res.filter((x) => !x.ok || x.html || !/javascript/.test(x.type))));
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  ok(files.every((f) => sw.includes(`"./${f}"`)), "sw.js 預快取名單包含全部新檔");
  ok(!/["']\.\/index\.html["']/.test(sw.replace(/\/\/.*$/gm, "")), "sw.js 名單沒有 ./index.html(0914 地雷)");
  await ctx.close();
}

/* ════════ ⑯ 離線:SW 裝好後斷網重開,3D + Worker 照樣可玩 ════════ */
section("⑯ 離線");
{
  const { ctx, page } = await open({ sw: "allow" });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(async () => { const keys = await caches.keys(); if (!keys.length) return false; const c = await caches.open(keys[0]); return !!(await c.match("./vendor/three.r128.min.js")) && !!(await c.match("./ai-worker.js")); }, null, { timeout: 30000, polling: 500 }).catch(() => {});
  const cached = await page.evaluate(async () => { const keys = await caches.keys(); const c = await caches.open(keys[0]); const r = await c.match("./"); const all = (await c.keys()).map((q) => q.url); return { keys, redirected: r ? r.redirected : null, indexHtml: all.some((u) => /index\.html$/.test(u)), n: all.length }; });
  ok(cached.redirected === false && !cached.indexHtml, `SW 快取的殼層不是 redirected、名單沒有 index.html(${cached.keys};${cached.n} 筆)`);
  await ctx.setOffline(true);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__banqi && window.__banqi.rendererMode !== "pending", null, { timeout: 20000 }).catch(() => {});
  const mode = await page.evaluate(() => window.__banqi && window.__banqi.rendererMode);
  await tap(page, 0);
  await page.waitForFunction(() => window.__banqi.state.turnCount >= 2 && !window.__banqi.animBusy, null, { timeout: 20000 }).catch(() => {});
  const s = await st(page);
  ok(mode === "3d" && s.turnCount >= 2, `斷網重開:3D(${mode})、翻子 + Worker AI 回手(turn ${s.turnCount})`);
  await ctx.close();
}

ok(errors.length === 0, "整場零 pageerror", errors.join(" | ").slice(0, 400));
await browser.close();
console.log(`\n🔬 check-3d:${pass} 過 / ${fail} 失敗   (${ua},無頭)`);
process.exit(fail ? 1 : 0);
