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
  /* 0928 修:本站棋盤是 **4 欄 × 8 列**(app.js BOARD_COLS=4、index = row*4+col),這裡原本寫 8 欄 ⇒ 相鄰算錯,
     今天這副牌找不到「有相鄰空格的己方明子」、後面六條連環假紅(0928 接動物對手時抓到;stash 回原碼同樣紅,不是新病)。 */
  const COLS = 4, ROWS = 8;
  const adjacentEmpty = (index) => {
    const row = Math.floor(index / COLS);
    const col = index % COLS;
    const cands = [];
    if (row > 0) cands.push(index - COLS);
    if (row < ROWS - 1) cands.push(index + COLS);
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
const petProbe = () => page.evaluate(() => {
  const P = window.__banqi.pet, f = P.figure;
  let neck = 0, eyes = 0, ears = 0, brows = 0, mouth = 0;
  if (f) f.group.traverse((o) => { if (o.userData.neck) neck++; if (o.userData.eye) eyes++; if (o.userData.ear) ears++; if (o.userData.brow) brows++; if (o.userData.mouth) mouth++; });
  const pr = P.probe();
  const wrap = document.querySelector(".board-card").getBoundingClientRect();
  const cells = [...document.querySelectorAll("#board .cell")].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0);
  const w = pr.win;
  const overlapCells = pr.visible ? cells.filter((r) => !(r.right < w.l || r.left > w.r || r.bottom < w.t || r.top > w.b)).length : 0;
  const farCell = [...document.querySelectorAll("#board .cell")].reduce((a, c) => (c.getBoundingClientRect().top < a.getBoundingClientRect().top ? c : a));
  farCell.scrollIntoView({ block: "center" });   // elementFromPoint 吃視口座標:棋盤在頁面下半、沒捲進來會回 null(假紅)
  const far = farCell.getBoundingClientRect();
  const hit = document.elementFromPoint(far.left + far.width / 2, far.top + far.height / 2);
  window.scrollTo(0, 0);
  return { ...pr, neck, eyes, ears, brows, mouth, capsule: !!window.THREE.CapsuleGeometry,
    inCard: w.l >= wrap.left - 1 && w.r <= wrap.right + 1 && w.t >= wrap.top - 1,
    overlapCells, farHitIsCell: !!(hit && hit.closest && hit.closest(".cell")),
    side: document.querySelector("#statusSide").textContent, tag: document.querySelector("#petTag").textContent, pressed: document.querySelector('#petControls [aria-pressed="true"]')?.dataset.pet,
    fitPlay: document.body.classList.contains("fit-play"), petOn: document.body.classList.contains("pet-on") };
});
const pet0 = await petProbe();
ok(pet0.figure && pet0.visible && pet0.kind === "cat" && pet0.groupVisible, `🐾 標準檔 ⇒ 🐱 橘貓坐在棋盤對面(小窗 ${pet0.win.w}×${pet0.win.h} @ ${pet0.win.l},${pet0.win.t};相機距 ${pet0.dist})`);
ok(pet0.capsule, "🐾 three-shim 補上了 r128 沒有的 CapsuleGeometry");
ok(pet0.neck === 1 && pet0.eyes === 2 && pet0.ears === 2 && pet0.brows === 2 && pet0.mouth === 1, "🐾 人物鐵則遍歷:脖子 1、眼 2、耳 2、眉 2、嘴 1");
ok(pet0.head.inside, `🐾 桌機:頭頂在小窗裡(NDC ${pet0.head.x}, ${pet0.head.y})`);
ok(pet0.inCard, `🐾 小窗整個在棋盤卡片裡(卡片 overflow:hidden,出界就被切)`);
ok(pet0.overlapCells === 0 && pet0.farHitIsCell, `🐾 小窗不蓋任何一格(壓到 ${pet0.overlapCells} 格)、遠端那排照樣點得到`);
ok(pet0.pressed === "voice" && pet0.petOn && /🐱/.test(pet0.tag), `🐾 三段鈕亮「會說話」、body.pet-on、小窗名牌帶臉(${pet0.tag};開局還沒定邊 ⇒ 狀態行先寫「${pet0.side}」)`);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(700);
const petPort = await petProbe();
ok(petPort.visible && petPort.head.inside && petPort.overlapCells === 0 && petPort.inCard, `🐾 手機直向:也放得下(小窗 ${petPort.win.w}×${petPort.win.h};頭 ${petPort.head.x}, ${petPort.head.y};壓到 ${petPort.overlapCells} 格)`);
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(900);
const petLand = await petProbe();
ok(petLand.fitPlay && !petLand.visible && petLand.hidden, "🐾 手機橫向 fit-play 卡片太矮(<480)⇒ 小窗藏起來、棋盤不為牠縮(接受:看牠請轉直向)");
await page.setViewportSize({ width: 1100, height: 820 });
await page.waitForTimeout(700);
ok((await petProbe()).visible, "🐾 轉回桌機 ⇒ 小窗回來");
/* 真點一顆暗子(翻子定邊)⇒ 牠開算(think)⇒ 牠回手(翻 hop/shrug 或 走 place 或 吃 hop) */
await page.locator("#board .cell").nth(5).click();
await page.waitForFunction(() => { const B = window.__banqi, s = B.state; return s.humanSide && s.turnSide === s.humanSide && !s.aiThinking && B.pet.figs.log.length >= 2; }, null, { timeout: 20000 });
await page.waitForTimeout(200);
const moved = await page.evaluate(() => ({ log: window.__banqi.pet.figs.log.map((e) => e.kind), turn: window.__banqi.state.turnSide, human: window.__banqi.state.humanSide, last: window.__banqi.state.lastAction && window.__banqi.state.lastAction.type }));
ok(moved.log.includes("think") && moved.log.some((k) => ["hop", "shrug", "place"].includes(k)), `🐾 事件真的接到(figs.log):${moved.log.join(",")}(牠上一手 ${moved.last})`);
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
const off = await page.evaluate(() => ({ hidden: document.querySelector("#petWindow").hidden, saved: localStorage.getItem("banqi-pet"), on: window.__banqi.pet.on, side: document.querySelector("#statusSide").textContent }));
ok(off.hidden && off.saved === "off" && !off.on && !/🐱/.test(off.side), `🐾 關掉 ⇒ 小窗藏起來、localStorage 記 off、狀態不帶臉(${JSON.stringify(off)})`);
await page.click('#petControls [data-pet="mute"]');
await page.waitForTimeout(150);
const mute = await page.evaluate(() => ({ hidden: document.querySelector("#petWindow").hidden, voiceOn: window.__banqi.pet.voiceOn, visible: window.__banqi.pet.visible }));
ok(!mute.hidden && mute.visible && mute.voiceOn === false, `🐾 不出聲 ⇒ 還坐著、不唸(${JSON.stringify(mute)})`);
await page.click('#petControls [data-pet="voice"]');
await page.selectOption("#modeSelect", "local");
await page.waitForTimeout(300);
const local = await page.evaluate(() => ({ kind: window.__banqi.pet.kind, hidden: document.querySelector("#petWindow").hidden, petOn: document.body.classList.contains("pet-on") }));
ok(local.kind === null && local.hidden && !local.petOn, "🐾 雙人同機 ⇒ 沒有動物、小窗藏起來");
await page.selectOption("#modeSelect", "ai");
await page.waitForFunction(() => window.__banqi.pet.kind === "cat", null, { timeout: 5000 });
await page.waitForFunction(() => window.__banqi.pet.voice.ready(), null, { timeout: 10000 }).catch(() => {});
const v = await page.evaluate(() => { const V = window.__banqi.pet.voice; return { ready: V.ready(), has: V.has("owl", "flip"), yes: V.say("cat", "win"), no: V.say("cat", "nope") }; });
ok(v.ready && v.has && v.yes === true && v.no === false, `🗣 人聲 runtime:manifest 載到、cat-win 送去放、沒烤的不唸(${JSON.stringify(v)})`);
await page.click("#dailyButton");
await page.waitForFunction(() => window.__banqi.pet.kind === "owl", null, { timeout: 5000 });
await page.waitForTimeout(400);
const owl = await petProbe();
ok(owl.kind === "owl" && owl.visible && owl.head.inside && /🦉/.test(owl.tag), `🐾 每日同副牌 ⇒ 🦉 貓頭鷹陪你(${owl.tag})`);

ok(errors.length === 0, "整場零 pageerror", errors.join(" | ").slice(0, 200));

await browser.close();
console.log(`\n🔬 browser-check:${pass} 過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
