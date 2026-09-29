/* opponent.js — 雲臺暗棋的 🐾 動物對手接線(本站專屬;引擎 animals.js、人聲 voice.js、three-shim.js 三支與 skill animal-opponent-kit 同一份,不在這裡改)
 *
 * 對手是誰就坐誰:休閒 🐰 白兔 / 標準 🐱 橘貓 / 高手 🐻 棕熊;📅 每日同副牌 = 🦉 貓頭鷹;雙人同機 = 不出現。
 * ★ v12(2026-09-29)真 3D:牠跟棋盤坐在**同一個** three scene 裡(舊版 v11 是 CSS 斜視棋盤 + 一個透明 WebGL 小窗,兩條渲染迴圈)。
 *   範本 gomoku3d/src/opponent.js,但本站棋盤是**矩形** 4×8 ⇒ 座位不能用正方形半徑硬套:
 *   沿「相機對面」那條方向線,盤緣距離 = min(halfX/|sx|, halfZ/|sz|)(射線打到長方形哪一條邊就停在哪),再往外退半個動物。
 *   每幀比 board.yaw,換邊 / 拖曳旋轉了就重擺 ⇒ 永遠在相機對面、面朝盤心、凳子落在地板上。
 * ★ 相機讓位:board3d.fitExtra 多收「頭頂」一點,縮盤上限 FIT_EXTRA_MAX 1.28(盤寬 ≥ 關閉時 78%,規格要 ≥ 75%);
 *   選了正俯視(或手動 ≥ 85°)不收、手機橫向矮畫面(scene3d 設 suppressed)整隻藏起來也不收 —— 不為看不到的東西縮棋盤。
 * ★ 純觀感:不進 pick、不進 Worker、不影響棋力。三段 voice / mute / off 記在 localStorage(banqi-pet,沿用 v11 的鍵)。
 */
import * as THREE from './three-full.js';
import { AnimalFigures, ANIMALS, HEAD_TOP_LOCAL_Y } from './animals.js';

export { ANIMALS };
export const LEVEL_ANIMAL = { casual: 'rabbit', standard: 'cat', master: 'bear' };
export const PET_KEY = 'banqi-pet';
export const PET_MODES = ['voice', 'mute', 'off'];
export function loadPetMode() { try { const v = localStorage.getItem(PET_KEY); return PET_MODES.includes(v) ? v : 'voice'; } catch { return 'voice'; } }
export function savePetMode(m) { try { localStorage.setItem(PET_KEY, m); } catch { /* 私密模式:這場有效 */ } }
/** 這一局該坐哪一隻;null = 不坐(雙人同機) */
export function animalFor(mode, difficulty, daily) {
  if (mode !== 'ai') return null;
  if (daily) return 'owl';
  return LEVEL_ANIMAL[difficulty] || 'cat';
}

const SEAT = 'ai';
/* 動物多大:照「相機讓得出多少位子」算,不照真實比例(gomoku3d 0927 實測同理)。本站盤長邊半寬 ≈1.37。 */
const SCALE_PER_HALF = 0.18 / 1.3;  // 0929 實測:0.24(gomoku3d 正方盤的值)在本站 4×8 長盤上,讓位上限內頭頂被切(桌機 NDC 1.09);0.2 頭頂貼邊耳朵被切 ⇒ 0.18
const EAR_ROOM = 0.55;               // 耳尖在頭頂再上面一點(貓 / 熊 / 兔耳);取景點收到耳尖,不是頭頂(規格:臉 / 耳朵不得裁切)
/* 什麼時候「不為牠讓位」:只有使用者真的選了正俯視(或手動拉到 ≥ 85°)。
   ⚠ 不能只看俯角 ≥ 76:直向手機的「斜俯視」會被自動拉高到 ~80°(board3d 直向補角),那時畫面上下本來就有空,
   不讓位 = 臉被切掉(0929 browser-check 抓到:直向頭頂 NDC 1.37,整顆頭在畫面外)。 */
const PITCH_HIDE_MANUAL = 85;

export class Opponent {
  constructor(board, voice) {
    this.board = board;
    this.voice = voice || null;
    this.figs = new AnimalFigures(board.scene);
    this.kind = null;
    this.mode = loadPetMode();
    this.suppressed = false;      // scene3d:手機橫向矮畫面放不下 ⇒ 藏起來、也不讓位
    this.thinkCount = 0; this.flipCount = 0; this.ended = false;
    this.waiting = false;
    this.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.chat = { idleMs: 0, said: 0, first: 15000, every: 30000, max: 2, log: [] };
    this._yaw = null;
    board.fitExtra = () => this.fitPoints();
  }
  get on() { return this.mode !== 'off' && !!this.kind; }
  get voiceOn() { return this.mode === 'voice'; }
  get emoji() { return this.kind ? ANIMALS[this.kind].emoji : ''; }
  get name() { return this.kind ? ANIMALS[this.kind].name : ''; }
  get figure() { return this.figs.bySeat(SEAT); }
  /** 真的在畫面上(坐著 + 沒被藏) */
  get visible() { return this.on && !this.suppressed; }

  setMode(m) {
    if (!PET_MODES.includes(m)) return false;
    this.mode = m; savePetMode(m);
    this._syncVisible();
    return true;
  }
  setSuppressed(v) {
    const s = v === true;
    if (s === this.suppressed) return;
    this.suppressed = s;
    this._syncVisible();
  }
  _syncVisible() {
    this.figs.setVisible(this.visible === true);
    this.board.fitCamera();
  }

  /** 每局開始叫一次:換人就換動物;null 收起 */
  seat(kind) {
    if (kind !== this.kind) {
      this.kind = kind;
      if (!kind) this.figs.remove(SEAT);
      else this.figs.setKind(SEAT, kind, this._placement());
      this._yaw = this.board.yaw;
    }
    this.figs.cancel(SEAT);
    this.thinkCount = 0; this.flipCount = 0; this.ended = false;
    this.chat.idleMs = 0; this.chat.said = 0;
    this._syncVisible();
  }

  _geom() {
    const b = this.board;
    const half = Math.max(b.halfX, b.halfZ);
    const scale = half * SCALE_PER_HALF;
    const y = THREE.MathUtils.degToRad(b.yaw || 0);
    const sx = -Math.sin(y), sz = -Math.cos(y);              // 相機在 (sin y, cos y) 那邊 ⇒ 對手坐反方向
    // ★ 矩形盤緣:方向線先碰到哪一條邊就停在哪(不是正方形半徑)
    const rim = Math.min(Math.abs(sx) > 1e-6 ? b.halfX / Math.abs(sx) : Infinity, Math.abs(sz) > 1e-6 ? b.halfZ / Math.abs(sz) : Infinity);
    const R = rim + 1.25 * scale;           // 掌心(本地 z≈1.34)剛好搭到盤沿
    const dy = 0.02 - 0.4 * scale;          // 掌心(本地 y 0.4)落在盤面高度
    const floorY = Number.isFinite(b.floorY) ? b.floorY : -0.77;
    const legDrop = (dy - floorY) / scale;  // 凳底一定落地
    return { scale, R, rim, dy, legDrop, sx, sz };
  }
  _placement() {
    const g = this._geom();
    return { pos: { x: g.sx * g.R, y: 0, z: g.sz * g.R }, lookAt: { x: 0, z: 0 }, scale: g.scale, dy: g.dy, legDrop: g.legDrop };
  }
  /** 取景點:頭頂(照現在的 yaw 算,不等人物真的擺過去,fitCamera 與重擺才不會互咬) */
  fitPoints() {
    if (!this.visible) return [];
    const b = this.board;
    if (b.pitchOverride != null ? b.pitchOverride >= PITCH_HIDE_MANUAL : b.view === 'flat') return [];
    const g = this._geom();
    return [new THREE.Vector3(g.sx * g.R, g.dy + (HEAD_TOP_LOCAL_Y + EAR_ROOM) * g.scale, g.sz * g.R)];
  }

  /* ── 反應 / 人聲(同一個入口;沒動物 ⇒ 全部略過)── 介面與 v11 小窗版一樣,app.js 不用改呼叫 */
  react(kind, voiceEvent, delayMs = 0) {
    if (!this.kind) return false;
    const ok = this.figs.react(SEAT, kind);
    if (voiceEvent && this.on && this.voiceOn && this.voice) this.voice.say(this.kind, voiceEvent, delayMs);
    return ok;
  }
  /** 🤔 AI 開始算:姿勢每次做,人聲每三手一次 */
  think() { this.thinkCount++; return this.react('think', this.thinkCount % 3 === 1 ? 'think' : null); }
  /** 🔄 牠翻開一顆:翻到自己的子 hop(人聲每三次一次)、翻到對方的 shrug */
  flipped(isOwn) {
    if (!isOwn) return this.react('shrug', null);
    this.flipCount++;
    return this.react('hop', this.flipCount % 3 === 1 ? 'flip' : null);
  }
  /** 🏁 一局結束(每局一次) */
  endGame(won) {
    if (this.ended) return false;
    this.ended = true;
    return this.react(won ? 'win' : 'lose', won ? 'win' : 'lose', 250);
  }
  cancel() { this.figs.cancel(SEAT); }
  setWaiting(on) { const v = !!on; if (v !== this.waiting) { this.waiting = v; this.chat.idleMs = 0; this.chat.said = 0; } }
  noteInput() { this.chat.idleMs = 0; this.chat.said = 0; }

  /** 每幀(board tick 呼叫;頁面隱藏時 rAF 本來就停):換邊了就重擺、idle、閒聊計時 */
  update(dt) {
    if (this.kind && this._yaw !== this.board.yaw) { this._yaw = this.board.yaw; this.figs.place(SEAT, this._placement()); }
    this.figs.update(dt, { focus: null, turn: null, reduced: this.reduced });
    const c = this.chat;
    if (!this.waiting || !this.on) { c.idleMs = 0; c.said = 0; return; }
    c.idleMs += dt * 1000;
    if (c.said >= c.max || c.idleMs < c.first + c.said * c.every) return;
    c.said++;
    const ev = 'chat' + (1 + Math.floor(Math.random() * 3));
    c.log.push(ev); if (c.log.length > 20) c.log.shift();
    this.react('chat', ev);
  }

  /** smoke 用:哪一隻、看不看得到、頭頂在不在畫面、頭框(頁面 px)、凳子有沒有落地、坐哪邊 */
  probe() {
    const f = this.figure;
    const base = { kind: this.kind, on: this.on, mode: this.mode, suppressed: this.suppressed, visible: this.visible };
    if (!f) return { ...base, figure: false };
    const cam = this.board.camera;
    const rect = this.board.canvas.getBoundingClientRect();
    const top = this.figs.headTop(SEAT).project(cam);
    const ear = f.group.localToWorld(new THREE.Vector3(0, HEAD_TOP_LOCAL_Y + EAR_ROOM, 0)).project(cam);
    const ctr = this.figs.headCenter(SEAT).project(cam);
    const stool = f.group.localToWorld(new THREE.Vector3(0, -f.pose.legDrop, 0));
    const px = (v) => ({ x: rect.left + (v.x + 1) / 2 * rect.width, y: rect.top + (1 - v.y) / 2 * rect.height });
    const c = px(ctr), t = px(top), r = Math.hypot(c.x - t.x, c.y - t.y);
    const g = this._geom();
    return {
      ...base, figure: true, groupVisible: f.group.visible,
      head: { x: +top.x.toFixed(3), y: +top.y.toFixed(3), inside: Math.abs(top.x) <= 1 && Math.abs(top.y) <= 1 },
      ear: { y: +ear.y.toFixed(3), inside: Math.abs(ear.x) <= 1 && Math.abs(ear.y) <= 1 },
      headBox: { l: Math.round(c.x - r), t: Math.round(c.y - r), r: Math.round(c.x + r), b: Math.round(c.y + r) },
      stoolY: +stool.y.toFixed(3), floorY: +this.board.floorY.toFixed(3),
      pos: { x: +f.group.position.x.toFixed(3), z: +f.group.position.z.toFixed(3) },
      rim: +g.rim.toFixed(3), R: +g.R.toFixed(3), scale: +f.pose.scale.toFixed(3),
    };
  }
}
