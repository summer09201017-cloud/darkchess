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
  return !B.state.aiThinking && !B.state.winner && !B.animBusy
    && (B.state.humanSide === null || B.state.turnSide === B.state.humanSide);
}, null, { timeout: 15000 }).catch(() => {});
await page.click("#hintButton");
/* v12:提示搜尋搬進 Worker ⇒ 非同步;等「算完」(有建議、鈕解除忙碌),不是等固定毫秒(無頭機慢時固定等待是假紅溫床) */
await page.waitForFunction(() => { const B = window.__banqi; return B.state.hint && !B.state.hintBusy; }, null, { timeout: 15000 }).catch(() => {});
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

/* ══════ 📅 勝局 → 戰績 → 接第 2 副(T01~T06)══════
   0928 修六紅:舊版在「提示段玩到一半的當天真實牌局」上把 AI 子清光,再找「有相鄰空格的己方明子」
   ——當天洗牌若己方明子四周都是暗子(0928 第 1 副:0 格黑卒、鄰格 1/4 都是暗子),根本沒走那一手,
   六條連環假紅,而診斷一律說「沒找到明子」。病在測試前置,不在遊戲。
   ⇒ 改成:每個案例一個全新 context + 固定日期(page.clock.setFixedTime:只釘 Date,計時器照跑)
     + 固定合法雙子殘局(紅俥在 0、黑卒在 1、已走 8 回合),走正式 handleCellClick 0 → 1,
     讓 performAction → finalizeAfterAction → scoreDailyIfWon 自己產出勝負與戰績。
   ⚠ 這是引擎/UI 狀態整合測試,沒有驗棋盤滑鼠命中(那段由動物段與提示鈕的真點擊負責)。
   ⚠ 棋盤是 4 欄 × 8 列(app.js BOARD_COLS=4,index = row*4+col)。 */
const COLS = 4, ROWS = 8, CELLS = COLS * ROWS;
/** 獨立幾何裁判(不抄產品的 step):同列左右相鄰或同欄上下相鄰 */
const adjacent = (a, b) => {
  const ra = Math.floor(a / COLS), ca = a % COLS, rb = Math.floor(b / COLS), cb = b % COLS;
  return (ra === rb && Math.abs(ca - cb) === 1) || (ca === cb && Math.abs(ra - rb) === 1);
};

/** fixture 一致性檢查:回錯誤字串陣列(空=合法) */
function validateFixture(snap) {
  const errs = [];
  if (!Array.isArray(snap.board) || snap.board.length !== CELLS) errs.push(`board 長度 ${snap.board && snap.board.length} ≠ ${CELLS}`);
  if (!Array.isArray(snap.pieces) || snap.pieces.length !== CELLS) errs.push(`pieces 筆數 ${snap.pieces && snap.pieces.length} ≠ ${CELLS}`);
  if (errs.length) return errs;
  const seen = new Set();
  snap.board.forEach((id, cell) => {
    if (id === null) return;
    if (seen.has(id)) errs.push(`棋子 ${id} 在棋盤上出現兩次`);
    seen.add(id);
    const p = snap.pieces[id];
    if (!p) { errs.push(`格 ${cell} 指向不存在的棋子 ${id}`); return; }
    if (p.captured) errs.push(`格 ${cell} 上的棋子 ${id} 標成已被吃`);
    if (p.position !== cell) errs.push(`格 ${cell} 指向棋子 ${id},但它的 position=${p.position}`);
  });
  snap.pieces.forEach((p, i) => {
    if (p.id !== i) errs.push(`pieces[${i}].id=${p.id}(id 與索引不一致)`);
    if (p.captured && p.position !== -1) errs.push(`已被吃的棋子 ${i} position=${p.position}(應為 -1)`);
    if (!p.captured && snap.board[p.position] !== i) errs.push(`活棋 ${i} position=${p.position},但 board[${p.position}]=${snap.board[p.position]}`);
  });
  return errs;
}

// 自我檢查:幾何裁判與 fixture 檢查器本身要會抓錯(否則正例綠燈沒有意義)
ok(adjacent(0, 1) && !adjacent(3, 4) && adjacent(4, 8) && !adjacent(0, 5),
  "勝局前置:獨立幾何裁判(4 欄盤:3→4 不相鄰、4→8 上下相鄰、0→5 斜角不算)");

const DATE_CASES = ["2026-09-27", "2026-09-28", "2026-09-29"];

/** 開一個全新 context,固定日期,開今天第 1 副,存下原始牌面,再注入雙子殘局。
    opts.mutateStore:把 BanqiDaily.applyDailyWin 換成不持久化的假實作(變異測試用) */
async function openFixture(dateStr, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 820 }, serviceWorkers: "block" });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e)));
  await pg.clock.setFixedTime(new Date(dateStr + "T12:00:00+08:00"));   // 只釘 Date;setTimeout/rAF 照跑
  await pg.goto(URL + "/?v=" + Date.now(), { waitUntil: "networkidle" });
  await pg.waitForFunction(() => !!(window.__banqi && window.BanqiDaily), null, { timeout: 10000 });
  await pg.evaluate(() => localStorage.removeItem("cloud-banqi:daily:v1"));
  if (opts.mutateStore) {
    await pg.evaluate(() => {
      window.BanqiDaily.applyDailyWin = (key, deckNo, turns) => ({ best: turns, isNewBest: true, played: 1, brokenCount: 1 });
    });
  }
  await pg.click("#dailyButton");                    // 真點每日鈕開今天第 1 副
  await pg.waitForFunction(() => window.__banqi.state.dailyDeck === 1, null, { timeout: 5000 });
  const setup = await pg.evaluate(() => {
    const B = window.__banqi, s = B.state;
    const originalDeck1 = s.board.slice();           // ★ 注入殘局「之前」先複製原始第 1 副
    const dailyKey = s.dailyKey;
    const rook = s.pieces.find((p) => p.side === "red" && p.type === "rook");
    const pawn = s.pieces.find((p) => p.side === "black" && p.type === "pawn");
    for (const p of s.pieces) { p.captured = true; p.position = -1; p.revealed = true; }
    s.board = Array(s.board.length).fill(null);
    for (const [p, cell] of [[rook, 0], [pawn, 1]]) { p.captured = false; p.revealed = true; p.position = cell; s.board[cell] = p.id; }
    Object.assign(s, {
      mode: "ai", humanSide: "red", aiSide: "black", turnSide: "red", turnCount: 8, dailyDeck: 1,
      winner: null, winnerReason: "", dailyScored: false, aiThinking: false,
      selectedIndex: null, legalTargets: [], hint: null, lastAction: null,
    });
    return {
      originalDeck1, dailyKey, rookId: rook.id, pawnId: pawn.id,
      snap: { board: s.board.slice(), pieces: s.pieces.map((p) => ({ ...p })) },
      legal: B.getLegalActions(s, "red"),
      blackLive: s.pieces.filter((p) => p.side === "black" && !p.captured).length,
      winner: s.winner, store: localStorage.getItem("cloud-banqi:daily:v1"),
    };
  });
  return { ctx, pg, errs, setup };
}

/** 讀勝局後的觀測值(失敗時整包印出來,依觀測判斷是哪一步斷) */
const observe = (pg) => pg.evaluate(() => {
  const s = window.__banqi.state;
  return {
    humanSide: s.humanSide, turnSide: s.turnSide, aiThinking: s.aiThinking, lastAction: s.lastAction,
    turnCount: s.turnCount, winner: s.winner, winnerReason: s.winnerReason,
    dailyKey: s.dailyKey, dailyDeck: s.dailyDeck, dailyScored: s.dailyScored,
    msg: document.querySelector("#statusMessage").textContent,
    turn: document.querySelector("#statusTurn").textContent,
    store: localStorage.getItem("cloud-banqi:daily:v1"),
  };
});

const playLastMove = async (pg) => {
  await pg.evaluate(() => { const B = window.__banqi; B.handleCellClick(0); B.handleCellClick(1); });
  await pg.waitForFunction(() => window.__banqi.state.winner !== null, null, { timeout: 3000 }).catch(() => {});
};

/** fixture 前置檢查(每個案例都跑);回 true=可以往下 */
function checkFixture(tag, setup) {
  const errs = validateFixture(setup.snap);
  const hasCap = setup.legal.some((a) => a.type === "capture" && a.from === 0 && a.to === 1);
  const good = errs.length === 0 && adjacent(0, 1) && hasCap && setup.blackLive === 1
    && setup.winner === null && setup.store === null;
  ok(good, `${tag} 前置局面合法(紅俥 0 → 黑卒 1 可吃、黑方剩 1 子、尚無勝者與戰績)`,
    "測試前置局面不合法:" + JSON.stringify({ errs, hasCap, blackLive: setup.blackLive, winner: setup.winner, store: setup.store, legal: setup.legal }).slice(0, 300));
  return good;
}

for (const day of DATE_CASES) {
  const tag = `[${day}]`;
  const { ctx, pg, errs, setup } = await openFixture(day);
  ok(setup.dailyKey === day, `${tag} 固定日期生效(dailyKey=${setup.dailyKey})`);
  const fixtureOk = checkFixture(tag, setup);
  const dep = fixtureOk ? "" : "(前置局面不合法,本條連帶失敗)";

  await playLastMove(pg);
  const w = await observe(pg);
  const diag = JSON.stringify(w).slice(0, 400);
  // T01
  ok(fixtureOk && w.winner === "red" && w.humanSide === "red" && w.winnerReason === "capture" && w.turnCount === 9,
    `${tag} T01 推到分出勝負(紅勝・capture・9 回合)${dep}`, diag);
  // T02
  const book = JSON.parse(w.store || "{}");
  const rec = (book[day] && book[day].decks) || {};
  ok(fixtureOk && Object.keys(book).join() === day && Object.keys(rec).join() === "1"
    && rec["1"].best === 9 && rec["1"].played === 1,
    `${tag} T02 ★ 贏了記戰績、而且是**記在第 1 副底下**(best=9・played=1・第 2/3 副無紀錄)${dep}`, String(w.store));
  // T03
  ok(fixtureOk && w.msg.includes("破解第 1 副") && w.msg.includes("用了 9 回合") && w.msg.includes("已破 1/3") && w.turn === "你獲勝",
    `${tag} T03 結算訊息帶副數與進度${dep}`, `${w.turn} | ${w.msg}`);

  // 重複輸入同兩格:winner 守門擋住,不重記
  await pg.evaluate(() => { const B = window.__banqi; B.handleCellClick(0); B.handleCellClick(1); });
  await pg.waitForTimeout(300);
  const again = await observe(pg);
  const againRec = ((JSON.parse(again.store || "{}")[day] || {}).decks || {})["1"] || {};
  ok(fixtureOk && again.turnCount === 9 && againRec.played === 1, `${tag} 結局後重點同兩格 ⇒ 回合與 played 不變`,
    JSON.stringify({ turnCount: again.turnCount, played: againRec.played }));

  // T04~T06:真點每日鈕接第 2 副
  await pg.click("#dailyButton");
  await pg.waitForFunction(() => window.__banqi.state.dailyDeck === 2, null, { timeout: 3000 }).catch(() => {});
  const d2 = await pg.evaluate(() => {
    const s = window.__banqi.state, el = document.querySelector("#dailyLine");
    return { key: s.dailyKey, deck: s.dailyDeck, turns: s.turnCount, board: s.board.slice(), line: el.textContent, hidden: el.hidden };
  });
  ok(fixtureOk && d2.key === day && d2.deck === 2 && d2.turns === 0, `${tag} T04 再按每日鈕=自動接第 2 副${dep}`,
    JSON.stringify({ key: d2.key, deck: d2.deck, turns: d2.turns }));
  const perm = d2.board.length === CELLS && new Set(d2.board).size === CELLS && d2.board.every((id) => Number.isInteger(id) && id >= 0 && id < CELLS);
  await pg.click("#dailyButton");                    // 第 2 副還沒破 ⇒ 重進要逐格相同
  await pg.waitForTimeout(300);
  const d2again = await pg.evaluate(() => window.__banqi.state.board.slice());
  ok(fixtureOk && perm && JSON.stringify(d2.board) !== JSON.stringify(setup.originalDeck1) && JSON.stringify(d2again) === JSON.stringify(d2.board),
    `${tag} T05 ★ 第 2 副是另一副牌(完整 32 子排列、≠ 原始第 1 副、重進逐格相同)${dep}`,
    JSON.stringify({ perm, d2: d2.board.slice(0, 8), deck1: setup.originalDeck1.slice(0, 8) }));
  ok(fixtureOk && d2.hidden === false && d2.line.includes("第 2/3 副") && d2.line.includes("已破 1 副") && d2.line.includes("已走 0 回合"),
    `${tag} T06 狀態行帶第 2/3 副與進度${dep}`, d2.line);
  ok(errs.length === 0, `${tag} 勝局鏈零 pageerror`, errs.join(" | ").slice(0, 200));
  await ctx.close();
}

/* ── 反例:測試本身要會抓錯(否則上面的綠燈可能是恆真)── */
{ // ① 棋盤不一致 ⇒ fixture 檢查必須報錯
  const { ctx, setup } = await openFixture("2026-09-28");
  const bad = JSON.parse(JSON.stringify(setup.snap));
  bad.pieces[setup.rookId].position = 5;
  const e = validateFixture(bad);
  ok(e.length > 0 && e.some((m) => m.includes("position=5")), "反例① 紅俥 position 與 board 不符 ⇒ fixture 檢查報錯", JSON.stringify(e));
  const short = { board: setup.snap.board.slice(0, 31), pieces: setup.snap.pieces };
  ok(validateFixture(short).length > 0, "反例① 31 格盤面 ⇒ fixture 檢查報錯(不截斷湊數)");
  await ctx.close();
}
{ // ② 不走最後一手 ⇒ 前置本身不能造出通關
  const { ctx, pg, setup } = await openFixture("2026-09-28");
  checkFixture("反例②", setup);
  await pg.waitForTimeout(400);
  const w = await observe(pg);
  await pg.click("#dailyButton");
  await pg.waitForTimeout(300);
  const deck = await pg.evaluate(() => window.__banqi.state.dailyDeck);
  ok(w.winner === null && w.store === null && deck === 1, "反例② 不走 0→1 ⇒ 沒有勝者、沒有戰績、每日鈕仍是第 1 副",
    JSON.stringify({ winner: w.winner, store: w.store, deck }));
  await ctx.close();
}
{ // ③ 斷掉紀錄寫入 ⇒ T01 照綠,但 T02 與接副必須抓到
  const { ctx, pg, setup } = await openFixture("2026-09-28", { mutateStore: true });
  checkFixture("反例③", setup);
  await playLastMove(pg);
  const w = await observe(pg);
  await pg.click("#dailyButton");
  await pg.waitForTimeout(300);
  const deck = await pg.evaluate(() => window.__banqi.state.dailyDeck);
  const t01 = w.winner === "red" && w.turnCount === 9;
  const t02Caught = !((JSON.parse(w.store || "{}")["2026-09-28"] || {}).decks || {})["1"];
  ok(t01 && t02Caught && deck === 1, "反例③ applyDailyWin 不持久化 ⇒ T01 仍紅勝,但 T02(無戰績)與 T04(仍第 1 副)確實會紅",
    JSON.stringify({ t01, t02Caught, deck }));
  await ctx.close();
}


/* ══════ 🐾 動物對手(2026-09-28,skill animal-opponent-kit;本站是 CSS 斜視棋盤 ⇒ 透明 WebGL 小窗貼在棋盤遠端上方)══════
   檔案側對賬 → 真操作開一局標準 → 坐著 / 鐵則遍歷 / 頭在小窗裡 / 小窗在卡片裡、不蓋任何格子、不擋點擊 / 狀態帶臉
   → 手機直向也放得下 → 手機橫向 fit-play 放不下就藏、棋盤照舊 → 真點一顆翻子等牠回手(figs.log 有 think + 翻/走)
   → 姿勢手動推時間 → 三段開關 → 雙人同機不坐 → 人聲 runtime → 每日 = 🦉 */
console.log("—— 🐾 動物對手 ——");
{
  const fs = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath, pathToFileURL } = await import("node:url");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const { VOICE_FILES } = await import(pathToFileURL(join(root, "js", "voicePhrases.js")).href);
  const vdir = join(root, "voice");
  const mp3 = fs.existsSync(vdir) ? fs.readdirSync(vdir).filter((f) => f.endsWith(".mp3")).sort() : [];
  const want = [...VOICE_FILES].sort();
  ok(mp3.join() === want.join(), `🗣 voice/ 有 ${mp3.length} 支 mp3,跟詞庫 ${want.length} 句一一對應`);
  const sw = fs.readFileSync(join(root, "sw.js"), "utf8");
  const missing = mp3.filter((f) => !sw.includes(`"./voice/${f}"`));
  ok(missing.length === 0 && sw.includes('"./voice/manifest.json"'), `🗣 sw.js 清單含 manifest + 每支 mp3(gen-voice 照目錄重生)${missing.length ? ":漏 " + missing.join(",") : ""}`);
  let manifestOk = false;
  try { const mf = JSON.parse(fs.readFileSync(join(vdir, "manifest.json"), "utf8")); manifestOk = mp3.length > 0 && mp3.every((f) => mf[f.replace(/\.mp3$/, "")] === "voice/" + f); } catch { /* 沒烤 */ }
  ok(manifestOk, "🗣 manifest.json 的鍵值跟目錄一致");
  const tiny = mp3.filter((f) => fs.statSync(join(vdir, f)).size < 2048);
  ok(tiny.length === 0, `🗣 每支 mp3 > 2KB(空檔 = 烤失敗)${tiny.length ? ":" + tiny.join(",") : ""}`);
  const webSpeech = ["app.js", ...fs.readdirSync(join(root, "js")).map((f) => "js/" + f)].filter((f) => f.endsWith(".js") && fs.readFileSync(join(root, f), "utf8").includes("speech" + "Synthesis"));
  ok(webSpeech.length === 0, `🗣 沒有 Web Speech 機器聲${webSpeech.length ? ":" + webSpeech.join(",") : ""}`);
  const kit = join(process.env.USERPROFILE || process.env.HOME || "", ".claude", "skills", "animal-opponent-kit", "assets");
  if (fs.existsSync(kit)) {
    const drift = [["animals.js", "animals.js"], ["voice.js", "voice.js"], ["three-shim.js", "three-global-shim.js"]]
      .filter(([site, asset]) => fs.readFileSync(join(root, "js", site), "utf8") !== fs.readFileSync(join(kit, asset), "utf8")).map(([site]) => site);
    ok(drift.length === 0, `🐾 引擎三支與 skill 同一份${drift.length ? ":漂移 " + drift.join(",") : ""}`);
  }
}
await page.setViewportSize({ width: 1100, height: 820 });
await page.click("#newGameButton");
await page.selectOption("#modeSelect", "ai");
await page.selectOption("#difficultySelect", "standard");
await page.click('#petControls [data-pet="voice"]');
await page.waitForFunction(() => window.__banqi.pet && window.__banqi.pet.kind === "cat" && window.__banqi.pet.visible, null, { timeout: 5000 });
await page.waitForTimeout(700);
/* 🐾 v12:牠跟棋盤在**同一個** three scene(舊 v11 的透明小窗 #petWindow 拿掉了)。
   舊斷言「小窗在卡片裡 / 小窗不蓋格子」換成同 scene 的等價斷言:整頁只有一張 WebGL 畫布、牠的 group 掛在棋盤 scene、
   坐在相機對面(換邊後跟著換)、凳子落地、頭框在畫布裡、頭在所有格心的上方(不擋格)、遠端那排格心的畫面點仍是畫布、
   開動物後盤寬 ≥ 關閉時 75%。理由:小窗不存在了,量它等於量空氣(規格 §5「旧小窗位置断言替换」)。 */
const petProbe = () => page.evaluate(() => {
  const B = window.__banqi, P = B.pet, R3 = B.renderer, f = P.figure;
  let neck = 0, eyes = 0, ears = 0, brows = 0, mouth = 0;
  if (f) f.group.traverse((o) => { if (o.userData.neck) neck++; if (o.userData.eye) eyes++; if (o.userData.ear) ears++; if (o.userData.brow) brows++; if (o.userData.mouth) mouth++; });
  document.querySelector("#board3d").scrollIntoView({ block: "center" });
  const pr = P.probe();
  const cv = document.querySelector("#board3dCanvas").getBoundingClientRect();
  const cellYs = [...Array(32).keys()].map((i) => R3.cellToScreen(i).y);
  const far2 = R3.cellToScreen(1);
  const hit = document.elementFromPoint(far2.x, far2.y);
  const hb = pr.headBox || { l: 0, t: 0, r: 0, b: 0 };
  const out = { ...pr, neck, eyes, ears, brows, mouth, capsule: !!window.THREE.CapsuleGeometry,
    canvases: document.querySelectorAll("canvas").length, sameScene: !!(f && R3.board.scene.children.includes(f.group)), petWindow: !!document.querySelector("#petWindow"),
    headInCanvas: pr.figure ? (hb.l >= cv.left - 1 && hb.r <= cv.right + 1 && hb.t >= cv.top - 4 && hb.b <= cv.bottom + 1) : false,
    headAboveCells: pr.figure ? hb.b <= Math.min(...cellYs) : false,
    farHitIsCanvas: !!(hit && hit.id === "board3dCanvas"), yaw: R3.board.yaw,
    side: document.querySelector("#statusSide").textContent, pressed: document.querySelector('#petControls [aria-pressed="true"]')?.dataset.pet,
    fitPlay: document.body.classList.contains("fit-play"), petOn: document.body.classList.contains("pet-on") };
  window.scrollTo(0, 0);
  return out;
});
const pet0 = await petProbe();
ok(pet0.figure && pet0.visible && pet0.kind === "cat" && pet0.groupVisible, `🐾 標準檔 ⇒ 🐱 橘貓坐在棋盤對面(scale ${pet0.scale}、R ${pet0.R})`);
ok(pet0.canvases === 1 && pet0.sameScene && !pet0.petWindow, `🐾 同一個 scene:整頁只有 ${pet0.canvases} 張畫布、牠掛在棋盤 scene、沒有舊小窗`);
ok(pet0.capsule, "🐾 three-shim 補上了 r128 沒有的 CapsuleGeometry");
ok(pet0.neck === 1 && pet0.eyes === 2 && pet0.ears === 2 && pet0.brows === 2 && pet0.mouth === 1, "🐾 人物鐵則遍歷:脖子 1、眼 2、耳 2、眉 2、嘴 1");
ok(pet0.head.inside && pet0.ear.inside && pet0.headInCanvas, `🐾 桌機:頭頂與耳尖都在畫面裡、頭框在畫布內(頭 NDC ${pet0.head.y}、耳尖 ${pet0.ear.y})`);
ok(pet0.pos.z < 0 && Math.abs(pet0.stoolY - pet0.floorY) < 0.02, `🐾 坐在相機對面(z ${pet0.pos.z})、凳子落地(${pet0.stoolY} vs 地板 ${pet0.floorY})`);
ok(pet0.headAboveCells && pet0.farHitIsCanvas, `🐾 頭在所有格心上方(不擋格)、遠端那排的畫面點仍是棋盤畫布`);
ok(pet0.pressed === "voice" && pet0.petOn, `🐾 三段鈕亮「會說話」、body.pet-on(開局還沒定邊 ⇒ 狀態行先寫「${pet0.side}」)`);
/* 開動物後盤寬 ≥ 關閉時 75% */
const widthWith = await page.evaluate(() => window.__banqi.renderer.boardScreenBox().w);
await page.click('#petControls [data-pet="off"]');
await page.waitForTimeout(200);
const widthWithout = await page.evaluate(() => window.__banqi.renderer.boardScreenBox().w);
await page.click('#petControls [data-pet="voice"]');
await page.waitForTimeout(200);
ok(widthWith >= widthWithout * 0.75, `🐾 開動物後盤寬 ${Math.round(widthWith)} ≥ 關閉時 ${Math.round(widthWithout)} 的 75%`);
/* 換邊:牠跟著坐到新的對面 */
await page.locator("#board3d").scrollIntoViewIfNeeded();
await page.click("#viewButton");
await page.click("[data-vk-flip]");
await page.waitForTimeout(300);
const petFlip = await petProbe();
ok(petFlip.pos.z > 0 && Math.abs(petFlip.yaw - 180) < 1, `🐾 🔃 換邊 ⇒ 牠也換到新的對面(yaw ${petFlip.yaw}、z ${petFlip.pos.z})`);
await page.locator("#board3d").scrollIntoViewIfNeeded();
await page.click("[data-vk-reset]");
await page.click("#viewButton");
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(700);
const petPort = await petProbe();
ok(petPort.visible && petPort.head.inside && petPort.ear.inside && petPort.headInCanvas && petPort.headAboveCells, `🐾 手機直向:整顆頭 + 耳尖在畫布裡、不擋格(頭 ${petPort.head.y}、耳尖 ${petPort.ear.y})`);
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(900);
const petLand = await petProbe();
ok(petLand.fitPlay && !petLand.visible && petLand.suppressed && !petLand.groupVisible, "🐾 手機橫向 fit-play 畫面太矮(<480)⇒ 牠藏起來、棋盤不為牠縮(接受:看牠請轉直向)");
await page.setViewportSize({ width: 1100, height: 820 });
await page.waitForTimeout(700);
ok((await petProbe()).visible, "🐾 轉回桌機 ⇒ 牠回來");
/* 真座標點一顆暗子(翻子定邊)⇒ 牠開算(think)⇒ 牠回手(翻 hop/shrug 或 走 place 或 吃 hop) */
await page.locator("#board3d").scrollIntoViewIfNeeded();
const tap5 = await page.evaluate(() => window.__banqi.renderer.pieceTopToScreen(5));
await page.mouse.click(tap5.x, tap5.y);
await page.waitForFunction(() => { const B = window.__banqi, s = B.state; return s.humanSide && s.turnSide === s.humanSide && !s.aiThinking && !B.animBusy && B.pet.figs.log.length >= 2; }, null, { timeout: 20000 });
await page.waitForTimeout(200);
const moved = await page.evaluate(() => ({ log: window.__banqi.pet.figs.log.map((e) => e.kind), last: window.__banqi.state.lastAction && window.__banqi.state.lastAction.type, first: window.__banqi.state.pieces.find((p) => p.position === 5)?.revealed }));
ok(moved.first && moved.log.includes("think") && moved.log.some((k) => ["hop", "shrug", "place"].includes(k)), `🐾 真座標點 idx 5 翻開了,事件真的接到(figs.log):${moved.log.join(",")}(牠上一手 ${moved.last})`);
const sideAfter = await page.evaluate(() => document.querySelector("#statusSide").textContent);
ok(/🐱 橘貓\(AI\)執/.test(sideAfter), `🐾 定邊後狀態行寫「對手是誰」(${sideAfter})`);
const pose = await page.evaluate(() => {
  const P = window.__banqi.pet, f = P.figure, F = P.figs;
  const said = []; const o = P.voice.say.bind(P.voice); P.voice.say = (a, e, d) => { said.push(a + ":" + e); return o(a, e, d); };
  P.react("win", "win"); F.update(0.4);
  const up = { armL: +f.arms[0].rotation.x.toFixed(2), armR: +f.arms[1].rotation.x.toFixed(2), open: f.mouthOpen.visible };
  F.update(3.5); F.update(0.5);
  const back = { armL: +f.arms[0].rotation.x.toFixed(2), smile: f.smile.visible };
  P.react("lose", "lose"); F.update(0.4);
  const sad = { pitch: +f.head.rotation.x.toFixed(2), smileZ: +f.smile.rotation.z.toFixed(2) };
  F.update(3.5); F.update(0.5);
  P.react("think", null); F.update(0.4);
  const think = { armR: +f.arms[1].rotation.x.toFixed(2), tilt: +f.head.rotation.z.toFixed(2) };
  P.cancel(); F.update(1);
  P.voice.say = o;
  return { up, back, sad, think, said };
});
ok(pose.up.armL < -2.2 && pose.up.armR < -2.2 && pose.up.open, `🐾 win:雙手高舉 + 張嘴(${JSON.stringify(pose.up)})`);
ok(Math.abs(pose.back.armL + 1.2) < 0.15 && pose.back.smile, `🐾 反應完回休息姿勢、笑臉回來(${JSON.stringify(pose.back)})`);
ok(pose.sad.pitch > 0.3 && pose.sad.smileZ < 1.6, `🐾 lose:低頭 + 苦臉(${JSON.stringify(pose.sad)})`);
ok(pose.think.armR < -1.9 && pose.think.tilt < -0.05, `🐾 think:手托腮、頭歪(${JSON.stringify(pose.think)})`);
ok(pose.said.join(" ") === "cat:win cat:lose", `🗣 同一個入口也叫了人聲:${pose.said.join(" ")}`);
await page.click('#petControls [data-pet="off"]');
await page.waitForTimeout(150);
const off = await page.evaluate(() => ({ groupVisible: window.__banqi.pet.figure.group.visible, saved: localStorage.getItem("banqi-pet"), on: window.__banqi.pet.on, side: document.querySelector("#statusSide").textContent }));
ok(off.groupVisible === false && off.saved === "off" && !off.on && !/🐱/.test(off.side), `🐾 關掉 ⇒ 牠藏起來(visible 嚴格 false)、localStorage 記 off、狀態不帶臉(${JSON.stringify(off)})`);
await page.click('#petControls [data-pet="mute"]');
await page.waitForTimeout(150);
const mute = await page.evaluate(() => ({ groupVisible: window.__banqi.pet.figure.group.visible, voiceOn: window.__banqi.pet.voiceOn, visible: window.__banqi.pet.visible }));
ok(mute.groupVisible === true && mute.visible && mute.voiceOn === false, `🐾 不出聲 ⇒ 還坐著、不唸(${JSON.stringify(mute)})`);
await page.click('#petControls [data-pet="voice"]');
await page.selectOption("#modeSelect", "local");
await page.waitForTimeout(300);
const local = await page.evaluate(() => ({ kind: window.__banqi.pet.kind, figure: !!window.__banqi.pet.figure, petOn: document.body.classList.contains("pet-on") }));
ok(local.kind === null && !local.figure && !local.petOn, "🐾 雙人同機 ⇒ 沒有動物");
await page.selectOption("#modeSelect", "ai");
await page.waitForFunction(() => window.__banqi.pet.kind === "cat", null, { timeout: 5000 });
await page.waitForFunction(() => window.__banqi.pet.voice.ready(), null, { timeout: 10000 }).catch(() => {});
const v = await page.evaluate(() => { const V = window.__banqi.pet.voice; return { ready: V.ready(), has: V.has("owl", "flip"), yes: V.say("cat", "win"), no: V.say("cat", "nope") }; });
ok(v.ready && v.has && v.yes === true && v.no === false, `🗣 人聲 runtime:manifest 載到、cat-win 送去放、沒烤的不唸(${JSON.stringify(v)})`);
await page.click("#dailyButton");
await page.waitForFunction(() => window.__banqi.pet.kind === "owl", null, { timeout: 5000 });
await page.waitForTimeout(400);
const owl = await petProbe();
ok(owl.kind === "owl" && owl.visible && owl.head.inside, `🐾 每日同副牌 ⇒ 🦉 貓頭鷹陪你`);

ok(errors.length === 0, "整場零 pageerror", errors.join(" | ").slice(0, 200));

await browser.close();
console.log(`\n🔬 browser-check:${pass} 過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
