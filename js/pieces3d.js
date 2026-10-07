/* pieces3d.js — 雲臺暗棋的 3D 棋子 + 盤面標記(2026-09-29,v12 真 3D)
 *
 * 分層(skill board3d-kit「一 / 五」):底座 board3d.js 只管「一張會被點的立體棋盤」,這支只管棋子長相、動畫、標記、點中哪一枚。
 *   規則一個字都不在這裡;app.js 把「已公開的資訊」整理成 cells 丟進來,這支照畫。
 *
 * ★★ 暗子鐵則(規格 dark-3d-spec §1「渲染、輸入與規則契約」):
 *   - 暗子只收到 { hidden:true }:格位 + 「是暗子」,**沒有** side / type / 牌 id。mesh 名稱、userData、材質、貼圖、陰影
 *     全部跟底細無關(32 枚共用同一個背面材質),DevTools 看 scene 也讀不出來。
 *   - 翻面:規則先提交(app.js)→ 這支才拿到那一格的 { side, type, label };動畫前半段仍只畫通用背面,
 *     **越過中點(側立、正面看不到)那一刻**才建立 / 貼上真正的正面貼圖。0%、25%、49% 截圖都只會是背面。
 *   - 正面貼圖是「翻開時才畫」(lazy),不在開局預載 14 種 —— 預載本身不洩漏,但「什麼時候畫了哪一張」就是資訊。
 *   - 底面(朝桌面那面)與側面永遠是同一個素色木材質:低視角 / 換邊 / 重設都看不到任何東西。
 * ★ 漢字朝玩家:正面圓片在「spin」群組裡,每幀 rotation.y = 相機 yaw ⇒ 換邊 / 拖曳旋轉後字仍是正的、不鏡像
 *   (CircleGeometry 轉 -90° 後貼圖上方 = 世界 -Z = yaw 0 時畫面的上方;驗「傌 / 馬」這種不對稱字)。
 * ★ 命中:pickCell 只打平面;但棋子有厚度,低視角時棋頂會投影到後一格的位置上 ⇒ 先對「最多 32 枚棋子的圓柱」做解析式
 *   射線相交(不是 intersectObjects 遍歷整個場景,skill 坑 ⑥),打到就是那一枚;沒打到才退回盤面平面。
 * ★ mesh.visible 一律給嚴格 boolean(3d-game-kit 0827 通則:undefined/null 會被當成 true)。
 */
import * as THREE from "./three-full.js";

const SIDE_INK = { red: "#b3261e", black: "#1f1f1f" };
const FACE_BG = "#f3e2bd";
const MARK_Y = 0.004;

/** 產一張圓形貼圖(背面 / 正面共用畫法);只在需要時才畫 */
function discTexture(draw, maxAniso) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 256;
  const cx = cv.getContext("2d");
  cx.fillStyle = FACE_BG;
  cx.beginPath(); cx.arc(128, 128, 127, 0, Math.PI * 2); cx.fill();
  draw(cx);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = maxAniso || 1;
  if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
  tex.needsUpdate = true;
  return tex;
}

function backTexture(maxAniso) {
  // 32 枚暗子共用這一張:雙圈 + 雲紋,**不帶任何紅黑或棋種**
  return discTexture((cx) => {
    cx.strokeStyle = "#8a6a3a"; cx.lineWidth = 10;
    cx.beginPath(); cx.arc(128, 128, 104, 0, Math.PI * 2); cx.stroke();
    cx.lineWidth = 4;
    cx.beginPath(); cx.arc(128, 128, 84, 0, Math.PI * 2); cx.stroke();
    cx.fillStyle = "rgba(96,66,30,0.8)";
    cx.font = '700 92px "Microsoft JhengHei","PingFang TC","Noto Sans TC",serif';
    cx.textAlign = "center"; cx.textBaseline = "middle";
    cx.fillText("暗", 128, 134);
  }, maxAniso);
}

function faceTexture(side, label, maxAniso) {
  return discTexture((cx) => {
    const ink = SIDE_INK[side] || "#333";
    cx.strokeStyle = ink; cx.lineWidth = 9;
    cx.beginPath(); cx.arc(128, 128, 104, 0, Math.PI * 2); cx.stroke();
    cx.lineWidth = 3;
    cx.beginPath(); cx.arc(128, 128, 90, 0, Math.PI * 2); cx.stroke();
    cx.fillStyle = ink;
    cx.font = '900 118px "Microsoft JhengHei","PingFang TC","Noto Sans TC","DFKai-SB",serif';
    cx.textAlign = "center"; cx.textBaseline = "middle";
    cx.fillText(label, 128, 136);
  }, maxAniso);
}

function textTexture(text, color, bg) {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const cx = cv.getContext("2d");
  if (bg) { cx.fillStyle = bg; cx.beginPath(); cx.arc(64, 64, 58, 0, Math.PI * 2); cx.fill(); }
  cx.fillStyle = color;
  cx.font = '900 70px "Microsoft JhengHei","PingFang TC","Segoe UI Emoji",sans-serif';
  cx.textAlign = "center"; cx.textBaseline = "middle";
  cx.fillText(text, 64, 70);
  const tex = new THREE.CanvasTexture(cv);
  if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
  return tex;
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class PieceSet {
  /**
   * @param board Board3D(cell 模式,4×8)
   * @param opts { reduced:boolean }  prefers-reduced-motion ⇒ 動畫 ≤ 50ms
   */
  constructor(board, opts = {}) {
    this.board = board;
    this.reduced = Boolean(opts.reduced);
    const p = board.opt.pitch;
    this.R = p * 0.43;
    this.H = p * 0.17;
    this.root = new THREE.Group();
    this.root.name = "pieces";
    board.pieceLayer.add(this.root);
    this.markRoot = new THREE.Group();
    this.markRoot.name = "marks";
    board.pieceLayer.add(this.markRoot);

    const aniso = board.maxAniso;
    this._aniso = aniso;
    this.geo = new THREE.CylinderGeometry(this.R, this.R * 1.03, this.H, 44);
    this.faceGeo = new THREE.CircleGeometry(this.R * 0.95, 44);
    this.wood = new THREE.MeshStandardMaterial({ color: 0xe6cf9f, roughness: 0.55, metalness: 0.02 });
    this.backMat = new THREE.MeshStandardMaterial({ map: backTexture(aniso), roughness: 0.5 });
    this.faceMats = new Map();        // "red:帥" → material(翻開時才建)
    this.items = new Map();           // key → item;暗子 key = "h<格>",明子 key = "p<牌id>"
    this.anims = [];                  // { item, t, dur, step(e,t), done() }
    this._yaw = null;
    this._gen = 0;

    this._ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._mk = this._buildMarkMaterials();
    this.marks = { selected: null, targets: [], last: [], hint: [], focus: null };
  }

  /* ── 建一枚:group(位置)→ spin(跟相機 yaw,字朝玩家)→ pivot(翻面軸)→ body + face ── */
  _make(key, index, hidden) {
    const group = new THREE.Group();
    const spin = new THREE.Group();
    const pivot = new THREE.Group();
    pivot.position.y = this.H / 2;
    const body = new THREE.Mesh(this.geo, this.wood);
    const face = new THREE.Mesh(this.faceGeo, this.backMat);
    face.rotation.x = -Math.PI / 2;
    face.position.y = this.H / 2 + 0.0015;
    /* ★ v13:底面也放一片圓片(平時隱藏、素色木)。翻面時正面貼在**這一片**上,跟著 pivot 從底下一路轉上來(0 → 180°),
       不再是「轉到 90° 把頂面換貼圖、角度跳回 -90°」—— 那一跳會讓站著的「暗」字圓片在側立那一幀憑空消失、露出木頭頂蓋,
       每翻一枚都閃一下。播完才把正面搬回頂面那片、這片藏回去(180° 跟歸零兩個姿勢畫面完全相同,看不出切換)。 */
    const under = new THREE.Mesh(this.faceGeo, this.wood);
    under.rotation.x = Math.PI / 2;
    under.position.y = -this.H / 2 - 0.0015;
    under.visible = false;
    pivot.add(body, face, under);
    spin.add(pivot);
    group.add(spin);
    // ★ 名稱只寫格位 / 牌位種類,暗子**不寫**任何底細;userData 保持空物件
    group.name = hidden ? "piece-hidden" : "piece";
    const w = this.board.cellToWorld(Math.floor(index / 4), index % 4);
    group.position.set(w.x, 0, w.z);
    this.root.add(group);
    const item = { key, index, hidden, group, spin, pivot, face, under, faceKind: "back", lift: 0, removing: false };
    this.items.set(key, item);
    return item;
  }

  _faceMat(side, label) {
    const k = `${side}:${label}`;
    let m = this.faceMats.get(k);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ map: faceTexture(side, label, this._aniso), roughness: 0.5 });
      this.faceMats.set(k, m);
    }
    return m;
  }

  _showFace(item, cell, viaUnder = false) {
    const mat = this._faceMat(cell.side, cell.label);
    if (viaUnder) { item.under.material = mat; item.under.visible = true; }   // 翻面中:正面先貼在底面那片(這一刻它正背對相機)
    else item.face.material = mat;
    item.faceKind = "face";
    item.hidden = false;
    item.group.name = "piece";
  }

  /** 翻面播完:正面搬回頂面那片、底面那片藏回素色、角度歸零(跟轉到 180° 的畫面一模一樣,所以看不出切換) */
  _settleFace(item, cell) {
    item.pivot.rotation.x = 0;
    item.face.material = this._faceMat(cell.side, cell.label);
    item.under.visible = false;
    item.under.material = this.wood;
    item.faceKind = "face";
    item.hidden = false;
    item.group.name = "piece";
  }

  _place(item, index) {
    item.index = index;
    const w = this.board.cellToWorld(Math.floor(index / 4), index % 4);
    item.group.position.x = w.x;
    item.group.position.z = w.z;
  }

  _remove(item) {
    this.root.remove(item.group);
    this.items.delete(item.key);
  }

  /** 新局 / 平面退路回來:全部丟掉、照 cells 直接重建(不播任何動畫,不補播上一局) */
  reset(cells) {
    this._gen += 1;
    for (const a of this.anims) a.cancelled = true;
    this.anims = [];
    for (const it of [...this.items.values()]) this._remove(it);
    cells.forEach((cell, index) => {
      if (!cell) return;
      if (cell.hidden) this._make(`h${index}`, index, true);
      else { const it = this._make(`p${cell.id}`, index, false); this._showFace(it, cell); }
    });
    this._yaw = null;
  }

  get busy() { return this.anims.length > 0; }

  _dur(ms) { return this.reduced ? Math.min(40, ms) : ms; }

  _animate(item, ms, step, done) {
    return new Promise((resolve) => {
      const a = { item, t: 0, dur: Math.max(1, this._dur(ms)) / 1000, step, done, resolve, cancelled: false };
      this.anims.push(a);
    });
  }

  /**
   * 照最新公開局面更新;action = 剛提交的那一手(用來挑動畫),沒有就瞬間對齊。
   * 回傳 Promise:動畫全部播完才 resolve(app.js 等它才開下一手 / 才讓 AI 走)。
   * @param cells 32 格:null | {hidden:true} | {id, side, type, label}
   * @param action {type:'flip',index} | {type:'move'|'capture',from,to} | null
   */
  sync(cells, action) {
    const gen = this._gen;
    const jobs = [];
    const wanted = new Map();
    cells.forEach((cell, index) => {
      if (!cell) return;
      wanted.set(cell.hidden ? `h${index}` : `p${cell.id}`, { cell, index });
    });

    // ① 翻面:那一格原本是暗子 h<i>,現在變成明子 p<id>
    if (action && action.type === "flip") {
      const hid = this.items.get(`h${action.index}`);
      const cell = cells[action.index];
      if (hid && cell && !cell.hidden) {
        this.items.delete(hid.key);
        hid.key = `p${cell.id}`;
        this.items.set(hid.key, hid);
        let swapped = false;
        jobs.push(this._animate(hid, 320, (e, t) => {
          if (gen !== this._gen) return;
          hid.lift = Math.sin(Math.PI * t) * this.H * 2.6;
          hid.pivot.rotation.x = Math.PI * e;                          // 0 → 180° 一路轉過去(緩入緩出),中途不跳角度
          if (t >= 0.5 && !swapped) { swapped = true; this._showFace(hid, cell, true); }   // ★ 側立那一刻才把正面貼到底面那片(它正背對相機)
        }, () => { this._settleFace(hid, cell); hid.lift = 0; }));
      }
    }

    // ② 吃子:被吃的那枚沉下去縮小後移除
    if (action && action.type === "capture") {
      for (const it of this.items.values()) {
        if (it.index === action.to && !it.removing && !wanted.has(it.key)) {
          it.removing = true;
          jobs.push(this._animate(it, 300, (e) => {
            const s = 1 - e * 0.9;
            it.group.scale.set(s, s, s);
            it.lift = -e * this.H * 0.8;
          }, () => this._remove(it)));
        }
      }
    }

    // ③ 走 / 吃:明子從 from 滑到 to(小弧線)
    for (const [key, { cell, index }] of wanted) {
      const it = this.items.get(key);
      if (!it) {
        const n = this._make(key, index, Boolean(cell.hidden));
        if (!cell.hidden) this._showFace(n, cell);
        continue;
      }
      if (it.index !== index) {
        const from = this.board.cellToWorld(Math.floor(it.index / 4), it.index % 4);
        const to = this.board.cellToWorld(Math.floor(index / 4), index % 4);
        it.index = index;
        jobs.push(this._animate(it, 280, (e, t) => {
          it.group.position.x = from.x + (to.x - from.x) * e;
          it.group.position.z = from.z + (to.z - from.z) * e;
          it.lift = Math.sin(Math.PI * t) * this.H * 1.6;
        }, () => { this._place(it, index); it.lift = 0; }));
      }
      if (!cell.hidden && it.faceKind !== "face" && !(action && action.type === "flip" && action.index === index)) this._showFace(it, cell);
    }

    // ④ 不該在的(沒有動畫的情況:例如退路 / 重畫)直接移除
    for (const it of [...this.items.values()]) {
      if (!wanted.has(it.key) && !it.removing) this._remove(it);
    }
    return Promise.all(jobs);
  }

  /** 盤面標記:選取 / 走 / 吃 / 上一手 / 💡 提示 / 鍵盤焦點。每次 render 重畫(≤ 40 個小 mesh,便宜) */
  setMarks(m) {
    const next = { selected: null, targets: [], last: [], hint: [], focus: null, ...m };
    const sig = JSON.stringify(next);
    if (sig === this._marksSig) return;   // ★ v13:同一組標記不重建(一手翻棋的 render 鏈會叫到 ~10 次,真的變的只有 1~2 次)
    this._marksSig = sig;
    this.marks = next;
    const g = this.markRoot;
    while (g.children.length) g.remove(g.children[0]);
    const at = (index) => this.board.cellToWorld(Math.floor(index / 4), index % 4);
    const add = (mesh, index, y = MARK_Y) => { const w = at(index); mesh.position.set(w.x, y, w.z); g.add(mesh); return mesh; };
    const flat = (geo, mat) => { const x = new THREE.Mesh(geo, mat); x.rotation.x = -Math.PI / 2; return x; };
    const p = this.board.opt.pitch;
    for (const i of this.marks.last) add(flat(this._mk.lastGeo, this._mk.last), i, MARK_Y * 0.5);
    for (const t of this.marks.targets) {
      if (t.type === "capture") {
        add(flat(this._mk.capGeo, this._mk.cap), t.to);
        this._badge(this._sprite(this._mk.capTex, p * 0.4), t.to);
      } else {
        add(flat(this._mk.moveGeo, this._mk.move), t.to);
        const d = add(flat(this._mk.textGeo, this._mk.moveText), t.to, MARK_Y * 1.5);
        d.userData.faceYaw = true;
      }
    }
    for (const i of this.marks.hint) {
      add(flat(this._mk.hintGeo, this._mk.hint), i, MARK_Y * 1.2);
      this._badge(this._sprite(this._mk.hintTex, p * 0.4), i);
    }
    if (this.marks.selected != null) add(flat(this._mk.selGeo, this._mk.sel), this.marks.selected, MARK_Y * 1.4);
    if (this.marks.focus != null) add(flat(this._mk.focusGeo, this._mk.focus), this.marks.focus, MARK_Y * 1.6);
    this._yaw = null;   // 讓字重新對齊相機
  }

  /** 「吃」/ 💡 小徽章:放在那一格「相機看過去的右上角」,不壓在棋子字上;相機一轉就跟著挪(update 裡) */
  _badge(sprite, index) {
    sprite.userData.badgeAt = index;
    this.markRoot.add(sprite);
    this._placeBadge(sprite, THREE.MathUtils.degToRad(this.board.yaw || 0));
  }
  _placeBadge(sprite, yaw) {
    const i = sprite.userData.badgeAt;
    const w = this.board.cellToWorld(Math.floor(i / 4), i % 4);
    const k = this.R * 0.78;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);      // 畫面右方(世界)
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);     // 畫面上方 = 遠離相機
    sprite.position.set(w.x + (rx + fx) * k, this.H * 2.2, w.z + (rz + fz) * k);
  }

  _sprite(tex, size) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set(size, size, 1);
    s.renderOrder = 10;
    return s;
  }

  _buildMarkMaterials() {
    const p = this.board.opt.pitch, R = this.R;
    const basic = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false });
    const halfSq = p * 0.47;
    const sq = new THREE.RingGeometry(halfSq * 0.9, halfSq, 4, 1, Math.PI / 4);
    return {
      lastGeo: sq, last: basic(0x5fb3ff, 0.75),
      moveGeo: new THREE.CircleGeometry(R * 0.72, 32), move: basic(0x3ecf6e, 0.35),
      textGeo: new THREE.PlaneGeometry(R * 1.0, R * 1.0),
      moveText: new THREE.MeshBasicMaterial({ map: textTexture("走", "#0d5a2a"), transparent: true, depthWrite: false }),
      capGeo: new THREE.RingGeometry(R * 1.06, R * 1.3, 40), cap: basic(0xe53935, 0.95),
      capTex: textTexture("吃", "#ffffff", "#c62828"),
      hintGeo: new THREE.RingGeometry(R * 1.1, R * 1.42, 40), hint: basic(0x9c4dff, 0.95),
      hintTex: textTexture("💡", "#ffffff", "rgba(124,58,237,0.92)"),
      selGeo: new THREE.RingGeometry(R * 1.04, R * 1.24, 40), sel: basic(0xffc93c, 1),
      focusGeo: new THREE.RingGeometry(R * 1.3, R * 1.4, 40), focus: basic(0xffffff, 0.95),
    };
  }

  /** 每幀:推動畫、把字轉向相機、選取的那枚浮起來一點 */
  update(dt) {
    if (this.anims.length) {
      const still = [];
      for (const a of this.anims) {
        if (a.cancelled) { a.resolve(); continue; }
        a.t = Math.min(1, a.t + dt / a.dur);
        a.step(easeInOut(a.t), a.t);
        if (a.t >= 1) { try { a.done && a.done(); } finally { a.resolve(); } }
        else still.push(a);
      }
      this.anims = still;
    }
    const yaw = THREE.MathUtils.degToRad(this.board.yaw || 0);
    if (yaw !== this._yaw) {
      this._yaw = yaw;
      for (const it of this.items.values()) it.spin.rotation.y = yaw;
      for (const m of this.markRoot.children) {
        if (m.userData.faceYaw) m.rotation.z = yaw;
        if (m.userData.badgeAt != null) this._placeBadge(m, yaw);
      }
    }
    const sel = this.marks.selected;
    for (const it of this.items.values()) {
      const target = (sel === it.index && !it.removing) ? this.H * 0.55 : 0;
      const base = it._baseLift == null ? 0 : it._baseLift;
      it._baseLift = base + (target - base) * Math.min(1, dt * 14);
      it.group.position.y = it._baseLift + it.lift;
    }
  }

  /**
   * 螢幕座標 → 格。先打棋子圓柱(最多 32 枚,解析式,最近的那枚贏),沒打到才打盤面平面。
   * 盤外木框 / 背景 / 動物一律 null。
   */
  pick(clientX, clientY) {
    const cam = this.board.camera;
    const rect = this.board.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this._ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this._ray.setFromCamera(this._ndc, cam);
    const o = this._ray.ray.origin, d = this._ray.ray.direction;
    let bestT = Infinity, best = null;
    const R = this.R, R2 = R * R;
    for (const it of this.items.values()) {
      if (it.removing) continue;
      const cx = it.group.position.x, cz = it.group.position.z;
      const y0 = it.group.position.y, y1 = y0 + this.H;
      // 頂面
      if (Math.abs(d.y) > 1e-6) {
        const t = (y1 - o.y) / d.y;
        if (t > 0 && t < bestT) {
          const x = o.x + d.x * t - cx, z = o.z + d.z * t - cz;
          if (x * x + z * z <= R2) { bestT = t; best = it.index; }
        }
      }
      // 側面(無限圓柱 ∩ y 範圍)
      const ox = o.x - cx, oz = o.z - cz;
      const a = d.x * d.x + d.z * d.z;
      if (a > 1e-9) {
        const b = 2 * (ox * d.x + oz * d.z);
        const c = ox * ox + oz * oz - R2;
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
          const t = (-b - Math.sqrt(disc)) / (2 * a);
          if (t > 0 && t < bestT) {
            const y = o.y + d.y * t;
            if (y >= y0 && y <= y1) { bestT = t; best = it.index; }
          }
        }
      }
    }
    if (best != null) return best;
    const hit = this.board.pickCell(clientX, clientY);
    return hit ? hit.idx : null;
  }

  /** 棋子頂面中心的螢幕座標(測試「點棋子」用;空格回 null) */
  pieceTopToScreen(index) {
    const it = [...this.items.values()].find((x) => x.index === index && !x.removing);
    if (!it) return null;
    const v = new THREE.Vector3(it.group.position.x, it.group.position.y + this.H, it.group.position.z).project(this.board.camera);
    const rect = this.board.canvas.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** 測試探針:每一枚的格位、是不是暗子、正面貼的是哪一種(back/face)、名稱與 userData 鍵(驗暗子不洩漏) */
  probe() {
    const list = [];
    for (const it of this.items.values()) {
      list.push({
        index: it.index, hidden: it.hidden, faceKind: it.faceKind, removing: it.removing,
        name: it.group.name, userDataKeys: Object.keys(it.group.userData).concat(Object.keys(it.face.userData)),
        backShared: it.face.material === this.backMat, spinY: +it.spin.rotation.y.toFixed(4),
      });
    }
    list.sort((a, b) => a.index - b.index);
    return { pieces: list, anims: this.anims.length, faceMats: this.faceMats.size, marks: this.markRoot.children.length, underVisible: [...this.items.values()].filter((it) => it.under.visible === true).length };
  }

  dispose() {
    for (const a of this.anims) a.cancelled = true;
    this.anims = [];
    this.board.pieceLayer.remove(this.root, this.markRoot);
  }
}
