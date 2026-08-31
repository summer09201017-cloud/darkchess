// daily.js(全域 script,非 module)- 📅 每日同副牌(暗棋版每日殘局)
//
// ★★ 為什麼暗棋是「每日同一副牌」而不是「每日殘局」:
//   暗棋的靈魂是**翻開才知道**(不完全資訊),而「殘局」是完全資訊解謎——
//   給你一個攤開的局面想 N 步殺,那已經不是暗棋了。
//   所以這一款的每日題=**今天全世界的暗子擺法完全相同**:同一副牌、同一個開局,
//   比誰贏得快(用最少回合贏)。運氣拉平了,比的才是判斷。
//
// 決定性洗牌:日期(台北 UTC+8 換日)→ FNV-1a → mulberry32 → Fisher-Yates。
// 不用 Math.random ⇒ 任何裝置、任何時刻開,同一天的擺法逐位元相同(零後端)。

// 台北時間(UTC+8)的日期——「全世界同一副牌」需要一條固定的換日線
function dailyKey(now) {
  return new Date((now || Date.now()) + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 日期 → 亂數函式(同一天必同一序列) */
function dailyRandom(key) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return mulberry32(h);
}

/** 決定性 Fisher-Yates(與產品的 shuffle 同一個演算法,只是亂數來源換掉)
    ★ 就地洗牌並回傳同一個陣列——與 app.js 的 shuffle 契約一致,呼叫端不必分兩種寫法。 */
function seededShuffle(items, rng) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

/* ══ 戰績:{ "YYYY-MM-DD": { best: 最少回合, played: 玩過幾次 } } ══
   零上傳、全包 try/catch(私密模式照玩,只是記不住);只留 60 天。 */
const STORE_KEY = "cloud-banqi:daily:v1";

function loadDailyBook() {
  try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || "{}"); return s && typeof s === "object" ? s : {}; }
  catch { return {}; }
}

/** 贏了才記(輸不記錄,不打擊孩子);回 { best, isNewBest } 給結算講話用 */
function applyDailyWin(key, turns) {
  const all = loadDailyBook();
  const prev = all[key] && all[key].best ? all[key].best : 0;
  const isNewBest = !prev || turns < prev;
  const played = (all[key] && all[key].played ? all[key].played : 0) + 1;
  all[key] = { best: isNewBest ? turns : prev, played };
  const days = Object.keys(all).sort();
  while (days.length > 60) delete all[days.shift()];
  try { localStorage.setItem(STORE_KEY, JSON.stringify(all)); } catch { /* 私密模式 */ }
  return { best: all[key].best, isNewBest, played };
}

// ★ app.js 是傳統 script(非 module)⇒ 用全域命名空間交件,不用 import/export。
window.BanqiDaily = { dailyKey, dailyRandom, seededShuffle, loadDailyBook, applyDailyWin };
