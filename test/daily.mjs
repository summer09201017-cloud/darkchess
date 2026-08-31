/* 🔬 📅 每日同副牌(暗棋)驗算。
   跑法:node test/daily.mjs   (只驗 daily.js 的純邏輯,零 DOM)

   釘五件:
     ①換日線=台北 UTC+8(「全世界同一副牌」需要一條固定的線)
     ②★ 決定性:同一天洗出的牌**逐位元相同**、不同天不同(這是整個玩法的地基)
     ③洗牌正確性:是排列(32 格不重不漏)、而且**真的有洗**(不是原序)
     ④分布理智:400 天不會出現「同一副牌重複太多次」(種子壞了的典型症狀)
     ⑤戰績:贏了取當日最少回合、新紀錄判定、只留 60 天、node 無 localStorage 不炸

   ★ daily.js 是「全域 script」不是 module(app.js 是傳統 script)⇒ 用 new Function
     載入並取回 window.BanqiDaily,不動產品程式。 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "..", "daily.js"), "utf8");
// 假的 window + localStorage(node 沒有;localStorage 讓 ⑤ 段驗得動真實流程)
const store = new Map();
const win = {};
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
new Function("window", "localStorage", src)(win, localStorage);
const D = win.BanqiDaily;

let pass = 0, fail = 0;
const ok = (label, cond, note = "") => {
  if (cond) { pass++; console.log("  🟢 " + label); }
  else { fail++; console.log("  🔴 " + label + (note ? "  → " + String(note).slice(0, 200) : "")); }
};
const section = (s) => console.log("\n── " + s + " ──");

const BOARD_SIZE = 32;   // 暗棋 8×4
const deal = (key) => D.seededShuffle([...Array(BOARD_SIZE).keys()], D.dailyRandom(key));

/* ══ ① 換日線 ══ */
section("① 換日線=台北時間(UTC+8)");
{
  const t = Date.UTC(2026, 7, 31, 15, 59);
  ok("UTC 15:59 仍是台北 8/31", D.dailyKey(t) === "2026-08-31", D.dailyKey(t));
  ok("UTC 16:00 換成台北 9/01", D.dailyKey(t + 60000) === "2026-09-01");
}

/* ══ ② 決定性 ══ */
section("② ★ 決定性:同一天同一副牌(整個玩法的地基)");
{
  const a = deal("2026-08-31");
  const b = deal("2026-08-31");
  ok("同一天兩次發牌逐位元相同", JSON.stringify(a) === JSON.stringify(b), JSON.stringify(a.slice(0, 8)));
  const c = deal("2026-09-01");
  ok("隔天是不同的一副牌", JSON.stringify(a) !== JSON.stringify(c));
  // 同一個 rng 連續呼叫要往前走(不是每次都回同一個數)
  const rng = D.dailyRandom("2026-08-31");
  const seq = [rng(), rng(), rng()];
  ok("亂數序列會前進(不是常數)", new Set(seq).size === 3, JSON.stringify(seq));
  ok("亂數落在 [0,1)", seq.every((v) => v >= 0 && v < 1));
}

/* ══ ③ 洗牌正確性 ══ */
section("③ 洗牌正確性:是排列、而且真的有洗");
{
  const d = deal("2026-08-31");
  ok("長度 32", d.length === BOARD_SIZE);
  ok("是排列(0~31 不重不漏)", new Set(d).size === BOARD_SIZE && Math.min(...d) === 0 && Math.max(...d) === 31);
  const identity = [...Array(BOARD_SIZE).keys()];
  ok("★ 真的有洗(不是原序)", JSON.stringify(d) !== JSON.stringify(identity));
  let moved = 0;
  for (let i = 0; i < BOARD_SIZE; i++) if (d[i] !== i) moved++;
  ok("多數格子都換過位置(移動 " + moved + "/32)", moved >= 24, String(moved));
}

/* ══ ④ 分布理智 ══ */
section("④ 400 天的牌不重複(種子壞掉的典型症狀)");
{
  const seen = new Map();
  for (let i = 0; i < 400; i++) {
    const key = D.dailyKey(Date.UTC(2026, 7, 31) + i * 86400000);
    const sig = deal(key).join(",");
    seen.set(sig, (seen.get(sig) || 0) + 1);
  }
  const dupes = [...seen.values()].filter((n) => n > 1).length;
  ok("★ 400 天 400 副不同的牌(0 個重複)", seen.size === 400, `不同=${seen.size} 重複組=${dupes}`);
  // 第一格的分布:不該總是同一顆(種子沒進洗牌的症狀)
  const firsts = new Set();
  for (let i = 0; i < 40; i++) firsts.add(deal(D.dailyKey(Date.UTC(2026, 7, 31) + i * 86400000))[0]);
  ok("第一格 40 天內至少換過 10 種", firsts.size >= 10, String(firsts.size));
}

/* ══ ⑤ 戰績 ══ */
section("⑤ 戰績:當日最少回合、新紀錄、留 60 天");
{
  store.clear();
  const r1 = D.applyDailyWin("2026-08-31", 30);
  ok("第一次贏=新紀錄 30", r1.isNewBest === true && r1.best === 30 && r1.played === 1, JSON.stringify(r1));
  const r2 = D.applyDailyWin("2026-08-31", 42);
  ok("較差的成績不蓋掉紀錄(仍是 30),但玩過次數 +1", r2.best === 30 && r2.isNewBest === false && r2.played === 2, JSON.stringify(r2));
  const r3 = D.applyDailyWin("2026-08-31", 21);
  ok("更好的成績刷新紀錄(21)", r3.best === 21 && r3.isNewBest === true, JSON.stringify(r3));
  // 65 天 → 只留 60
  store.clear();
  for (let i = 0; i < 65; i++) D.applyDailyWin(D.dailyKey(Date.UTC(2026, 0, 1) + i * 86400000), 25);
  const book = D.loadDailyBook();
  ok("只留最近 60 天", Object.keys(book).length === 60, String(Object.keys(book).length));
  ok("留下的是**較新**的那些(最舊那天已被清掉)", !book["2026-01-01"] && !!book[D.dailyKey(Date.UTC(2026, 0, 1) + 64 * 86400000)]);
  // 壞掉的 localStorage 不能炸(私密模式)
  const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  const win2 = {};
  new Function("window", "localStorage", src)(win2, bad);
  let threw = false;
  try { win2.BanqiDaily.applyDailyWin("2026-08-31", 10); } catch { threw = true; }
  ok("localStorage 全被擋時不炸(私密模式照玩)", !threw);
}

console.log(`\n🔬 daily:${pass} 過 / ${fail} 失敗`);
process.exitCode = fail ? 1 : 0;
