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
ok((await page.locator("#verTag").textContent()).includes("每日同副牌"), "verTag 帶版本簡歷");
ok(await page.evaluate(() => !!window.BanqiDaily), "daily.js 載進來了(window.BanqiDaily 在)");

await page.evaluate(() => localStorage.removeItem("cloud-banqi:daily:v1"));

// 第一次進每日模式
await page.click("#dailyButton");
await page.waitForTimeout(400);
const first = await page.evaluate(() => {
  const s = window.__banqi.state;
  return { key: s.dailyKey, board: s.board.slice(), types: s.pieces.map((p) => p.side + p.type).join(","),
    line: document.querySelector("#dailyLine")?.textContent || "", hidden: document.querySelector("#dailyLine")?.hidden };
});
ok(!!first.key && /^\d{4}-\d{2}-\d{2}$/.test(first.key), `開局=今天那副牌(${first.key})`, JSON.stringify(first.key));
ok(first.hidden === false && first.line.includes("已走 0 回合"), "常駐狀態行在", first.line);

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
  B.startNewGame === undefined;   // no-op,保持 state 參照
  // 走任一合法手觸發 finalizeAfterAction
  const mine = s.pieces.find((p) => p.side === human && p.revealed && !p.captured);
  if (mine) {
    const target = s.board.findIndex((c) => c === null);
    if (target >= 0) { B.handleCellClick(mine.position); await sleep(200); B.handleCellClick(target); }
  }
  await sleep(900);
  return { winner: s.winner, msg: document.querySelector("#statusMessage").textContent,
    store: localStorage.getItem("cloud-banqi:daily:v1") };
});
ok(!!won.winner, "推到分出勝負", JSON.stringify(won).slice(0, 160));
ok(!!won.store && JSON.parse(won.store)[first.key]?.best > 0, "★ 贏了記戰績(" + won.store + ")");
ok(won.msg.includes("破解") || won.msg.includes("紀錄") || won.msg.includes("回合"), "結算訊息講了破解/紀錄", won.msg);
ok(errors.length === 0, "整場零 pageerror", errors.join(" | ").slice(0, 200));

await browser.close();
console.log(`\n🔬 browser-check:${pass} 過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
