// 產「搜尋黃金檔」test/fixtures/search-golden.json —— 規則 / 搜尋抽到 js/banqi-core.js 之前,用**舊的** app.js 錄下
// 固定局面上 AI 三檔與 💡 提示各選哪一手;之後 test/core-parity.mjs 拿抽離後的 core 逐局比對,守住「搬家不改棋力」。
// ★ 2026-09-29 在 commit 784d49e(抽離前)跑過一次、結果已進版控;之後**不要**再用新版 app.js 重錄(那就變成自己跟自己比)。
// 跑法:py -m http.server 8797 → node scripts/gen-search-golden.mjs
import { chromium } from "playwright-core";
import { writeFileSync, mkdirSync } from "node:fs";

const URL = process.env.CHECK_URL || "http://localhost:8797";
let browser = null;
for (const channel of ["msedge", "chrome"]) {
  try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* 換下一個 */ }
}
if (!browser) { console.error("找不到系統 Edge/Chrome"); process.exit(1); }
const page = await browser.newPage();
await page.goto(`${URL}/?v=${Date.now()}`, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__banqi && window.__banqi.chooseHintAction);

const cases = await page.evaluate(() => {
  const B = window.__banqi;
  const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const realRandom = Math.random;
  const pure = (s) => ({ board: [...s.board], pieces: s.pieces.map((p) => ({ ...p })), turnSide: s.turnSide, humanSide: s.humanSide, aiSide: s.aiSide, mode: s.mode, difficulty: s.difficulty, turnCount: s.turnCount });
  const LEVELS = {
    casual: { label: "休閒", depth: 1, thinkMs: 20000, randomness: 0.45, topChoices: 4 },
    standard: { label: "標準", depth: 2, thinkMs: 20000, randomness: 0.22, topChoices: 3 },
    master: { label: "高手", depth: 3, thinkMs: 20000, randomness: 0.08, topChoices: 2 },
  };
  const out = [];
  for (let seed = 1; seed <= 40; seed += 1) {
    Math.random = mulberry(seed * 7919);
    let s = B.createInitialState({ mode: "ai", difficulty: "standard" });
    const steps = 4 + (seed * 3) % 38;
    let ok = true;
    for (let i = 0; i < steps; i += 1) {
      const side = s.turnSide || "red";
      const acts = B.getLegalActions(s, side);
      if (!acts.length) { ok = false; break; }
      const caps = acts.filter((a) => a.type === "capture");
      const pick = caps.length && Math.random() < 0.6 ? caps[Math.floor(Math.random() * caps.length)] : acts[Math.floor(Math.random() * acts.length)];
      B.applyActualAction(s, pick);
      s.turnCount += 1;
      const live = (sd) => s.pieces.some((p) => !p.captured && p.side === sd);
      if (!live("red") || !live("black")) { ok = false; break; }
    }
    if (!ok || !s.turnSide) continue;
    const base = pure(s);
    base.aiSide = s.turnSide;
    base.humanSide = s.turnSide === "red" ? "black" : "red";
    const rec = { seed, state: base, ai: {}, hint: null };
    for (const [name, level] of Object.entries(LEVELS)) {
      Math.random = mulberry(seed * 104729 + name.length);
      const probe = B.cloneState(base);
      probe.hintLevel = level;
      rec.ai[name] = B.chooseAiAction(probe);
    }
    Math.random = mulberry(seed);
    const hp = B.cloneState(base);
    hp.hintLevel = { ...B.HINT_LEVEL, thinkMs: 20000 };
    rec.hint = B.chooseHintAction(hp);
    out.push(rec);
  }
  Math.random = realRandom;
  return out;
});

mkdirSync("test/fixtures", { recursive: true });
writeFileSync("test/fixtures/search-golden.json", JSON.stringify({ generatedAt: new Date().toISOString(), note: "錄自抽離前 app.js(784d49e);AI 用 mulberry32(seed*104729+檔名長度)、提示用 mulberry32(seed),thinkMs 20000", cases }, null, 0) + "\n");
console.log(`錄了 ${cases.length} 局`);
await browser.close();
