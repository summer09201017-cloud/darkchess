/* scene3d.js — 雲臺暗棋的真 3D 呈現層總控(2026-09-29,v12)
 *
 * app.js 是傳統 script(規則狀態、輪次、AI 流程都在那),這支是 ES module ⇒ 用 window.Banqi3D 橋接(同 v11 PetKit 那招)。
 * 這支只做四件事,**不碰規則**:
 *   ① 建一張 Board3D(cell 模式 4 欄 × 8 列,Y-up、棋盤在 XZ 平面;yaw 0 時 row 0 在遠端、col 0 在左)+ PieceSet(棋子/標記)
 *   ② 手勢:同一次 primary pointer 最多送出**一個**點擊;|dx|+|dy| ≥ 8 CSS px 就是拖曳(轉視角),不會翻子或走子;
 *      pointercancel / lostpointercapture / 第二根手指加入 / 在盤外放開 ⇒ 這次手勢作廢。畫布上不聽 click(沒有雙送的可能)。
 *   ③ 視角面板(skill board3d-kit 的 view-kit:三段預設 + 兩條滑桿 + 換邊 + 重置),浮動在棋盤角落,開合鈕「🎥 視角」
 *   ④ 動物對手坐進同一個 scene(opponent.js)
 * 動畫 / 語音 / 渲染都**無權**改勝負或回合:app.js 先把規則提交完,才叫 sync() 播;播完 resolve,app.js 才開下一手。
 */
import { Board3D } from "./board3d.js";
import { PieceSet } from "./pieces3d.js";
import { mountViewKit, VIEW_PRESETS, normYaw, clampPitch, presetFor } from "./view-kit.js";
import { Opponent, animalFor, PET_MODES, ANIMALS } from "./opponent.js";

const DRAG_THRESHOLD = 8;      // CSS px(|dx|+|dy|),沿用 v11 拖曳門檻

function reducedMotion() {
  try { return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); } catch { return false; }
}

/**
 * @param o.host      畫布外框(.board3d)
 * @param o.canvas    <canvas>
 * @param o.viewButton「🎥 視角」開合鈕
 * @param o.viewPanel 浮動面板(裡面塞 view-kit)
 * @param o.initialView { preset:"top"|"flat"|"sit"|"custom", yaw:number, pitch:number|null }
 * @param o.onTap(index)      點中一格(已經過手勢判定;鎖不鎖由 app.js 決定)
 * @param o.onViewChange(v)   視角被使用者改了(要存)
 * @param o.onContextLost()   WebGL 中途掛掉
 */
export function createScene3D(o) {
  const board = new Board3D(o.canvas, {
    cols: 4, rows: 8, mode: "cell", pitch: 0.3, margin: 0.55, labels: false, centerFit: true, fitExtraMax: 1.22, fitSlab: true,
    storageKey: null,                               // 視角由 app 層存在 cloud-banqi-3d-view-v1,底座不另存
    wood: "#d9b77e", woodEdge: 0x7a5530, woodSide: 0xa8804a, lineColor: "#5a3b17",
    background: 0x0b1f1c, floorColor: 0x0a1715,
    light: { hemi: 0.5, lamp: 0.55, dir: 0.5 },     // r128 非物理燈光(底座預設 22 是給新版 three 的;實測截圖調的)
  });
  const pieces = new PieceSet(board, { reduced: reducedMotion() });
  let pet = null;
  let disposed = false;

  /* ── 視角:初始 / 讀寫 ── */
  function applyView(v) {
    const preset = v && VIEW_PRESETS[v.preset] ? v.preset : (v && v.preset === "custom" ? "custom" : "top");
    board.yaw = normYaw(v && Number.isFinite(v.yaw) ? v.yaw : 0);
    if (preset === "custom" && v && Number.isFinite(v.pitch)) { board.view = "top"; board.setPitch(clampPitch(v.pitch)); }
    else board.setView(preset === "custom" ? "top" : preset);
  }
  function currentView() {
    const custom = board.pitchOverride != null;
    return {
      version: 1,
      preset: custom ? "custom" : board.view,
      yaw: normYaw(board.yaw),
      pitch: custom ? clampPitch(board.pitchOverride) : null,
    };
  }
  const emitView = () => { try { o.onViewChange && o.onViewChange(currentView()); } catch { /* 存不了就算了 */ } };
  applyView(o.initialView);

  /* ── 視角面板(view-kit) ── */
  let kit = null;
  if (o.viewPanel) {
    kit = mountViewKit(o.viewPanel, {
      get: () => ({ yaw: board.yaw, pitch: board._pitchFor() }),
      set: ({ yaw, pitch }) => {
        board.yaw = normYaw(yaw);
        if (board.pitchOverride == null && Math.abs(pitch - Math.round(board._pitchFor())) < 0.5) board.fitCamera();
        else board.setPitch(pitch);
        emitView();
      },
      reset: () => { board.yaw = 0; board.setView("top"); emitView(); },
      onChange: (cb) => { board.onCamera = cb; return () => { board.onCamera = null; }; },
    }, {
      animateMs: 0,
      onAction: (name, d) => {
        if (name === "view") { board.setView(d.key); kit.sync(); emitView(); }
        else emitView();
      },
    });
  }
  const setPanel = (open) => {
    if (!o.viewPanel) return;
    o.viewPanel.hidden = !open;
    if (o.viewButton) o.viewButton.setAttribute("aria-expanded", String(open));
    if (open && kit) kit.sync();
  };
  o.viewButton?.addEventListener("click", () => setPanel(o.viewPanel.hidden));
  o.viewPanel?.querySelector("[data-close]")?.addEventListener("click", () => setPanel(false));

  /* ── 手勢 ── */
  const g = { id: null, x0: 0, y0: 0, yaw0: 0, pitch0: 0, dragging: false, cancelled: false, pointers: new Set() };
  const cv = o.canvas;
  cv.style.touchAction = "none";
  function endGesture() { g.id = null; g.dragging = false; g.cancelled = false; }
  cv.addEventListener("pointerdown", (e) => {
    g.pointers.add(e.pointerId);
    if (g.id !== null) { g.cancelled = true; return; }          // 第二根手指加入 ⇒ 這次手勢作廢
    if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    g.id = e.pointerId; g.x0 = e.clientX; g.y0 = e.clientY;
    g.yaw0 = board.yaw; g.pitch0 = board._pitchFor();
    g.dragging = false; g.cancelled = false;
    try { cv.setPointerCapture(e.pointerId); } catch { /* 舊瀏覽器 */ }
  });
  cv.addEventListener("pointermove", (e) => {
    if (e.pointerId !== g.id || g.cancelled) return;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (!g.dragging && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
    g.dragging = true;
    board.yaw = normYaw(g.yaw0 - dx * 0.45);
    const p = clampPitch(g.pitch0 + dy * 0.22);
    if (Math.abs(dy) >= DRAG_THRESHOLD) board.setPitch(p); else board.fitCamera();
  });
  const finish = (e, commit) => {
    g.pointers.delete(e.pointerId);
    if (e.pointerId !== g.id) return;
    const wasDrag = g.dragging, cancelled = g.cancelled || !commit;
    endGesture();
    if (wasDrag) { emitView(); return; }
    if (cancelled) return;
    const r = cv.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;   // 在盤外放開
    const idx = pieces.pick(e.clientX, e.clientY);
    if (idx !== null && idx !== undefined) o.onTap && o.onTap(idx);
  };
  cv.addEventListener("pointerup", (e) => finish(e, true));
  cv.addEventListener("pointercancel", (e) => finish(e, false));
  cv.addEventListener("lostpointercapture", (e) => { if (e.pointerId === g.id) { g.pointers.delete(e.pointerId); endGesture(); } });
  cv.addEventListener("contextmenu", (e) => e.preventDefault());

  /* ── 動物放不下(手機橫向矮畫面):藏起來,也不讓位 ── */
  function layoutPet() {
    if (!pet) return;
    const w = o.host.clientWidth, h = o.host.clientHeight;
    pet.setSuppressed(h < 480 && w > h);
  }
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => layoutPet()) : null;
  ro?.observe(o.host);

  board.addTick((dt) => {
    pieces.update(dt);
    if (pet) pet.update(dt);
  });
  board.onContextLost = () => { if (!disposed) o.onContextLost && o.onContextLost(); };

  const ctl = {
    board, pieces, get pet() { return pet; },
    reset(cells) { pieces.reset(cells); },
    sync(cells, action) { return pieces.sync(cells, action); },
    setMarks(m) { pieces.setMarks(m); },
    get busy() { return pieces.busy; },
    attachPet(voice) {
      if (!pet) { pet = new Opponent(board, voice); layoutPet(); }
      return pet;
    },
    animalFor, PET_MODES, ANIMALS,
    getView: currentView,
    setView(v) { applyView(v); kit?.sync(); },
    cellToScreen(index) { return board.cellToScreen(Math.floor(index / 4), index % 4); },
    pieceTopToScreen(index) { return pieces.pieceTopToScreen(index); },
    pick(x, y) { return pieces.pick(x, y); },
    /** 盤寬(螢幕 px):四個盤角投影框的寬 —— 驗「開動物後盤寬 ≥ 關閉時 75%」 */
    boardScreenBox() {
      const r = o.canvas.getBoundingClientRect();
      const pts = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const v = { x: sx * board.halfX, z: sz * board.halfZ };
        const p = new (board.camera.position.constructor)(v.x, 0, v.z).project(board.camera);
        pts.push({ x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height });
      }
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    },
    probe() {
      return {
        yaw: board.yaw, pitch: +board._pitchFor().toFixed(2), view: board.view, pitchOverride: board.pitchOverride,
        camDist: +(board.camDist || 0).toFixed(3), aspect: +board.camera.aspect.toFixed(3),
        dpr: board.renderer.getPixelRatio(), canvas: { w: o.canvas.width, h: o.canvas.height },
        ...pieces.probe(), pet: pet ? pet.probe() : null, panelOpen: o.viewPanel ? !o.viewPanel.hidden : false,
      };
    },
    loseContext() { const ext = board.renderer.getContext().getExtension("WEBGL_lose_context"); if (ext) ext.loseContext(); return !!ext; },
    dispose() {
      disposed = true;
      ro?.disconnect();
      pieces.dispose();
      kit?.destroy();
      setPanel(false);
      try { board.dispose(); } catch { /* context 已經沒了 */ }
    },
  };
  return ctl;
}
