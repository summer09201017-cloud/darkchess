// 🔬 ⛶ 放大 / fit-play「玩的版面」真瀏覽器驗收(v9,2026-09-14;playwright-core + 系統 Edge/Chrome;跟 3d-chess-co 同一套)。
// 跑法:py -m http.server 8797(或任何靜態伺服器)後 node scripts/check-fit.mjs
//       線上:CHECK_URL=https://darkchesscodex.pages.dev node scripts/check-fit.mjs
// 由來:0914 全艦隊棋類體檢——按了「放大」棋盤還在畫面外(直向 y=760/844、橫向 y=584/390),PC 沒有 ⛶。
//   桌機 1280×720:① ⛶ 看得見 ② 按 ⇒ immersive+fit-play、hero 藏、棋盤投影框整個在畫面內且 ≥55% 高、不捲、✕ 看得見 ③ 按 ✕ 復原
//   手機橫向 844×390:④ 不按就是 fit-play、棋盤在畫面內且 ≥70% 高、狀態卡在右欄 ⑤ 「☰ 選單」⇒ 控制卡回來;再按收回
//   手機直向 390×844:⑥ 按 ⛶ ⇒ 棋盤在畫面內、投影高 ≥ 300px、不捲、狀態看得見 ⑦ 按 ✕ 復原  ⑧ 零 pageerror
import { chromium, devices } from "playwright-core";

const URL = (process.env.CHECK_URL || "http://localhost:8797").replace(/\/$/, "");
let browser = null;
for (const channel of ["msedge", "chrome"]) {
  try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* 換下一個 */ }
}
if (!browser) { console.error("找不到系統 Edge/Chrome"); process.exit(1); }

let pass = 0, fail = 0;
const ok = (cond, msg, note = "") => {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.error("  ✗ " + msg + (note ? " → " + note : "")); }
};
const errors = [];

const snap = (page) => page.evaluate(() => {
  const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom), vis: !!e.offsetParent && getComputedStyle(e).display !== "none" }; };
  const fixedVis = (sel) => { const e = document.querySelector(sel); if (!e) return false; const cs = getComputedStyle(e); const b = e.getBoundingClientRect(); return cs.display !== "none" && b.width > 0 && b.top >= 0 && b.bottom <= innerHeight && b.left >= 0; };
  /* 棋盤投影框:🧊 v12 真 3D ⇒ Board3D 四個盤角(含木框留白)投影到螢幕的外框(renderer.boardScreenBox,跟 fitCamera 同一套投影);
     平面退路(沒有 renderer)才量 #board 所有子孫聯集(含 rotateX/rotateZ 透視)。
     ★ 3D 模式的 #board 是 1px 的無障礙層,量它等於量空氣 —— 這是 v12 改驗法的理由,不是放寬。 */
  const board = document.querySelector("#board");
  let bb = null;
  const R3 = window.__banqi && window.__banqi.renderer;
  if (R3) { const q = R3.boardScreenBox(); bb = { x: Math.round(q.l), y: Math.round(q.t), w: Math.round(q.w), h: Math.round(q.h), right: Math.round(q.r), bottom: Math.round(q.b) }; }
  else if (board) { const q = board.getBoundingClientRect(); let x0 = q.left, y0 = q.top, x1 = q.right, y1 = q.bottom; for (const e of board.querySelectorAll("*")) { const c = e.getBoundingClientRect(); if (!c.width) continue; x0 = Math.min(x0, c.left); y0 = Math.min(y0, c.top); x1 = Math.max(x1, c.right); y1 = Math.max(y1, c.bottom); } bb = { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0), right: Math.round(x1), bottom: Math.round(y1) }; }
  return {
    body: document.body.className, vw: innerWidth, vh: innerHeight, scrollH: document.documentElement.scrollHeight,
    board: bb, status: r("#statusMessage"), hero: r(".hero"), controlBar: r(".control-bar"), statusCard: r(".status-card"),
    fullVis: fixedVis("#mfsFull"), exitVis: fixedVis("#mfsExit"), menuChip: r("#playMenuButton"),
  };
});
const inView = (b, s) => b && b.x >= -1 && b.y >= -1 && b.right <= s.vw + 1 && b.bottom <= s.vh + 1;
const settleBoard = async (page) => {
  let last = "";
  await page.waitForFunction(() => window.__banqi && window.__banqi.rendererMode !== "pending", null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(150);
    const now = await page.evaluate(() => { const R3 = window.__banqi && window.__banqi.renderer; const r = R3 ? (({ l, t, w, h }) => ({ x: l, y: t, width: w, height: h }))(R3.boardScreenBox()) : document.getElementById("board").getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(","); });
    if (now === last) return;
    last = now;
  }
};
const clickFixed = async (page, sel) => { const b = await page.evaluate((q) => { const r = document.querySelector(q).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel); await page.mouse.click(b.x, b.y); await settleBoard(page); };

console.log("── 桌機 1280×720 ──");
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => errors.push("desktop: " + String(e)));
  await page.goto(URL + "/?v=" + Date.now(), { waitUntil: "load" });
  await settleBoard(page);
  let s = await snap(page);
  ok(s.fullVis, "① 桌機右上角看得到 ⛶(以前只給觸控裝置)");
  ok(!s.body.includes("fit-play"), "① 沒按之前是一般版面", s.body);
  const before = s.board;
  await clickFixed(page, "#mfsFull");
  s = await snap(page);
  ok(s.body.includes("immersive") && s.body.includes("fit-play"), "② 按 ⛶ ⇒ body.immersive + fit-play", s.body);
  ok(s.hero && !s.hero.vis, "② 標題列藏起來");
  ok(inView(s.board, s), "② 棋盤投影框(含所有棋子)整個在畫面內", JSON.stringify(s.board));
  ok(s.board && s.board.h >= s.vh * 0.55, "② 棋盤投影高 ≥ 55% 螢幕", `${s.board?.h}/${s.vh}`);
  // 暗棋是 4×8 的直長棋盤:桌機 720px 高時它本來就比螢幕高、要捲 ⇒「更大」不是對的判準,「整個在畫面內」才是(上一條)。
  ok(s.board && before && (!inView(before, s) || s.board.h > before.h * 1.05), "② 之前棋盤根本不在畫面內(要捲),或現在更大", `${before?.h}(inView=${inView(before, s)}) → ${s.board?.h}`);
  ok(s.scrollH <= s.vh + 2, "② 整頁一屏、不用捲", `${s.scrollH} vs ${s.vh}`);
  ok(s.exitVis && !s.fullVis, "② ✕ 離開看得見、⛶ 藏起來");
  ok(s.status && s.status.vis && inView(s.status, s), "② 狀態訊息看得見");
  await clickFixed(page, "#mfsExit");
  s = await snap(page);
  ok(!s.body.includes("immersive") && !s.body.includes("fit-play"), "③ 按 ✕ ⇒ 都關", s.body);
  ok(s.hero && s.hero.vis && s.fullVis, "③ 標題列回來、⛶ 回來");
  await page.close();
}

console.log("── 手機橫向 844×390 ──");
{
  const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("landscape: " + String(e)));
  await page.goto(URL + "/?v=" + Date.now(), { waitUntil: "load" });
  await settleBoard(page);
  let s = await snap(page);
  ok(s.body.includes("fit-play") && !s.body.includes("immersive"), "④ 轉橫向不用按鈕就自動滿版", s.body);
  ok(inView(s.board, s), "④ 棋盤投影框整個在畫面內(以前頂端在 y=584/390)", JSON.stringify(s.board));
  ok(s.board && s.board.h >= s.vh * 0.7, "④ 棋盤投影高 ≥ 70% 螢幕", `${s.board?.h}/${s.vh}`);
  ok(s.statusCard && s.statusCard.x >= s.vw - 220, "④ 狀態卡在右欄", JSON.stringify(s.statusCard));
  ok(s.scrollH <= s.vh + 2, "④ 整頁一屏、不用捲", `${s.scrollH} vs ${s.vh}`);
  ok(s.fullVis, "④ ⛶ 仍看得見");
  ok(s.menuChip && s.menuChip.vis && inView(s.menuChip, s), "⑤ 「☰ 選單」鈕在畫面內", JSON.stringify(s.menuChip));
  await page.click("#playMenuButton");
  await settleBoard(page);
  s = await snap(page);
  ok(s.body.includes("panels-open"), "⑤ 按 ☰ ⇒ body.panels-open", s.body);
  ok(s.controlBar && s.controlBar.vis, "⑤ 模式/AI 強度那張卡回來了");
  ok(s.scrollH > s.vh, "⑤ 這時是一般長頁版面", `${s.scrollH}`);
  await page.click("#playMenuButton");
  await settleBoard(page);
  s = await snap(page);
  ok(!s.body.includes("panels-open") && inView(s.board, s), "⑤ 再按 ⇒ 收回、棋盤又整個在畫面內");
  await ctx.close();
}

console.log("── 手機直向 390×844 ──");
{
  const ctx = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("portrait: " + String(e)));
  await page.goto(URL + "/?v=" + Date.now(), { waitUntil: "load" });
  await settleBoard(page);
  let s = await snap(page);
  ok(!s.body.includes("fit-play"), "⑥ 直向沒按之前是一般版面", s.body);
  await clickFixed(page, "#mfsFull");
  s = await snap(page);
  ok(s.body.includes("fit-play"), "⑥ 按 ⛶ ⇒ fit-play", s.body);
  ok(inView(s.board, s), "⑥ 棋盤投影框整個在畫面內(以前頂端在 y=760/844)", JSON.stringify(s.board));
  ok(s.board && s.board.h >= 300, "⑥ 棋盤投影高 ≥ 300px", `${s.board?.h}`);
  ok(s.scrollH <= s.vh + 2, "⑥ 整頁一屏、不用捲(以前 2700px)", `${s.scrollH} vs ${s.vh}`);
  ok(s.status && s.status.vis && inView(s.status, s), "⑥ 狀態訊息看得見");
  ok(s.exitVis, "⑥ ✕ 離開看得見");
  await clickFixed(page, "#mfsExit");
  s = await snap(page);
  ok(!s.body.includes("fit-play") && s.hero && s.hero.vis, "⑦ 按 ✕ ⇒ 復原", s.body);
  await ctx.close();
}

ok(errors.length === 0, "⑧ 整場零 pageerror", errors.join(" | ").slice(0, 300));
await browser.close();
console.log(`\ncheck-fit: ${pass} 綠 / ${fail} 紅`);
process.exit(fail ? 1 : 0);
