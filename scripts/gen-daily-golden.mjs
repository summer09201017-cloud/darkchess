// 產「每日同副牌黃金檔」test/fixtures/daily-golden.json:升級前(784d49e)固定日期 × 第 1/2/3 副的 32 格擺法。
// scripts/check-3d.mjs 拿新版逐位元比對(規格 §5:每日固定日期第1/2/3副在升級前後逐位元相同)。
// ★ 2026-09-29 用 784d49e 的 worktree(埠 8798)錄一次;之後**不要**用新版重錄。
// 跑法:(在舊版 worktree)py -m http.server 8798 → CHECK_URL=http://localhost:8798 node scripts/gen-daily-golden.mjs
import { chromium } from "playwright-core";
import { writeFileSync, mkdirSync } from "node:fs";
const URL = process.env.CHECK_URL || "http://localhost:8798";
let browser = null;
for (const channel of ["msedge", "chrome"]) { try { browser = await chromium.launch({ channel, headless: true }); break; } catch {} }
const page = await browser.newPage();
await page.goto(`${URL}/?v=${Date.now()}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__banqi && window.BanqiDaily);
const DATES = ["2026-09-28", "2026-09-29", "2026-12-31", "2027-01-01"];
const rows = await page.evaluate((dates) => dates.flatMap((d) => [1, 2, 3].map((n) => ({ date: d, deck: n, board: window.__banqi.createInitialState({ dailyKey: d, dailyDeck: n }).board }))), DATES);
mkdirSync("test/fixtures", { recursive: true });
writeFileSync("test/fixtures/daily-golden.json", JSON.stringify({ note: "錄自升級前 784d49e", rows }) + "\n");
console.log(`錄了 ${rows.length} 副`);
await browser.close();
