// 模擬「手機上已安裝舊版 → 伺服器換新版 → App 切回前景」:還沒下棋要自動換新;下到一半要出現更新鈕
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");
// 跑法:把站複製到一個暫存資料夾(會被改寫),SWTEST_DIR=<那個資料夾> node scripts/check-sw-update.mjs
const DIR = process.env.SWTEST_DIR; if (!DIR) { console.error("要給 SWTEST_DIR(站的暫存副本,會被改寫)"); process.exit(2); }
const srv = spawn("python", ["-m", "http.server", "8798", "--bind", "127.0.0.1", "--directory", DIR], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 1200));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m); } };
const bump = (tag) => {
  const ih = DIR + "/index.html", sw = DIR + "/sw.js";
  writeFileSync(ih, readFileSync(ih, "utf8").replace(/<summary>版本 v\w+/, `<summary>版本 ${tag}`));
  writeFileSync(sw, readFileSync(sw, "utf8").replace(/cloud-banqi-v\w+/, `cloud-banqi-${tag}`));
};
const summary = (p) => p.evaluate(() => document.querySelector(".ver-fold summary").textContent.slice(0, 12));
try {
  const b = await chromium.launch({ channel: "msedge", headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
  const p = await ctx.newPage();
  await p.goto("http://127.0.0.1:8798/", { waitUntil: "load" });
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload({ waitUntil: "load" });
  ok(await p.evaluate(() => Boolean(navigator.serviceWorker.controller)), "第一次安裝後,頁面由 SW 接管(= 已安裝的 App)");
  const v0 = await summary(p);
  // 情境 A:還沒下棋 ⇒ 換新版後切回前景,自動重新整理成新版
  bump("vA1");
  const nav = p.waitForNavigation({ timeout: 15000 }).catch(() => null);
  await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await nav; await p.waitForLoadState("load");
  ok((await summary(p)).includes("vA1"), `還沒下棋:切回前景就自動換成新版(${v0} → ${await summary(p)})`);
  // 情境 B:下到一半 ⇒ 不重新整理,出現更新鈕
  await p.waitForFunction(() => window.__banqi && window.__banqi.rendererMode !== "pending", null, { timeout: 15000 });
  await p.evaluate(() => { window.__banqi.state.turnCount = 3; window.__mark = "還在"; });
  bump("vB2");
  await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await p.waitForSelector("#swUpdateButton", { timeout: 15000 }).catch(() => {});
  const st = await p.evaluate(() => ({ mark: window.__mark, btn: document.getElementById("swUpdateButton")?.textContent, turn: window.__banqi.state.turnCount }));
  ok(st.mark === "還在" && st.turn === 3, "下到一半:沒有被強制重新整理,棋局還在");
  ok(st.btn === "🔄 有新版,按這裡更新", `下到一半:出現更新鈕(${st.btn})`);
  const nav2 = p.waitForNavigation({ timeout: 15000 }).catch(() => null);
  await p.click("#swUpdateButton"); await nav2; await p.waitForLoadState("load");
  ok((await summary(p)).includes("vB2"), `按更新鈕 ⇒ 換成新版(${await summary(p)})`);
  // 離線:新版裝好後斷網重開仍可用
  await ctx.setOffline(true);
  await p.reload({ waitUntil: "load" }).catch(() => {});
  ok((await summary(p).catch(() => "")).includes("vB2"), "斷網重開:還是開得起來(快取退路)");
  await b.close();
} finally { srv.kill(); }
console.log(`sw-update:${pass} 過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
