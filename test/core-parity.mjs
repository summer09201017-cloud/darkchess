// 🔬 搬家不改棋力:banqi-core.js(抽離後)對 test/fixtures/search-golden.json(抽離前 app.js 784d49e 錄的 40 局)逐局比對
// AI 三檔 + 💡 提示選的那一手。亂數與時間預算跟錄製時一模一樣(mulberry32 同種子、thinkMs 20000)。
// 跑法:node test/core-parity.mjs(純 node,不用瀏覽器)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const Core = require("../banqi-core.js");
const golden = JSON.parse(readFileSync(new URL("./fixtures/search-golden.json", import.meta.url), "utf8"));

const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const LEVELS = {
  casual: { label: "休閒", depth: 1, thinkMs: 20000, randomness: 0.45, topChoices: 4 },
  standard: { label: "標準", depth: 2, thinkMs: 20000, randomness: 0.22, topChoices: 3 },
  master: { label: "高手", depth: 3, thinkMs: 20000, randomness: 0.08, topChoices: 2 },
};
let pass = 0, fail = 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
for (const c of golden.cases) {
  for (const [name, level] of Object.entries(LEVELS)) {
    Core.setRandom(mulberry(c.seed * 104729 + name.length));
    const probe = Core.cloneState(c.state);
    probe.hintLevel = level;
    const got = Core.chooseAiAction(probe);
    if (same(got, c.ai[name])) pass++; else { fail++; console.error(`  🔴 seed ${c.seed} ${name}: 錄 ${JSON.stringify(c.ai[name])} ≠ 現 ${JSON.stringify(got)}`); }
  }
  Core.setRandom(mulberry(c.seed));
  const hp = Core.cloneState(c.state);
  hp.hintLevel = { ...Core.HINT_LEVEL, thinkMs: 20000 };
  const h = Core.chooseHintAction(hp);
  if (same(h, c.hint)) pass++; else { fail++; console.error(`  🔴 seed ${c.seed} 提示: 錄 ${JSON.stringify(c.hint)} ≠ 現 ${JSON.stringify(h)}`); }
}
Core.setRandom(null);
// 反例:故意把高手檔的深度改掉,至少一局要對不上(證明這支測試不是恆真的空測試)
let diverged = 0;
for (const c of golden.cases) {
  Core.setRandom(mulberry(c.seed * 104729 + "master".length));
  const probe = Core.cloneState(c.state);
  probe.hintLevel = { ...LEVELS.master, depth: 1, randomness: 0.9, topChoices: 4 };
  if (!same(Core.chooseAiAction(probe), c.ai.master)) diverged++;
}
Core.setRandom(null);
if (diverged > 0) pass++; else { fail++; console.error("  🔴 反例:改了深度 / 隨機性卻 40 局全部一樣 ⇒ 這支比對沒有鑑別力"); }
console.log(`🔬 core-parity:${golden.cases.length} 局 × (AI 三檔 + 提示) —— ${pass} 過 / ${fail} 失敗(反例分歧 ${diverged} 局)`);
process.exit(fail ? 1 : 0);
