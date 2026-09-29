// 產「舊 CSS 視角黃金檔」test/fixtures/legacy-view-golden.json:升級前(784d49e)在 viewTilt 44、viewSpin 0/90/180/270/350 時,
// 四個角格(idx 0/3/28/31)中心相對棋盤中心的畫面方向角 + 棋盤投影長寬比。
// scripts/check-3d.mjs 用它驗「舊設定遷移成 3D 相機後,四個角在畫面上的方位跟以前一樣」(規格 §2:用四角投影驗證符號後才定 adapter)。
// ★ 2026-09-29 用 784d49e 的 worktree(埠 8798)錄一次;之後不要重錄。
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";
const URL = process.env.CHECK_URL || "http://localhost:8798";
let browser = null;
for (const channel of ["msedge", "chrome"]) { try { browser = await chromium.launch({ channel, headless: true }); break; } catch {} }
const out = [];
for (const spin of [0, 90, 180, 270, 350]) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await ctx.addInitScript((s) => { try { localStorage.setItem("cloud-banqi-settings-v1", JSON.stringify({ mode: "ai", difficulty: "standard", perspective: "angled", viewSpin: s, viewTilt: 44 })); } catch {} }, spin);
  const page = await ctx.newPage();
  await page.goto(`${URL}/?v=${Date.now()}`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => {
    const c = (i) => { const b = document.querySelector(`#board .cell[data-index="${i}"]`).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const pts = { 0: c(0), 3: c(3), 28: c(28), 31: c(31) };
    const cx = (pts[0].x + pts[3].x + pts[28].x + pts[31].x) / 4, cy = (pts[0].y + pts[3].y + pts[28].y + pts[31].y) / 4;
    const ang = {};
    for (const k of Object.keys(pts)) ang[k] = Math.round(Math.atan2(pts[k].y - cy, pts[k].x - cx) * 180 / Math.PI);
    return ang;
  });
  out.push({ spin, tilt: 44, angles: r });
  await ctx.close();
}
writeFileSync("test/fixtures/legacy-view-golden.json", JSON.stringify({ note: "錄自升級前 784d49e;角度 = atan2(dy,dx) 度,畫面座標 y 向下", rows: out }) + "\n");
console.log(JSON.stringify(out));
await browser.close();
