// 🔬 💡 提示品質真瀏覽器驗收(2026-09-07):提示不可以叫人做「虧本或等價的交換」
// 跑法:node test/hint.mjs   (先起本機伺服器,或 CHECK_URL=線上網址)
//
// 背景:使用者在 3D 幻影西洋棋退件「提示叫我吃、吃完又被別的子吃回,等於交換被吃」,
// 全棋類體檢後確認本站也有同型病因:
//   ① 同分偏好吃子 —— scored.sort 是穩定排序,平手時照 orderActionsForSearch 的順序,
//      而那支把吃子(value × 1.2)排最前面;
//   ② 葉子沒有靜態搜尋 ⇒ 水平線效應:「我吃→他回吃→我再吃」看起來賺,第 4 步被吃回看不到。
// 修法:quiesceCaptures + captureGain + HINT_TRADE_MARGIN(見 app.js)。
//
// ★ app.js 是瀏覽器端的普通 script(頂層就抓 DOM),Node 匯入不了 ⇒ 測試在真瀏覽器裡跑,
//   透過 window.__banqi 的把手驅動;裁判(refNet)在頁面裡自己走一遍吃子鏈,
//   只用 getLegalActions / cloneState / applySearchAction / PIECE_META,
//   完全不碰被測的 captureGain / evaluateState / 門檻,才算得上獨立。
import { chromium } from "playwright-core";

const URL = process.env.CHECK_URL || "http://localhost:8797";
let browser = null;
for (const channel of ["msedge", "chrome"]) {
  try { browser = await chromium.launch({ channel, headless: true }); break; }
  catch { /* 換下一個 */ }
}
if (!browser) { console.error("找不到系統 Edge/Chrome"); process.exit(1); }

let pass = 0, fail = 0;
const ok = (cond, msg, note = "") => {
  if (cond) { pass++; console.log("  🟢 " + msg); }
  else { fail++; console.error("  🔴 " + msg + (note ? " → " + note : "")); }
};

const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(URL + "/?v=" + Date.now(), { waitUntil: "domcontentloaded" });
try {
  await page.waitForFunction(() => !!window.__banqi, null, { timeout: 20000 });
} catch {
  // app.js 在載入時就掛了(例:把手裡直接引用後面才宣告的 const ⇒ TDZ)——把真正的錯印出來,
  // 不然只會看到一句無用的 "waitForFunction timeout"
  console.error("🔴 window.__banqi 沒出現,app.js 載入時就出錯了:");
  console.error(errors.length ? errors.join("\n") : "(沒抓到 pageerror,檢查 script 有沒有 404)");
  await browser.close();
  process.exit(1);
}
await page.waitForTimeout(400);

const report = await page.evaluate(() => {
  const B = window.__banqi;
  const { cloneState, applySearchAction, applyActualAction, getLegalActions,
          getPieceAt, PIECE_META, chooseHintAction, HINT_LEVEL, HINT_TRADE_MARGIN } = B;

  // ── 獨立裁判:只看已翻開的子力、只走吃子,算到沒人想再吃 ──
  const material = (st, side) => {
    let total = 0;
    for (const p of st.pieces) {
      if (p.captured || !p.revealed) continue;
      total += (p.side === side ? 1 : -1) * PIECE_META[p.type].value;
    }
    return total;
  };
  const refQuiesce = (st, side, alpha, beta, depth) => {
    const stand = material(st, side);
    if (depth <= 0) return stand;
    const mover = st.turnSide;
    const maxi = mover === side;
    let best = stand;
    if (maxi) { if (best >= beta) return best; if (best > alpha) alpha = best; }
    else { if (best <= alpha) return best; if (best < beta) beta = best; }
    const caps = getLegalActions(st, mover).filter((a) => a.type === "capture");
    for (const a of caps) {
      const next = cloneState(st);
      applySearchAction(next, a);
      const v = refQuiesce(next, side, alpha, beta, depth - 1);
      if (maxi) { if (v > best) best = v; if (best > alpha) alpha = best; }
      else { if (v < best) best = v; if (best < beta) beta = best; }
      if (beta <= alpha) break;
    }
    return best;
  };
  const refNet = (st, action, side) => {
    if (action.type === "flip") return 0;              // 翻牌是隨機的,裁判不評
    const before = material(st, side);
    const next = cloneState(st);
    applySearchAction(next, action);
    return refQuiesce(next, side, -Infinity, Infinity, 8) - before;
  };

  // ── 隨機中局 ──
  /* ★ 連「發牌」都要固定:createInitialState 內部用 shuffle() ⇒ 吃的是 Math.random,
     不接管的話每次跑的是不同的牌,同一支測試會時綠時紅(第一版就這樣,一個紅燈跑兩次才出現一次)。
     整段驗收期間把 Math.random 換成自己的 LCG,結束再還原。 */
  let seed = 20260907;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const realRandom = Math.random;
  Math.random = rnd;

  const out = {
    checked: 0, illegal: 0, captures: 0, badTrade: [], worseThanBest: [],
    tMax: 0, tSum: 0, margin: HINT_TRADE_MARGIN, deterministic: true,
  };

  for (let game = 0; game < 40; game += 1) {
    const st = B.createInitialState();
    st.mode = "ai";
    const steps = 6 + Math.floor(rnd() * 18);
    for (let i = 0; i < steps; i += 1) {
      const side = st.turnSide;
      const acts = side === null
        ? getLegalActions(st, "red").filter((a) => a.type === "flip")
        : getLegalActions(st, side);
      if (!acts.length) break;
      applyActualAction(st, acts[Math.floor(rnd() * acts.length)]);
    }
    const side = st.turnSide;
    if (!side) continue;
    const legal = getLegalActions(st, side);
    if (!legal.length) continue;

    const probe = cloneState(st);
    probe.aiSide = side;
    probe.hintLevel = HINT_LEVEL;
    const t0 = performance.now();
    const hint = chooseHintAction(probe);
    const dt = performance.now() - t0;
    out.tSum += dt; out.tMax = Math.max(out.tMax, dt);
    if (!hint) continue;
    out.checked += 1;

    // 提示那一手必須真的走得動
    const same = (a, b) => a.type === b.type
      && (a.type === "flip" ? a.index === b.index : (a.from === b.from && a.to === b.to));
    if (!legal.some((a) => same(a, hint))) { out.illegal += 1; continue; }

    // 同局面按兩次要同一手(零隨機)
    const probe2 = cloneState(st);
    probe2.aiSide = side;
    probe2.hintLevel = HINT_LEVEL;
    if (!same(chooseHintAction(probe2), hint)) out.deterministic = false;

    const net = refNet(st, hint, side);

    /* 判準只釘我們真正承諾的事,別釘過頭(第一版兩條都假紅了):
       ① 建議吃子 ⇒ 交換算到底必須「有賺」。這就是使用者退件的那件事。
          ✗ 不可以要求它是「賺最多的那個吃子」——+200 與 +330 之間選哪個是位置判斷,不是 bug。
       ② 建議「移動」⇒ 不可以白送子力:自己虧,而場上還有不虧的移動/吃子可走。
       ③ 翻牌一律不評 —— 翻到什麼是隨機的,裁判(只會算吃子鏈)沒有立場說它好或壞;
          第一版把翻牌當成「淨 0」,結果它常常變成「場上最好的一手」,把真正的比較弄歪了。 */
    if (hint.type === "capture") {
      out.captures += 1;
      if (net <= 0) out.badTrade.push(`${hint.from}→${hint.to} 淨 ${net}`);
    } else if (hint.type === "move" && net < 0) {
      const realMoves = legal.filter((a) => a.type !== "flip");
      const bestReal = Math.max(...realMoves.map((a) => refNet(st, a, side)));
      if (bestReal >= 0) {
        out.worseThanBest.push(`move ${hint.from}→${hint.to} 白送 ${net},場上有不虧的手(${bestReal})`);
      }
    }
  }
  Math.random = realRandom;
  return out;
});

console.log("── 💡 提示品質(隨機中局)──");
console.log(`  檢查了 ${report.checked} 個局面,其中 ${report.captures} 手建議吃子`);
ok(report.illegal === 0, "提示的每一手都真的走得動", `${report.illegal} 手不合法`);
ok(report.badTrade.length === 0, "建議吃子的手,交換算到底都有賺(沒有等價/虧本交換)",
  report.badTrade.slice(0, 3).join(" | "));
ok(report.worseThanBest.length === 0, "建議「移動」時沒有白送子力(場上還有不虧的手可走)",
  report.worseThanBest.slice(0, 3).join(" | "));
ok(report.deterministic, "同局面按兩次給同一手(零隨機)");
ok(report.margin === 60, "交換門檻是半個兵(60)", String(report.margin));
console.log(`  ⏱ 提示耗時:平均 ${Math.round(report.tSum / Math.max(report.checked, 1))}ms,最慢 ${Math.round(report.tMax)}ms`);
ok(report.tMax < 3000, "最慢的一手 < 3000ms(同步搜尋,超過就會卡畫面)", `${Math.round(report.tMax)}ms`);
ok(errors.length === 0, "整場零 pageerror", errors.join(" | "));

await browser.close();
console.log(`\n🔬 hint:${pass} 過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
