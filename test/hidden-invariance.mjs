// 🔬 暗子反例:交換兩枚「未翻開」棋子的底細(side/type/牌 id 對應),公開局面與未翻子池組成都不變 ⇒
//    AI 三檔與 💡 提示的選擇必須完全一樣(搜尋不可以偷看某一格底下是誰)。
// 反例:一支故意偷看的挑手函式,在同樣的交換下至少要有一局改變選擇 —— 證明「交換」真的有換到東西。
// 跑法:node test/hidden-invariance.mjs
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const Core = require("../banqi-core.js");
const golden = JSON.parse(readFileSync(new URL("./fixtures/search-golden.json", import.meta.url), "utf8"));
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const LEVELS = {
  casual: { depth: 1, thinkMs: 20000, randomness: 0.45, topChoices: 4 },
  standard: { depth: 2, thinkMs: 20000, randomness: 0.22, topChoices: 3 },
  master: { depth: 3, thinkMs: 20000, randomness: 0.08, topChoices: 2 },
  hint: null,
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** 交換兩格暗子的「底細」:board 上兩格互換牌 id,兩枚牌的 position 也互換 */
function swapHidden(s, i, j) {
  const t = Core.cloneState(s);
  const a = t.board[i], b = t.board[j];
  t.board[i] = b; t.board[j] = a;
  t.pieces[a].position = j; t.pieces[b].position = i;
  return t;
}
/** 故意偷看:翻「底下是自己最大那枚」的格子(反例用) */
function cheatPick(s) {
  const side = s.aiSide;
  let best = null, bestV = -1;
  for (let i = 0; i < 32; i++) {
    const p = Core.getPieceAt(i, s);
    if (p && !p.revealed) { const v = (p.side === side ? 1 : -1) * Core.PIECE_META[p.type].value; if (v > bestV) { bestV = v; best = i; } }
  }
  return best;
}
const choose = (s, name, seed) => {
  Core.setRandom(mulberry(seed));
  const probe = Core.cloneState(s);
  if (name === "hint") { probe.hintLevel = { ...Core.HINT_LEVEL, thinkMs: 20000 }; return Core.chooseHintAction(probe); }
  probe.hintLevel = LEVELS[name];
  return Core.chooseAiAction(probe);
};
let pass = 0, fail = 0, swaps = 0, cheatChanged = 0;
for (const c of golden.cases) {
  const hidden = [];
  for (let i = 0; i < 32; i++) { const p = Core.getPieceAt(i, c.state); if (p && !p.revealed) hidden.push(i); }
  // 找兩枚底細不同的暗子(同 side 同 type 互換等於沒換)
  let pair = null;
  for (let x = 0; x < hidden.length && !pair; x++) for (let y = x + 1; y < hidden.length && !pair; y++) {
    const p = Core.getPieceAt(hidden[x], c.state), q = Core.getPieceAt(hidden[y], c.state);
    if (p.side !== q.side || p.type !== q.type) pair = [hidden[x], hidden[y]];
  }
  if (!pair) continue;
  swaps++;
  const swapped = swapHidden(c.state, pair[0], pair[1]);
  for (const name of Object.keys(LEVELS)) {
    const seed = c.seed * 31 + name.length;
    const a = choose(c.state, name, seed), b = choose(swapped, name, seed);
    if (same(a, b)) pass++; else { fail++; console.error(`  🔴 seed ${c.seed} ${name}:交換 ${pair} 兩枚暗子後選擇變了 ${JSON.stringify(a)} → ${JSON.stringify(b)}`); }
  }
  if (cheatPick({ ...c.state }) !== cheatPick(swapped)) cheatChanged++;
}
Core.setRandom(null);
if (cheatChanged > 0) pass++; else { fail++; console.error("  🔴 反例:偷看型挑手在交換後一局都沒變 ⇒ 交換沒有換到東西,本測試無鑑別力"); }
console.log(`🔬 hidden-invariance:${swaps} 局交換 × 4 檔 —— ${pass} 過 / ${fail} 失敗(偷看型反例變了 ${cheatChanged} 局)`);
process.exit(fail ? 1 : 0);
