/* ai-worker.js — 雲臺暗棋 AI / 💡 提示的搜尋執行緒(2026-09-29,v12 真 3D)
 *
 * 為什麼要 Worker:3D 版有 60fps 動畫與拖曳視角,高手檔一次搜尋可以到 900ms,在主執行緒跑會讓整個畫面凍住
 *   (skill board3d-kit 坑 ⑦)。這支只做一件事:收一個純資料局面、跑 banqi-core.js 裡**同一支** chooseAiAction /
 *   chooseHintAction、把選到的那一手送回去。規則與搜尋一個字都不在這裡(board3d-kit 坑 ⑧:不要第二份)。
 * 送進來的只有 structuredClone 得過的純資料(board 陣列、pieces 物件陣列、輪次字串、數字);沒有 DOM、沒有函式、沒有 three。
 * 回覆原樣帶回 gen / reqId / turnCount / turnSide / purpose,主執行緒自己比對「是不是這一局、這一手、最新那個請求」,過期就丟。
 */
importScripts("./banqi-core.js");

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

self.onmessage = (event) => {
  const req = event.data || {};
  const reply = { gen: req.gen, reqId: req.reqId, purpose: req.purpose, turnCount: req.turnCount, turnSide: req.turnSide };
  const Core = self.BanqiCore;
  try {
    Core.setRandom(Number.isFinite(req.seed) ? mulberry32(req.seed) : null);
    const probe = Core.cloneState(req.state);
    probe.aiSide = req.state.aiSide;
    const t0 = performance.now();
    let action;
    if (req.purpose === "hint") {
      probe.hintLevel = req.level || Core.HINT_LEVEL;
      action = Core.chooseHintAction(probe);
    } else {
      probe.hintLevel = req.level || Core.AI_LEVELS[probe.difficulty] || Core.AI_LEVELS.standard;
      action = Core.chooseAiAction(probe);
    }
    reply.action = action || null;
    reply.ms = Math.round(performance.now() - t0);
  } catch (error) {
    reply.error = String(error && error.message || error);
  }
  self.postMessage(reply);
};
