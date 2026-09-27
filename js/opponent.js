/* opponent.js — 雲臺暗棋的 🐾 動物對手接線(本站專屬;引擎 animals.js、人聲 voice.js、three-shim.js 三支與 skill animal-opponent-kit 同一份,不在這裡改)
 *
 * 對手是誰就坐誰:休閒 🐰 白兔 / 標準 🐱 橘貓 / 高手 🐻 棕熊;📅 每日同副牌 = 🦉 貓頭鷹;雙人同機 = 不出現。
 * ★ 本站棋盤是 CSS 斜視(DOM + rotateX),沒有 three 場景可以坐 ⇒ 牠住在一個**透明的 WebGL 小窗**(#petWindow > canvas)裡:
 *   小窗由 app.js 量棋盤投影框後貼在遠端那條邊上方、置中、pointer-events:none —— 看起來就是坐在棋盤對面。
 *   小窗自己一套 scene / camera / renderer(alpha),動物 1.0 倍坐原點、正面朝相機;相機從前上方(俯角 15°)看牠胸口,
 *   取景用二分法把「凳子底 ~ 耳尖、兩隻手臂外緣」都收進 ±0.95。放不下(fit-play 卡片太矮)app.js 叫 hide()。
 * ★ rAF 只在牠看得見時跑、document.hidden 暫停;dt 上限 0.05。反應 / 人聲 / 閒聊介面跟 3D-Xiangqi 的 opponent.js 一樣。
 * ★ 純觀感:不碰規則、不碰 AI、不擋點擊。三段 voice / mute / off 記在 localStorage。
 */
import * as THREE from 'three';
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
const EAR_ROOM = 0.55;            // 耳尖在頭頂再上面一點(貓 / 熊)
const LEG_DROP = 0.75;            // 凳子底離原點多深(小窗裡沒有地板,取景收到凳子底就好)
const PITCH_DEG = 15;             // 相機俯角
const LOOK_Y = 1.9;               // 看牠胸口
/** 取景要收進來的點(本地座標):凳子底 / 凳面四角 / 兩隻手臂外緣 / 耳尖 */
const FRAME_POINTS = [
  [0, -LEG_DROP, 0], [0.95, -0.37, 0.95], [-0.95, -0.37, 0.95], [0.95, -0.37, -0.95], [-0.95, -0.37, -0.95],
  [1.75, 0.6, 0.6], [-1.75, 0.6, 0.6], [0, HEAD_TOP_LOCAL_Y + EAR_ROOM, 0], [0.9, HEAD_TOP_LOCAL_Y + 0.2, 0], [-0.9, HEAD_TOP_LOCAL_Y + 0.2, 0],
];

export class Opponent {
  /** @param win #petWindow(裡面有 canvas + .pet-window__tag) */
  constructor(win, voice) {
    this.win = win;
    this.canvas = win.querySelector('canvas');
    this.tag = win.querySelector('.pet-window__tag');
    this.voice = voice || null;
    this.kind = null;
    this.mode = loadPetMode();
    this.thinkCount = 0; this.flipCount = 0; this.ended = false;
    this.waiting = false;
    this.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    this.chat = { idleMs: 0, said: 0, first: 15000, every: 30000, max: 2, log: [] };
    this.size = { w: 0, h: 0 };
    this.placed = false;          // app.js 有沒有給過位子
    this.hidden = true;           // app.js 說放不下
    this._raf = 0; this._lastT = 0;
    this.onTick = null;           // app.js 掛:每 ~250ms 重量棋盤投影框(拖曳旋轉時小窗要跟)
    this._tickAcc = 0;
    this._build3d();
    document.addEventListener('visibilitychange', () => this._syncLoop());
  }
  _build3d() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 0.8, 0.1, 100);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    if (THREE.sRGBEncoding !== undefined) this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const key = new THREE.DirectionalLight(0xffffff, 0.85); key.position.set(2.5, 5, 4); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3); fill.position.set(-3, 2, 2); this.scene.add(fill);
    this.figs = new AnimalFigures(this.scene);
    this._frame = this._frame.bind(this);
  }

  get on() { return this.mode !== 'off' && !!this.kind; }
  get voiceOn() { return this.mode === 'voice'; }
  get emoji() { return this.kind ? ANIMALS[this.kind].emoji : ''; }
  get name() { return this.kind ? ANIMALS[this.kind].name : ''; }
  get figure() { return this.figs.bySeat(SEAT); }
  /** 真的在畫面上(坐著 + 沒被藏 + 有位子) */
  get visible() { return this.on && !this.hidden && this.placed; }

  setMode(m) {
    if (!PET_MODES.includes(m)) return false;
    this.mode = m; savePetMode(m);
    this._syncVisible();
    return true;
  }

  /** 每局開始叫一次:換人就換動物;null 收起 */
  seat(kind) {
    if (kind !== this.kind) {
      this.kind = kind;
      if (!kind) this.figs.remove(SEAT);
      else {
        this.figs.setKind(SEAT, kind, { pos: { x: 0, y: 0, z: 0 }, lookAt: { x: 0, z: 10 }, scale: 1, dy: 0, legDrop: LEG_DROP });   // 正面朝 +z(相機那邊)
        if (this.tag) this.tag.textContent = `${this.emoji} ${this.name}`;
      }
    }
    this.figs.cancel(SEAT);
    this.thinkCount = 0; this.flipCount = 0; this.ended = false;
    this.chat.idleMs = 0; this.chat.said = 0;
    this._syncVisible();
    this._fitCamera();
  }

  /* ── 小窗:位子 / 大小由 app.js 給(頁面 px,相對 .board-card) ── */
  place({ left, top, width, height }) {
    const w = Math.max(48, Math.round(width)), h = Math.max(48, Math.round(height));
    this.win.style.left = `${Math.round(left)}px`;
    this.win.style.top = `${Math.round(top)}px`;
    if (w !== this.size.w || h !== this.size.h) {
      this.size = { w, h };
      this.win.style.width = `${w}px`;
      this.win.style.height = `${h}px`;
      this.renderer.setSize(w, h, false);
      this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this._fitCamera();
    }
    this.placed = true; this.hidden = false;
    this._syncVisible();
  }
  hide() { this.hidden = true; this._syncVisible(); }
  _syncVisible() {
    const show = this.visible;
    this.win.hidden = !show;
    this.figs.setVisible(this.on);
    this._syncLoop();
  }
  _syncLoop() {
    const run = this.visible && !document.hidden;
    if (run && !this._raf) { this._lastT = 0; this._raf = requestAnimationFrame(this._frame); }
    else if (!run && this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
  }
  /** 相機:固定俯角,距離二分法到 FRAME_POINTS 都在 ±0.95 */
  _fitCamera() {
    const cam = this.camera;
    const a = THREE.MathUtils.degToRad(PITCH_DEG);
    const dir = new THREE.Vector3(0, Math.sin(a), Math.cos(a));
    const target = new THREE.Vector3(0, LOOK_Y, 0);
    const inside = (d) => {
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateMatrixWorld(true);
      return FRAME_POINTS.every(([x, y, z]) => { const v = new THREE.Vector3(x, y, z).project(cam); return Math.abs(v.x) <= 0.95 && Math.abs(v.y) <= 0.95; });
    };
    let lo = 3, hi = 40;
    if (inside(lo)) { hi = lo; } else { for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (inside(mid)) hi = mid; else lo = mid; } }
    inside(hi);
    this.dist = hi;
  }

  /* ── 反應 / 人聲(同一個入口;沒動物 ⇒ 全部略過) ── */
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
  /** app.js 每次 render 告訴牠「現在是不是在等你」(閒聊計時只在這時走) */
  setWaiting(on) { const v = !!on; if (v !== this.waiting) { this.waiting = v; this.chat.idleMs = 0; this.chat.said = 0; } }
  /** 任何輸入 ⇒ 你在動,閒聊計時歸零 */
  noteInput() { this.chat.idleMs = 0; this.chat.said = 0; }

  /** 每幀(rAF):idle / 反應 / 閒聊 / 畫;同時每 ~250ms 叫 onTick 讓 app.js 重量棋盤投影框 */
  _frame(t) {
    this._raf = 0;
    if (!this.visible || document.hidden) return;
    const dt = this._lastT ? Math.min(0.05, Math.max(0, (t - this._lastT) / 1000)) : 0.016;
    this._lastT = t;
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
    this._tickAcc += dt;
    if (this._tickAcc >= 0.25) { this._tickAcc = 0; if (typeof this.onTick === 'function') { try { this.onTick(); } catch { /* 量不到就下次 */ } } }
    this._raf = requestAnimationFrame(this._frame);
  }
  /** 可以手動推時間(smoke 用):figs.update + 閒聊計時 */
  update(dt) {
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

  /** smoke 用:哪一隻、看不看得到、頭頂在不在小窗裡(NDC)、頭框(頁面 px)、小窗框 */
  probe() {
    const f = this.figure;
    const wr = this.win.getBoundingClientRect();
    const base = { kind: this.kind, on: this.on, mode: this.mode, hidden: this.hidden, placed: this.placed, visible: this.visible,
      win: { l: Math.round(wr.left), t: Math.round(wr.top), r: Math.round(wr.right), b: Math.round(wr.bottom), w: Math.round(wr.width), h: Math.round(wr.height) }, dist: this.dist ? +this.dist.toFixed(2) : null };
    if (!f) return { ...base, figure: false };
    const top = this.figs.headTop(SEAT).project(this.camera);
    const ctr = this.figs.headCenter(SEAT).project(this.camera);
    const px = (v) => ({ x: wr.left + (v.x + 1) / 2 * wr.width, y: wr.top + (1 - v.y) / 2 * wr.height });
    const c = px(ctr), tp = px(top), rad = Math.hypot(c.x - tp.x, c.y - tp.y);
    return {
      ...base, figure: true, groupVisible: f.group.visible,
      head: { x: +top.x.toFixed(3), y: +top.y.toFixed(3), inside: Math.abs(top.x) <= 1 && Math.abs(top.y) <= 1 },
      headBox: { l: Math.round(c.x - rad), t: Math.round(c.y - rad), r: Math.round(c.x + rad), b: Math.round(c.y + rad) },
    };
  }
}
