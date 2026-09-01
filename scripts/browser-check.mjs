// 🔬 每日同副牌真瀏覽器冒煙(playwright-core + 系統 Edge/Chrome)。
// 跑法:node scripts/browser-check.mjs   (先起本機伺服器,或 CHECK_URL=線上網址)
// 驗:每日鈕 → 棋盤=今天那副牌 → **重進一次擺法逐位元相同** → 一般開局會換牌 →
//     翻子能玩、狀態行有回合數 → 引擎層打到贏 → 戰績記一筆。
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
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.error("  ✗ " + msg + (note ? " → " + note : "")); }
};

const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(URL + "/?v=" + Date.now(), { waitUntil: "networkidle" });
await page.waitForTimeout(800);

ok(await page.locator("#dailyButton").count() === 1, "有「📅 每日同副牌」鈕");
ok((await page.locator("#verTag").textContent()).includes("3 副牌"), "verTag 講了每天 3 副牌");
ok(await page.evaluate(() => !!window.BanqiDaily), "daily.js 載進來了(window.BanqiDaily 在)");

await page.evaluate(() => localStorage.removeItem("cloud-banqi:daily:v1"));

// 第一次進每日模式
await page.click("#dailyButton");
await page.waitForTimeout(400);
const first = await page.evaluate(() => {
  const s = window.__banqi.state;
  return { key: s.dailyKey, deck: s.dailyDeck, board: s.board.slice(), types: s.pieces.map((p) => p.side + p.type).join(","),
    line: document.querySelector("#dailyLine")?.textContent || "", hidden: document.querySelector("#dailyLine")?.hidden };
});
ok(!!first.key && /^\d{4}-\d{2}-\d{2}$/.test(first.key), `開局=今天那副牌(${first.key})`, JSON.stringify(first.key));
ok(first.hidden === false && first.line.includes("第 1/3 副") && first.line.includes("已走 0 回合"), "常駐狀態行帶副數", first.line);

// ★★ 重進一次:同一天必須逐位元相同
await page.click("#dailyButton");
await page.waitForTimeout(400);
const second = await page.evaluate(() => window.__banqi.state.board.slice());
ok(JSON.stringify(first.board) === JSON.stringify(second), "★★ 重進每日模式=同一副牌(逐位元相同)",
  JSON.stringify(second.slice(0, 8)));

// 一般開局:要換一副牌(每日模式的 key 也要清掉)
await page.click("#newGameButton");
await page.waitForTimeout(400);
const normal = await page.evaluate(() => ({ key: window.__banqi.state.dailyKey, board: window.__banqi.state.board.slice(),
  hidden: document.querySelector("#dailyLine")?.hidden }));
ok(normal.key === null && normal.hidden === true, "一般開局=離開每日模式(狀態行收起來)");
ok(JSON.stringify(normal.board) !== JSON.stringify(first.board), "一般開局換了一副牌(隨機洗)");

// 回每日模式,翻一子驗互動與回合數
await page.click("#dailyButton");
await page.waitForTimeout(400);
const played = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const B = window.__banqi;
  B.handleCellClick(0);           // 翻開第一格(與真手指同一條輸入管線)
  await sleep(500);
  return { revealed: B.state.pieces.filter((p) => p.revealed).length, turns: B.state.turnCount,
    line: document.querySelector("#dailyLine")?.textContent || "", humanSide: B.state.humanSide };
});
ok(played.revealed >= 1 && played.turns >= 1, `翻子能玩(已翻 ${played.revealed} 子・${played.turns} 回合)`, JSON.stringify(played));
ok(played.line.includes("回合"), "狀態行跟著回合走", played.line);

/* 💡 提示鈕:真的用滑鼠按(不是 evaluate 裡呼叫 showHint)。
   evaluate-not-click-guard 存在的理由就是這個 —— 繞過真點擊的話,
   「鈕被別的東西蓋住、按不到」這種病照樣全綠。 */
ok(await page.locator("#hintButton").count() === 1, "有「💡 提示」鈕");
// 等到輪回玩家(上面翻完一子後 AI 會走一手)
await page.waitForFunction(() => {
  const B = window.__banqi;
  return !B.state.aiThinking && !B.state.winner
    && (B.state.humanSide === null || B.state.turnSide === B.state.humanSide);
}, null, { timeout: 8000 }).catch(() => {});
await page.click("#hintButton");
await page.waitForTimeout(600);
const hintA = await page.evaluate(() => {
  const B = window.__banqi;
  const h = B.state.hint;
  return {
    action: h ? { ...h.action } : null,
    turnCount: h ? h.turnCount : null,
    stateTurn: B.state.turnCount,
    msg: document.querySelector("#statusMessage").textContent,
    purple: document.querySelectorAll(".cell--hint").length,
    badge: document.querySelectorAll(".cell--hint .cell__hint").length,
  };
});
ok(Boolean(hintA.action), "按下去算得出一手", JSON.stringify(hintA));
ok(hintA.msg.includes("建議"), "狀態列講出建議", hintA.msg);
ok(hintA.purple >= 1 && hintA.badge === hintA.purple,
  "提示的格子標成紫框 + 每一格都壓了 💡(不只靠顏色)",
  `purple=${hintA.purple} badge=${hintA.badge}`);
// 翻子=標 1 格;走/吃=起點終點兩格
ok(hintA.action.type === "flip" ? hintA.purple === 1 : hintA.purple === 2,
  `標的格數對得上動作型別(${hintA.action.type} ⇒ ${hintA.purple} 格)`);
ok(await page.evaluate(() => {                      // 建議必須是**合法**動作
  const B = window.__banqi;
  const h = B.state.hint.action;
  const legal = B.getLegalActions(B.state, B.state.turnSide);
  return legal.some((a) => a.type === h.type
    && a.index === h.index && a.from === h.from && a.to === h.to);
}), "建議的那一手是合法動作");

await page.click("#hintButton");                    // 同一手再按一次 ⇒ 同一個建議
await page.waitForTimeout(400);
const hintB = await page.evaluate(() => JSON.stringify(window.__banqi.state.hint.action));
ok(hintB === JSON.stringify(hintA.action),
  "同一個局面按兩次 ⇒ 同一個建議(零隨機檔位,不跳針)",
  JSON.stringify(hintA.action) + " vs " + hintB);

// 局面一動,舊建議自己失效(比對 turnCount/side,不靠逐處清)
await page.evaluate(() => { window.__banqi.state.turnCount += 1; });
await page.waitForTimeout(50);
ok(await page.evaluate(() => {
  const B = window.__banqi;
  return B.state.hint.turnCount !== B.state.turnCount;
}), "★ 局面一變,上一個建議自己就對不上了(不靠逐處清)");
await page.evaluate(() => { window.__banqi.state.turnCount -= 1; });

// 引擎層直推到人贏(驗戰績鏈;真下完一盤太久)
const won = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const B = window.__banqi;
  const s = B.state;
  const human = s.humanSide || "red";
  const ai = human === "red" ? "black" : "red";
  // 把 AI 的子全吃掉(等同人贏),再走一步觸發勝負判定
  for (const p of s.pieces) if (p.side === ai) { p.captured = true; p.position = -1; }
  s.board = s.board.map((cell) => {
    if (cell === null) return null;
    return s.pieces[cell].captured ? null : cell;
  });
  s.turnSide = human;
  /* 走一步合法手觸發勝負判定。
     ⚠ 暗棋只能走**相鄰**格(8 欄 × 4 列)——第一版用「第一個空格」當目標,
       本機剛好相鄰才過、線上就紅了(典型的假紅:病在測試不在遊戲)。 */
  const COLS = 8;
  const adjacentEmpty = (index) => {
    const row = Math.floor(index / COLS);
    const col = index % COLS;
    const cands = [];
    if (row > 0) cands.push(index - COLS);
    if (row < 3) cands.push(index + COLS);
    if (col > 0) cands.push(index - 1);
    if (col < COLS - 1) cands.push(index + 1);
    return cands.find((i) => s.board[i] === null);
  };
  const mine = s.pieces.find((p) => p.side === human && p.revealed && !p.captured && adjacentEmpty(p.position) !== undefined);
  if (mine) {
    const target = adjacentEmpty(mine.position);
    B.handleCellClick(mine.position);
    await sleep(250);
    B.handleCellClick(target);
  }
  await sleep(900);
  if (!s.winner) return { winner: null, why: "沒找到有相鄰空格的己方明子", msg: document.querySelector("#statusMessage").textContent, store: localStorage.getItem("cloud-banqi:daily:v1") };
  return { winner: s.winner, msg: document.querySelector("#statusMessage").textContent,
    store: localStorage.getItem("cloud-banqi:daily:v1") };
});
ok(!!won.winner, "推到分出勝負", JSON.stringify(won).slice(0, 160));
const rec = JSON.parse(won.store || "{}")[first.key] || {};
ok((rec.decks || {})["1"]?.best > 0, "★ 贏了記戰績、而且是**記在第 1 副底下**(" + won.store + ")");
ok(won.msg.includes("破解第 1 副") && won.msg.includes("已破 1/3"), "結算訊息帶副數與進度", won.msg);

/* 📅 破完第 1 副 → 再按每日鈕要接**第 2 副**,而且牌面不同 */
await page.click("#dailyButton");
await page.waitForTimeout(500);
const deck2 = await page.evaluate(() => {
  const s = window.__banqi.state;
  return { deck: s.dailyDeck, board: s.board.slice(), line: document.querySelector("#dailyLine").textContent };
});
ok(deck2.deck === 2, "再按每日鈕=自動接第 2 副", JSON.stringify({ deck: deck2.deck }));
ok(JSON.stringify(deck2.board) !== JSON.stringify(first.board), "★ 第 2 副是另一副牌(擺法不同)");
ok(deck2.line.includes("第 2/3 副") && deck2.line.includes("已破 1 副"), "狀態行帶第 2/3 副與進度", deck2.line);
ok(errors.length === 0, "整場零 pageerror", errors.join(" | ").slice(0, 200));

await browser.close();
console.log(`\n🔬 browser-check:${pass} 過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
