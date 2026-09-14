// 🔬 ▼ 收起選單 真瀏覽器驗收(menu-fold v1,2026-09-14;playwright-core + 系統 Edge)。
// 跑法:py -m http.server 8797  →  npm run test:fold   (或 CHECK_URL=https://darkchesscodex.pages.dev node scripts/check-fold.mjs)
//
// 桌機 1200×800 與手機直向 390×844 各跑一輪,**全部真點擊 page.click**(繞過真點擊的話,
// 「鈕被別的東西蓋住、按不到」這種病照樣全綠):
//   ① 鈕看得見:在 DOM、有大小、offsetParent 不為 null、而且不捲動就在畫面裡
//   ② 按下去:body.menu-folded、aria-expanded=false、info-column 與三張 panel 的 offsetParent===null、
//      棋盤 offsetWidth / boundingBox 不變小(桌機要真的變大)、整頁變短、鈕自己還在
//   ③ 再按:展開回來(aria-expanded=true、面板回到畫面、棋盤回原尺寸)
//   ④ 收起後 reload:localStorage 記得住,一進來就是收起的
//   ⑤ 整場零 pageerror
// ⚠ 首次載入若 SW 自動 reload,先等 navigation.type==='reload'(最多 6 秒放行)。
//   本站 SW 只有 skipWaiting/clients.claim、不會自己 reload,這段等待是艦隊通則的保險,等不到就放行。
import { chromium } from "playwright-core";

const URL = process.env.CHECK_URL || "http://localhost:8797";
const STORE_KEY = "cloud-banqi-menu-folded-v1";

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
const errors = [];

async function settle(page) {
  // SW 自動 reload 的保險:等到 navigation.type==='reload',6 秒等不到就放行
  await page.waitForFunction(
    () => (performance.getEntriesByType("navigation")[0] || {}).type === "reload",
    null, { timeout: 6000 },
  ).catch(() => {});
  try {
    await page.waitForFunction(() => !!window.__banqi, null, { timeout: 20000 });
  } catch {
    console.error("🔴 window.__banqi 沒出現,app.js 載入時就出錯了:");
    console.error(errors.length ? errors.join("\n") : "(沒抓到 pageerror,檢查 script 有沒有 404)");
    await browser.close();
    process.exit(1);
  }
  await page.waitForTimeout(400);
}

function snap(page) {
  return page.evaluate((key) => {
    const board = document.querySelector("#board");
    const rect = board.getBoundingClientRect();
    const info = document.querySelector(".info-column");
    const panels = Array.from(document.querySelectorAll(".info-column .panel.card"));
    const btn = document.querySelector("#menuFoldButton");
    const b = btn ? btn.getBoundingClientRect() : null;
    let stored = null;
    try { stored = localStorage.getItem(key); } catch { /* 私密模式 */ }
    return {
      folded: document.body.classList.contains("menu-folded"),
      expanded: btn ? btn.getAttribute("aria-expanded") : null,
      text: btn ? btn.textContent.trim() : "",
      btnVisible: !!btn && btn.offsetParent !== null && b.width > 0 && b.height > 0,
      btnInView: !!b && b.top >= 0 && b.bottom <= window.innerHeight && b.left >= 0 && b.right <= window.innerWidth,
      btnBox: b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null,
      panelCount: panels.length,
      infoHidden: !!info && info.offsetParent === null,
      panelsHidden: panels.length === 3 && panels.every((p) => p.offsetParent === null),
      panelsShown: panels.length === 3 && panels.every((p) => p.offsetParent !== null),
      boardW: board.offsetWidth,
      boardBox: { w: Math.round(rect.width), h: Math.round(rect.height) },
      docH: document.documentElement.scrollHeight,
      stored,
    };
  }, STORE_KEY);
}

const VIEWPORTS = [
  { name: "桌機 1200×800", width: 1200, height: 800, mobile: false },
  { name: "手機直向 390×844", width: 390, height: 844, mobile: true },
];

for (const vp of VIEWPORTS) {
  console.log(`\n▶ ${vp.name}`);
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: vp.mobile, hasTouch: vp.mobile, deviceScaleFactor: vp.mobile ? 3 : 1,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(vp.name + ": " + String(e)));
  await page.goto(URL + "/?v=" + Date.now(), { waitUntil: "domcontentloaded" });
  await settle(page);

  // 乾淨起點(新 context 本來就沒有 localStorage,這行是對線上/舊 profile 的保險)
  await page.evaluate((key) => { try { localStorage.removeItem(key); } catch {} }, STORE_KEY);

  const s0 = await snap(page);
  ok(s0.panelCount === 3, "info-column 有三張 panel.card", `count=${s0.panelCount}`);
  ok(s0.btnVisible, "① 鈕看得見(在 DOM、有大小、offsetParent 不為 null)", JSON.stringify(s0.btnBox));
  ok(s0.btnInView, "① 鈕不用捲就在畫面裡", `${JSON.stringify(s0.btnBox)} viewport=${vp.width}×${vp.height}`);
  ok(!s0.folded && s0.expanded === "true" && s0.text.includes("收起選單"),
    "預設展開:沒有 menu-folded、aria-expanded=true、文字「▼ 收起選單」",
    JSON.stringify({ folded: s0.folded, expanded: s0.expanded, text: s0.text }));
  ok(s0.panelsShown, "預設三張面板都在畫面上");

  // ② 真點擊收起
  await page.click("#menuFoldButton");
  await page.waitForTimeout(450);
  const s1 = await snap(page);
  ok(s1.folded && s1.expanded === "false" && s1.text.includes("展開選單"),
    "② 按下去:body.menu-folded、aria-expanded=false、文字「▲ 展開選單」",
    JSON.stringify({ folded: s1.folded, expanded: s1.expanded, text: s1.text }));
  ok(s1.infoHidden && s1.panelsHidden, "② info-column 與三張 panel 的 offsetParent 都是 null");
  ok(s1.boardW >= s0.boardW && s1.boardBox.w >= s0.boardBox.w,
    `② 棋盤不變小(offsetWidth ${s0.boardW}→${s1.boardW}px;bbox ${s0.boardBox.w}→${s1.boardBox.w}px)`);
  if (vp.mobile) {
    // 手機是單欄:面板本來就在棋盤下面,收起來的好處是「少捲一大段」
    ok(s1.docH < s0.docH, `② 手機整頁變短(${s0.docH}→${s1.docH}px)`);
  } else {
    // 桌機是雙欄:收掉右欄後棋盤放大(4×8 直棋盤,變寬就變高),整頁高度不會變短 ⇒ 驗「真的變大」
    ok(s1.boardW > s0.boardW, `② 桌機棋盤真的變大(${s0.boardW}→${s1.boardW}px)`);
  }
  ok(s1.stored === "1", "② localStorage 記成 1", `stored=${s1.stored}`);
  ok(s1.btnVisible, "② 收起後鈕自己還在(沒把自己藏掉)", JSON.stringify(s1.btnBox));

  // ③ 再按展開
  await page.click("#menuFoldButton");
  await page.waitForTimeout(450);
  const s2 = await snap(page);
  ok(!s2.folded && s2.expanded === "true" && s2.text.includes("收起選單") && s2.panelsShown,
    "③ 再按:展開回來、aria-expanded=true、三張面板回到畫面",
    JSON.stringify({ folded: s2.folded, expanded: s2.expanded, text: s2.text, panelsShown: s2.panelsShown }));
  ok(s2.boardW === s0.boardW, `③ 棋盤回到原尺寸(${s2.boardW}px)`);
  ok(s2.stored === "0", "③ localStorage 記成 0", `stored=${s2.stored}`);

  // ④ 收起 → reload 記得住
  await page.click("#menuFoldButton");
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page);
  const s3 = await snap(page);
  ok(s3.folded && s3.expanded === "false" && s3.panelsHidden && s3.text.includes("展開選單"),
    "④ reload 後仍是收起的(localStorage 記得住)",
    JSON.stringify({ folded: s3.folded, expanded: s3.expanded, panelsHidden: s3.panelsHidden }));
  ok(s3.boardW === s1.boardW, `④ reload 後棋盤尺寸=收起時的尺寸(${s3.boardW}px)`);

  // 收尾:展開回去,不留狀態
  await page.click("#menuFoldButton");
  await page.waitForTimeout(200);
  await context.close();
}

ok(errors.length === 0, "⑤ 整場零 pageerror", errors.join(" | ").slice(0, 300));

await browser.close();
console.log(`\n🔬 check-fold:${pass} 過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
