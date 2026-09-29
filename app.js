/* 規則 + 搜尋住在 banqi-core.js(v12 抽出;主執行緒 / ai-worker.js / node 測試共用同一份)。index.html 先載它再載 app.js。 */
const {
  BOARD_COLS,
  BOARD_ROWS,
  BOARD_SIZE,
  WIN_SCORE,
  SIDE_LABEL,
  SIDE_CHAR,
  OPPOSITE,
  PIECE_TYPES,
  PIECE_META,
  AI_LEVELS,
  HINT_LEVEL,
  HINT_QUIESCE_DEPTH,
  HINT_TRADE_MARGIN,
  applyActualAction,
  detectWinner,
  chooseAiAction,
  chooseHintAction,
  revealedMaterial,
  materialQuiesce,
  captureGain,
  quiesceCaptures,
  minimax,
  orderActionsForSearch,
  quickActionBonus,
  estimateFlipChoice,
  countLineScreens,
  evaluateState,
  visibleCapturePressure,
  getVisibleActions,
  isThreatened,
  cloneState,
  applySearchAction,
  getLegalActions,
  getPieceActions,
  canCapture,
  getAdjacentIndexes,
  step,
  indexToCoord,
  coordToIndex,
  getLivePieces,
  pieceLabelFor,
  getPieceAt: coreGetPieceAt,
} = window.BanqiCore;
/** 預設讀目前這一局(core 版不帶預設,因為 core 沒有全域 state) */
function getPieceAt(index, targetState = state) {
  return coreGetPieceAt(index, targetState);
}

const SETTINGS_KEY = "cloud-banqi-settings-v1";
const MENU_FOLD_KEY = "cloud-banqi-menu-folded-v1";   // ▼ 收起選單的記憶(獨立一鍵,不混進 settings 的形狀;bootstrap 會讀 ⇒ 必須宣告在檔案前段,躲 TDZ)
// fit-play(v9)的 media query 與 MENU_FOLD_KEY 同理:bootstrap() 在檔案前段就跑 ⇒ 這兩個 const 必須宣告在它之前,否則 TDZ(0914 第一版就炸在這)
const FIT_PLAY_QUERY = "(orientation: landscape) and (max-height: 500px)";
const fitPlayMedia = typeof matchMedia === "function" ? matchMedia(FIT_PLAY_QUERY) : null;
const DEFAULT_VIEW = {
  tilt: 44,
  spin: -10,
};



const elements = {
  board: document.querySelector("#board"),
  boardStage: document.querySelector("#boardStage"),
  newGameButton: document.querySelector("#newGameButton"),
  hintButton: document.querySelector("#hintButton"),
  installButton: document.querySelector("#installButton"),
  modeSelect: document.querySelector("#modeSelect"),
  difficultySelect: document.querySelector("#difficultySelect"),
  perspectiveButton: document.querySelector("#perspectiveButton"),
  resetViewButton: document.querySelector("#resetViewButton"),
  statusTurn: document.querySelector("#statusTurn"),
  statusMessage: document.querySelector("#statusMessage"),
  statusSide: document.querySelector("#statusSide"),
  statusCounts: document.querySelector("#statusCounts"),
  installHint: document.querySelector("#installHint"),
  captureSummary: document.querySelector("#captureSummary"),
  poolSummary: document.querySelector("#poolSummary"),
  boardHelp: document.querySelector("#boardHelp"),
  menuFoldButton: document.querySelector("#menuFoldButton"),   // ▼ 收起選單 / ▲ 展開選單(狀態卡那一行)
};

/* 📱 內建瀏覽器偵測(守門 #30):教會連結走 LINE 發,LINE 的 WebView 裝不了 APP
   (beforeinstallprompt 永遠不觸發)——開場就講「換瀏覽器」,別讓人按一顆沒反應的鈕。
   只提醒不擋:遊戲本身在 WebView 裡照樣能玩。
   ⚠ 位置有意義:`const` 有 TDZ,而 bootstrap() 一開場就會呼叫 updateInstallHint()
     讀它 ⇒ 宣告必須在 bootstrap() 之前跑到,不能塞到檔案後半(放後面實測整支 app.js
     當場拋 "Cannot access before initialization",全站白畫面)。 */
const IN_APP_BROWSER = (() => {
  const ua = navigator.userAgent || "";
  if (/\bLine\//i.test(ua) || /\bLIFF\b/i.test(ua)) return { n: "LINE", m: "右上角「⋯」→「用其他瀏覽器開啟」" };
  if (/FBAN|FBAV|FB_IAB|FB4A/i.test(ua)) return { n: "Facebook", m: "右上角「⋯」→「在外部瀏覽器中開啟」" };
  if (/Instagram/i.test(ua)) return { n: "Instagram", m: "右上角「⋯」→「在瀏覽器中開啟」" };
  if (/MicroMessenger/i.test(ua)) return { n: "微信", m: "右上角「⋯」→「在瀏覽器中開啟」" };
  return null;
})();

let state = createInitialState(loadSettings());
/* 🐾 動物對手(0928,skill animal-opponent-kit):引擎 js/animals.js 是 ES module,經 index.html 的 PetKit 橋接進來;
   pet 在 initPet() 才建(橋接還沒好就等 pet-kit-ready)。⚠ 跟 MENU_FOLD_KEY 同理:宣告要在 bootstrap() 之前(TDZ)。 */
let pet = null;
const dragState = {
  active: false,
  moved: false,
  pointerId: null,
  pointerCaptured: false,
  startX: 0,
  startY: 0,
  startSpin: DEFAULT_VIEW.spin,
  startTilt: DEFAULT_VIEW.tilt,
  startCellIndex: null,
  suppressClickUntil: 0,
};
const viewRefs = {
  boardCells: [],
  boardUi: null,
  captureCards: {},
  poolCards: {},
};

bootstrap();

// 測試掛勾(驗收腳本用;艦隊慣例)——真人操作不經過它
window.__banqi = {
  get state() { return state; },
  startDailyGame,
  startNewGame,
  handleCellClick,
  createInitialState,
  getLegalActions,   // 💡 冒煙要用它驗「提示那一手真的合法」
  /* 💡 提示品質驗收(test/hint.mjs)用:裁判要能自己走一遍吃子鏈,才算得上獨立。
     ⚠ 這個物件在檔案第 169 行就求值,而 HINT_LEVEL / HINT_TRADE_MARGIN 是後面才宣告的 const ——
       直接寫 `HINT_LEVEL,` 會踩 TDZ、整支 app.js 當場拋 ReferenceError(2026-09-07 實際踩過一次:
       症狀是 window.__banqi 根本不存在、畫面全白)。一律用 getter 延後求值。 */
  chooseHintAction,
  chooseAiAction,      // A/B 對照用:比較「舊提示路徑」與 chooseHintAction 的品質差
  cloneState,
  applySearchAction,
  applyActualAction,
  getPieceAt,
  get PIECE_META() { return PIECE_META; },
  get HINT_LEVEL() { return HINT_LEVEL; },
  get HINT_TRADE_MARGIN() { return HINT_TRADE_MARGIN; },
  applyMenuFold,     // ▼ 收起選單(scripts/check-fold.mjs 只讀狀態、用真點擊切換;這把手留給診斷)
  get menuFolded() { return document.body.classList.contains("menu-folded"); },
  get pet() { return pet; },   // 🐾 動物對手(browser-check 🐾 段用;沒橋接成功就是 null)
};

/* ═══════════ 🐾 動物對手(2026-09-28,skill animal-opponent-kit;正本 majiang3d、範本 gomoku3d、老站範式 3D-Xiangqi)═══════════
   本站棋盤是 CSS 斜視(DOM + rotateX),沒有 three 場景 ⇒ 牠住在 .board-card 裡一個透明的 WebGL 小窗(#petWindow,js/opponent.js),
   petLayout() 量棋盤投影框(getBoundingClientRect 含 rotateX/rotateZ/透視)把小窗貼在**遠端那條邊上方、置中**,pointer-events:none。
   一般版面:卡片頂端多留 --pet-reserve 讓位(styles.css);fit-play 版面:fitBoard() 從可用高度扣 petReserve()(卡片矮於 480 就藏,不縮棋盤)。
   反應跟 AI 流程同一個分岔:AI 開算 think / 翻到自己的子 hop(對方的 shrug)/ 吃你的子 hop+「吃掉了」/ 走位 place / 你吃牠的子 gasp+「哇」/
   一局結束 win・lose(每局一次);等你太久閒聊。純觀感:不碰規則、不碰 AI、不擋點擊。 */
function initPet() {
  const build = () => {
    const PK = window.PetKit;
    const win = document.querySelector("#petWindow");
    if (!PK || !win || pet) return;
    try {
      const voice = PK.createVoice({ muted: () => false });   // 這站沒有 🔊 音效開關 ⇒ 只看 🐾 三段
      pet = new PK.Opponent(win, voice);
    } catch (error) {
      console.warn("🐾 動物對手建不起來(沒 WebGL?),棋照下", error);
      return;
    }
    pet.onTick = petLayout;   // 每 ~250ms 重量棋盤投影框(拖曳旋轉 / 過渡動畫時小窗要跟著)
    document.querySelectorAll("#petControls [data-pet]").forEach((button) => {
      button.addEventListener("click", () => { pet.setMode(button.dataset.pet); syncPet(); renderStatus(); });
    });
    document.addEventListener("pointerdown", () => pet.noteInput(), true);
    document.addEventListener("keydown", () => pet.noteInput(), true);
    window.addEventListener("resize", () => requestAnimationFrame(petLayout));
    seatPet();
  };
  if (window.PetKit) build();
  else window.addEventListener("pet-kit-ready", build, { once: true });
}
/** 每局開始 / 換難度:誰坐由模式 + 難度 + 每日決定(雙人同機不坐、每日 = 🦉) */
function seatPet() {
  if (!pet || !window.PetKit) return;
  pet.seat(window.PetKit.animalFor(state.mode, state.difficulty, Boolean(state.dailyKey)));
  syncPet();
  renderStatus();
}
/** 每次 render:告訴牠是不是在等你、三段鈕亮哪顆、body.pet-on、重擺小窗 */
function syncPet() {
  if (!pet) return;
  const waiting = state.mode === "ai" && !state.winner && !state.aiThinking
    && (state.turnSide === null || state.turnSide === state.humanSide);
  pet.setWaiting(waiting);
  document.querySelectorAll("#petControls [data-pet]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.pet === pet.mode));
  });
  document.body.classList.toggle("pet-on", pet.on);
  petLayout();
}
/** fit-play 時從 .board-card 頂端留給小窗的高度(px);卡片矮於 480 就 0(藏起來、棋盤不縮) */
function petReserve() {
  if (!pet || !pet.on || !fitPlayActive()) return 0;
  const wrap = document.querySelector(".board-card");
  if (!wrap || wrap.clientHeight < 480) return 0;
  return Math.round(clamp(wrap.clientHeight * 0.2, 90, 170));
}
/** 把小窗貼在棋盤投影框的遠端那條邊上方、置中(頁面 px → 相對 .board-card) */
function petLayout() {
  if (!pet) return;
  const wrap = document.querySelector(".board-card");
  if (!wrap) return;
  if (!pet.on) { wrap.style.setProperty("--pet-reserve", "0px"); pet.hide(); return; }
  const OVERLAP = 8;   // 凳子壓到棋盤木框 8px(木框 ≥ 10px、格子在更裡面),看起來是坐在桌邊,不蓋任何格子
  let petW, petH;
  if (fitPlayActive()) {
    const reserve = petReserve();
    if (!reserve) { pet.hide(); return; }
    petH = reserve - 2 + OVERLAP;
    petW = Math.round(petH / 1.25);
  } else {
    const bw = elements.board.getBoundingClientRect().width;
    if (!bw) { pet.hide(); return; }
    petW = clamp(Math.round(bw * 0.28), 96, 200);
    petH = Math.round(petW * 1.25);
    wrap.style.setProperty("--pet-reserve", `${petH - OVERLAP + 2}px`);   // 設完馬上重量:padding 沒有 transition,同步就生效
  }
  const b = elements.board.getBoundingClientRect();
  const wr = wrap.getBoundingClientRect();
  if (!b.width || !wr.width) { pet.hide(); return; }
  /* 小窗的底:壓到木框 OVERLAP px 可以,但**不可以壓到任何一格**(遠端那排格子的投影框最高點再往上 2px;
     直向手機木框只有 ~10px、格子的投影框會貼到木框邊,只看木框會蓋到半格 —— browser-check 🐾 抓到的)。 */
  let cellsTop = Infinity;
  for (const cell of elements.board.querySelectorAll(".cell")) { const r = cell.getBoundingClientRect(); if (r.width && r.top < cellsTop) cellsTop = r.top; }
  const bottom = Math.min(b.top + OVERLAP, Number.isFinite(cellsTop) ? cellsTop - 2 : Infinity);
  const left = (b.left + b.width / 2) - wr.left - petW / 2;
  const top = bottom - wr.top - petH;
  pet.place({ left, top: Math.max(0, top), width: petW, height: petH });
}
/** 牠走完一手(runAiTurn):翻 / 吃 / 走位各自的反應 */
function petAfterAiAction(action) {
  if (!pet || !pet.kind || !action) return;
  if (action.type === "flip") {
    const piece = getPieceAt(action.index);
    pet.flipped(Boolean(piece) && piece.side === state.aiSide);
  } else if (action.type === "capture") {
    pet.react("hop", "capture");
  } else {
    pet.react("place", null);
  }
}
/** 一局分出結果(finalizeAfterAction / runAiTurn 無合法手):牠贏了跳、輸了低頭,每局一次 */
function petEndGame() {
  if (!pet || !pet.kind || !state.winner) return;
  pet.endGame(state.mode === "ai" && state.winner === state.aiSide);
}

function bootstrap() {
  applyMenuFold(loadMenuFolded());   // ▼ 上次收起的就先收起來再畫,第一幀就對、不閃
  fillDifficultyOptions();
  bindEvents();
  ensureBoardCells();
  ensureSummaryCards();
  syncControls();
  render({ fullBoard: true });
  bindFitPlay();   // ⛶ fit-play(v9):要在第一次 render 之後接,棋盤格子都在了才量得到投影框
  initPet();       // 🐾 動物對手(0928):橋接好了就坐下;沒橋接(舊瀏覽器)= 沒動物,棋照下
  updateInstallHint();
  registerServiceWorker();
  /* 🔗 ?daily 深連結(0906,信友火花「今日挑戰」卡直達):等於代按「📅 每日同副牌」(daily.js 在 app.js 之前載,window.BanqiDaily 已在)。 */
  if (/[?&]daily(?:=|&|$)/.test(location.search)) startDailyGame();
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch (error) {
    return {};
  }
}

function saveSettings() {
  const payload = {
    mode: state.mode,
    difficulty: state.difficulty,
    perspective: state.perspective,
    viewSpin: state.view.spin,
    viewTilt: state.view.tilt,
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
}

/* ▼ 收起選單(menu-fold v1,2026-09-14)——下棋中把棋盤旁的三張面板(戰況/暗子資訊/規則摘要)、
   操作方式卡與標題副標收起來,棋盤拿回整排寬度;再按一次展開。藏什麼、棋盤放多大,全在 styles.css
   的 body.menu-folded 規則裡,這裡只切 class + 對 aria + 記 localStorage。
   讀寫都包 try/catch:Safari 私密模式 / 被擋 storage 時記不住就算了,絕不能炸遊戲。
   棋盤尺寸是純 CSS 算的(width: min(vw, rem)),切換不需 JS 重算;仍補一發 resize 給日後任何聽 resize 的東西。 */
function loadMenuFolded() {
  try {
    return localStorage.getItem(MENU_FOLD_KEY) === "1";
  } catch (error) {
    return false;
  }
}

function saveMenuFolded(folded) {
  try {
    localStorage.setItem(MENU_FOLD_KEY, folded ? "1" : "0");
  } catch (error) {
    // 記不住就記不住,這一局照樣能收
  }
}

function applyMenuFold(folded, options = {}) {
  const isFolded = Boolean(folded);
  document.body.classList.toggle("menu-folded", isFolded);
  const button = elements.menuFoldButton;
  if (button) {
    button.setAttribute("aria-expanded", String(!isFolded));
    button.textContent = isFolded ? "▲ 展開選單" : "▼ 收起選單";
    button.title = isFolded ? "把戰況、暗子資訊、規則摘要展開回來" : "收起棋盤旁的面板,棋盤拿到更多空間";
  }
  if (options.persist) {
    saveMenuFolded(isFolded);
  }
  requestAnimationFrame(() => {
    try {
      window.dispatchEvent(new Event("resize"));
    } catch (error) {
      // 沒人聽也無妨
    }
  });
}

function createInitialState(settings = {}) {
  const pieces = [];

  for (const side of ["red", "black"]) {
    for (const definition of PIECE_TYPES) {
      for (let index = 0; index < definition.count; index += 1) {
        pieces.push({
          id: pieces.length,
          side,
          type: definition.type,
          revealed: false,
          captured: false,
          position: -1,
        });
      }
    }
  }

  /* 📅 每日同副牌:亂數來源換成「日期種子」⇒ 今天全世界的暗子擺法完全相同。
     ★ 只換來源、不換演算法(seededShuffle 與 shuffle 都是 Fisher-Yates)——
       同一個洗牌寫兩份就是漂移的溫床。 */
  const dailyKeyForGame = settings.dailyKey || null;
  const dailyDeckNo = dailyKeyForGame ? Math.max(1, settings.dailyDeck | 0 || 1) : 0;   // 📅 今天第幾副
  const order = dailyKeyForGame && window.BanqiDaily
    ? window.BanqiDaily.seededShuffle([...Array(BOARD_SIZE).keys()],
      window.BanqiDaily.dailyRandom(dailyKeyForGame, dailyDeckNo))
    : shuffle([...Array(BOARD_SIZE).keys()]);
  const board = Array(BOARD_SIZE).fill(null);

  order.forEach((cellIndex, pieceId) => {
    board[cellIndex] = pieceId;
    pieces[pieceId].position = cellIndex;
  });

  return {
    board,
    pieces,
    mode: settings.mode || "ai",
    difficulty: settings.difficulty || "standard",
    perspective: settings.perspective === "flat" ? "flat" : "angled",
    view: {
      spin: normalizeAngle(Number.isFinite(settings.viewSpin) ? settings.viewSpin : DEFAULT_VIEW.spin),
      tilt: clamp(Number.isFinite(settings.viewTilt) ? settings.viewTilt : DEFAULT_VIEW.tilt, 10, 72),
    },
    turnSide: null,
    humanSide: null,
    aiSide: null,
    selectedIndex: null,
    legalTargets: [],
    winner: null,
    winnerReason: "",
    message: "先翻子定邊，再開始攻防。",
    aiThinking: false,
    installPrompt: null,
    lastAction: null,
    /* 💡 AI 提示:{ turnCount, side, action } —— 算它的時候是第幾手、輪到誰。
       對不上就重算 ⇒ 局面一變舊建議自己失效,不必去每個動棋盤的地方補一行清除。
       放在這個工廠裡 ⇒ 重新開局自然歸零(不是另外記得去清)。 */
    hint: null,
    turnCount: 0,
    dailyKey: dailyKeyForGame,   // 📅 非 null=這局是每日同副牌
    dailyDeck: dailyDeckNo,      // 📅 今天的第幾副(1 起;0=不是每日模式)
    dailyScored: false,          // 這局的成績記過了沒(一局只記一次)
  };
}

function shuffle(items) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function fillDifficultyOptions() {
  elements.difficultySelect.innerHTML = "";

  Object.entries(AI_LEVELS).forEach(([value, level]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = level.label;
    elements.difficultySelect.append(option);
  });
}

function bindEvents() {
  elements.newGameButton.addEventListener("click", () => {
    startNewGame("重新洗牌完成，翻開暗子開始新對局。");   // 一般開局=隨機洗牌(離開每日模式)
  });

  // 💡 AI 提示:借同一支 chooseAiAction,把 aiSide 換成「現在該走的這一邊」
  if (elements.hintButton) {
    elements.hintButton.addEventListener("click", showHint);
  }

  /* ★ 包一層:直接掛 startDailyGame 會把 click event 當成 deckNo 傳進去
     (Number.isInteger(event) 是 false 所以剛好沒壞,但那是巧合——不留這種接線)。 */
  document.querySelector("#dailyButton")?.addEventListener("click", () => startDailyGame());

  elements.modeSelect.addEventListener("change", () => {
    state.mode = elements.modeSelect.value;
    startNewGame(state.mode === "ai" ? "已切換為對戰 AI。" : "已切換為雙人同機。");
  });

  elements.difficultySelect.addEventListener("change", () => {
    state.difficulty = elements.difficultySelect.value;
    saveSettings();
    renderStatus();
    seatPet();   // 🐾 換難度就換動物(這局的 AI 也是馬上換檔)
  });

  elements.perspectiveButton.addEventListener("click", () => {
    state.perspective = state.perspective === "angled" ? "flat" : "angled";
    saveSettings();
    syncControls();
    renderBoardView();
  });

  elements.resetViewButton.addEventListener("click", () => {
    resetBoardView();
  });

  // ▼ 收起選單 / ▲ 展開選單:切 body.menu-folded(CSS 藏面板、棋盤拿回空間),按的那一下才寫 localStorage
  if (elements.menuFoldButton) {
    elements.menuFoldButton.addEventListener("click", () => {
      applyMenuFold(!document.body.classList.contains("menu-folded"), { persist: true });
    });
  }

  elements.installButton.addEventListener("click", async () => {
    if (!state.installPrompt) {
      return;
    }

    state.installPrompt.prompt();
    try {
      await state.installPrompt.userChoice;
    } catch (error) {
      // Ignore user dismissal.
    }
    state.installPrompt = null;
    updateInstallHint();
  });

  elements.board.addEventListener("click", (event) => {
    if (performance.now() < dragState.suppressClickUntil) {
      return;
    }

    const cell = event.target.closest(".cell");
    if (!cell) {
      return;
    }
    handleCellClick(Number(cell.dataset.index));
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    updateInstallHint();
  });

  window.addEventListener("appinstalled", () => {
    state.installPrompt = null;
    state.message = "安裝完成，之後可像 App 一樣從主畫面直接開啟。";
    updateInstallHint();
    renderStatus();
  });

  elements.boardStage.addEventListener("pointerdown", handleBoardPointerDown);
  elements.boardStage.addEventListener("pointermove", handleBoardPointerMove);
  elements.boardStage.addEventListener("pointerup", handleBoardPointerUp);
  elements.boardStage.addEventListener("pointercancel", handleBoardPointerUp);
  elements.boardStage.addEventListener("lostpointercapture", finishBoardDrag);
  elements.boardStage.addEventListener("dblclick", () => {
    if (state.perspective === "angled") {
      resetBoardView();
    }
  });
}

function syncControls() {
  elements.modeSelect.value = state.mode;
  elements.difficultySelect.value = state.difficulty;
  elements.difficultySelect.disabled = state.mode !== "ai";
  elements.perspectiveButton.setAttribute("aria-pressed", String(state.perspective === "angled"));
  elements.perspectiveButton.textContent = state.perspective === "angled" ? "切換平面" : "開啟 360°";
  elements.resetViewButton.disabled = state.perspective !== "angled";
}

function resetBoardView() {
  state.view = {
    tilt: DEFAULT_VIEW.tilt,
    spin: DEFAULT_VIEW.spin,
  };
  saveSettings();
  renderBoardView();
}

function renderBoardView() {
  elements.board.dataset.perspective = state.perspective;
  elements.board.dataset.interaction = isBoardInteractionLocked() ? "locked" : "active";
  elements.boardStage.dataset.perspective = state.perspective;
  elements.boardStage.dataset.dragging = String(dragState.active && dragState.moved);
  elements.board.style.setProperty("--board-tilt", `${state.view.tilt}deg`);
  elements.board.style.setProperty("--board-spin", `${normalizeAngle(state.view.spin)}deg`);
  elements.boardHelp.textContent = state.perspective === "angled"
    ? "拖曳棋盤可 360 度旋轉，垂直拖曳可調整俯角。"
    : "切回 360° 視角後，就能拖曳旋轉棋盤。";
  fitBoard();
  setTimeout(fitBoard, 360);   // .board 的 transform 有 320ms transition,量太早會拿到過渡中的投影框
  setTimeout(fitBoard, 800);   // 進真全螢幕時瀏覽器還會再重排一輪(3d-chess-co 0914 實測 600ms 才穩)
}

/* ⛶ fit-play「玩的版面」(v9,2026-09-14;跟 3d-chess-co v27 同一套)。CSS 在 styles.css 檔尾;這裡管三件事:
   ① 什麼時候開:沉浸(index.html mfs 段切的 body.immersive)或 手機橫向(FIT_PLAY_QUERY,跟 styles.css 那條一字不差)
   ② 棋盤放多大:fitBoard() 用棋盤所有子孫的投影框聯集(getBoundingClientRect 含 rotateX/rotateZ/透視)逐步縮放到剛好裝進 .board-card,
      投影框重心會往下偏 ⇒ 再用 --fit-shift 移回卡片中心
   ③ 「☰ 選單」:body.panels-open 暫時回一般版面看模式/AI 強度那張卡 */
function fitPlayActive() {
  return document.body.classList.contains("fit-play") && !document.body.classList.contains("panels-open");
}
function fitBoard() {
  const wrap = document.querySelector(".board-card");
  const board = elements.board;
  const stage = elements.boardStage;
  if (!wrap || !board || !stage) return;
  if (!fitPlayActive()) {
    board.style.removeProperty("--fit-board-w");
    stage.style.removeProperty("--fit-shift-x");
    stage.style.removeProperty("--fit-shift-y");
    return;
  }
  const PAD = 6;
  const reserve = petReserve();   // 🐾 動物小窗的位子從頂端留出來(放不下 = 0,跟以前完全一樣)
  const wrapR = wrap.getBoundingClientRect();
  const availW = wrap.clientWidth - PAD * 2;
  const availH = wrap.clientHeight - PAD * 2 - reserve;
  if (availW < 80 || availH < 80) return;
  const bbox = () => {
    const r = board.getBoundingClientRect();
    let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
    for (const el of board.querySelectorAll("*")) {
      const q = el.getBoundingClientRect();
      if (!q.width) continue;
      if (q.left < x0) x0 = q.left; if (q.top < y0) y0 = q.top; if (q.right > x1) x1 = q.right; if (q.bottom > y1) y1 = q.bottom;
    }
    return { x0, y0, w: x1 - x0, h: y1 - y0 };
  };
  stage.style.setProperty("--fit-shift-x", "0px");
  stage.style.setProperty("--fit-shift-y", "0px");
  let w = Math.min(availW, availH);
  for (let i = 0; i < 5; i++) {
    board.style.setProperty("--fit-board-w", `${Math.floor(w)}px`);
    const b = bbox();
    if (!b.w || !b.h) return;
    const s = Math.min(availW / b.w, availH / b.h);
    if (s >= 0.985 && s <= 1.01) break;
    w = Math.max(100, w * Math.min(s, 1.6));
  }
  for (let i = 0; i < 2; i++) {
    const b = bbox();
    const dx = (wrapR.left + wrapR.width / 2) - (b.x0 + b.w / 2);
    const dy = (wrapR.top + PAD + reserve + availH / 2) - (b.y0 + b.h / 2);   // 🐾 reserve 0 時 = 卡片正中,跟以前一樣
    const curX = parseFloat(stage.style.getPropertyValue("--fit-shift-x")) || 0;
    const curY = parseFloat(stage.style.getPropertyValue("--fit-shift-y")) || 0;
    stage.style.setProperty("--fit-shift-x", `${Math.round(curX + dx)}px`);
    stage.style.setProperty("--fit-shift-y", `${Math.round(curY + dy)}px`);
    const c = bbox();
    const over = Math.max(c.w / availW, c.h / availH);
    if (over <= 1.005) break;
    w = Math.max(100, w / over * 0.99);
    board.style.setProperty("--fit-board-w", `${Math.floor(w)}px`);
  }
}
function syncFitPlay() {
  const on = document.body.classList.contains("immersive") || Boolean(fitPlayMedia && fitPlayMedia.matches);
  document.body.classList.toggle("fit-play", on);
  if (!on) document.body.classList.remove("panels-open");
  const btn = document.querySelector("#playMenuButton");
  if (btn) {
    const open = document.body.classList.contains("panels-open");
    btn.textContent = open ? "✕ 收合選單" : "☰ 選單";
    btn.setAttribute("aria-expanded", String(open));
  }
  fitBoard();
}
function bindFitPlay() {
  if (fitPlayMedia) {
    if (fitPlayMedia.addEventListener) fitPlayMedia.addEventListener("change", syncFitPlay);
    else if (fitPlayMedia.addListener) fitPlayMedia.addListener(syncFitPlay);
  }
  window.addEventListener("resize", () => requestAnimationFrame(syncFitPlay));
  new MutationObserver(() => {
    const on = document.body.classList.contains("immersive") || Boolean(fitPlayMedia && fitPlayMedia.matches);
    if (on !== document.body.classList.contains("fit-play")) syncFitPlay(); else fitBoard();
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  const btn = document.querySelector("#playMenuButton");
  if (btn) {
    btn.addEventListener("click", () => {
      document.body.classList.toggle("panels-open");
      syncFitPlay();
      window.scrollTo(0, 0);
    });
  }
  syncFitPlay();
}

function handleBoardPointerDown(event) {
  if (state.perspective !== "angled" || !event.isPrimary) {
    return;
  }

  if (event.pointerType === "mouse" && event.button !== 0) {
    return;
  }

  dragState.active = true;
  dragState.moved = false;
  dragState.pointerId = event.pointerId;
  dragState.pointerCaptured = false;
  dragState.startX = event.clientX;
  dragState.startY = event.clientY;
  dragState.startSpin = state.view.spin;
  dragState.startTilt = state.view.tilt;
  dragState.startCellIndex = getCellIndexFromEventTarget(event.target);
}

function handleBoardPointerMove(event) {
  if (!dragState.active || dragState.pointerId !== event.pointerId) {
    return;
  }

  const deltaX = event.clientX - dragState.startX;
  const deltaY = event.clientY - dragState.startY;

  if (!dragState.moved && Math.abs(deltaX) + Math.abs(deltaY) < 8) {
    return;
  }

  if (!dragState.pointerCaptured) {
    elements.boardStage.setPointerCapture(event.pointerId);
    dragState.pointerCaptured = true;
  }

  dragState.moved = true;
  state.view.spin = normalizeAngle(dragState.startSpin + deltaX * 0.55);
  state.view.tilt = clamp(dragState.startTilt - deltaY * 0.18, 10, 72);
  renderBoardView();
}

function handleBoardPointerUp(event) {
  if (!dragState.active || dragState.pointerId !== event.pointerId) {
    return;
  }

  const tappedCellIndex = dragState.moved ? null : dragState.startCellIndex;
  finishBoardDrag();

  if (tappedCellIndex !== null) {
    dragState.suppressClickUntil = performance.now() + 260;
    handleCellClick(tappedCellIndex);
  }
}

function finishBoardDrag() {
  if (!dragState.active) {
    return;
  }

  if (dragState.moved) {
    dragState.suppressClickUntil = performance.now() + 180;
    saveSettings();
  }

  dragState.active = false;
  dragState.moved = false;
  dragState.pointerId = null;
  dragState.pointerCaptured = false;
  dragState.startCellIndex = null;
  renderBoardView();
}

function getCellIndexFromEventTarget(target) {
  const cell = target instanceof Element ? target.closest(".cell") : null;
  return cell ? Number(cell.dataset.index) : null;
}

function startNewGame(message, options = {}) {
  const settings = loadSettings();
  state = createInitialState({
    ...settings,
    mode: state.mode,
    difficulty: state.difficulty,
    perspective: state.perspective,
    dailyKey: options.dailyKey || null,   // 📅 有給=這局用今天那副牌
    dailyDeck: options.dailyDeck || 0,    // 📅 今天的第幾副(1 起)
  });
  state.message = message;
  saveSettings();
  syncControls();
  render({ fullBoard: true });
  seatPet();   // 🐾 每局重坐(模式 / 難度 / 每日 決定誰坐)
}

/* ══════════ 📅 每日同副牌 ══════════
   今天全世界的暗子擺法完全相同(日期種子洗牌),比誰用最少回合贏。
   ★ 為什麼暗棋做「同副牌」而不是「殘局」:翻開才知道是它的靈魂,
     攤開的完全資訊解謎已經不是暗棋了(見 daily.js 檔頭)。 */
/** 今天一共幾副、破了幾副、下一副是第幾副(全部從戰績算,不另存狀態) */
function dailyProgress() {
  const D = window.BanqiDaily;
  if (!D) return null;
  const key = D.dailyKey();
  const total = D.DAILY_DECK_COUNT;
  const decks = D.dailyDecks(key);
  const broken = Object.keys(decks).filter((n) => decks[n] && decks[n].best).length;
  let next = 0;                                   // 1 起;0=全破完了
  for (let i = 1; i <= total; i += 1) if (!(decks[String(i)] && decks[String(i)].best)) { next = i; break; }
  return { key, total, decks, broken, next };
}

/* 開今天的第 deckNo 副(不給=今天還沒破的第一副;全破完 → 回第 1 副可重打拚更少回合) */
function startDailyGame(deckNo) {
  const D = window.BanqiDaily;
  if (!D) return;                                   // daily.js 載不到:安靜退回,不弄壞遊戲
  const prog = dailyProgress();
  const no = Number.isInteger(deckNo) && deckNo >= 1
    ? Math.min(deckNo, prog.total)
    : (prog.next || 1);
  const rec = prog.decks[String(no)];
  const best = rec && rec.best ? rec.best : 0;
  startNewGame(
    `📅 ${prog.key} 第 ${no}/${prog.total} 副牌(今天已破 ${prog.broken} 副)`
    + `——今天全世界的暗子擺法都一樣!翻子定邊,用最少回合贏。`
    + (best ? `(這副你的最佳:${best} 回合)` : ""),
    { dailyKey: prog.key, dailyDeck: no },
  );
}

/** 每日模式下贏了就記(輸不記,不打擊孩子);一局只記一次 */
function scoreDailyIfWon() {
  const D = window.BanqiDaily;
  if (!D || !state.dailyKey || state.dailyScored) return;
  if (!state.winner) return;
  // 對 AI 時只記「人贏」;雙人同機沒有「你」,誰贏都算這副牌被破了
  const humanWon = state.mode === "ai" ? state.winner === state.humanSide : true;
  if (!humanWon) return;
  state.dailyScored = true;
  const total = D.DAILY_DECK_COUNT;
  const r = D.applyDailyWin(state.dailyKey, state.dailyDeck, state.turnCount);
  state.message = `📅 破解第 ${state.dailyDeck} 副!用了 ${state.turnCount} 回合`
    + (r.isNewBest ? "(新紀錄!)" : `(這副最佳 ${r.best} 回合)`)
    + `・今天已破 ${r.brokenCount}/${total} 副`
    + (r.brokenCount >= total ? " —— 今天全破了,明天換新的三副!" : "(按「📅 每日同副牌」接下一副)");
}

function handleCellClick(index) {
  if (state.winner || state.aiThinking || !isLocalActorTurn()) {
    return;
  }

  const piece = getPieceAt(index);

  if (piece && !piece.revealed) {
    clearSelection();
    performAction({ type: "flip", index }, "human");
    return;
  }

  if (state.selectedIndex !== null) {
    const target = state.legalTargets.find((action) => action.to === index);
    if (target) {
      performAction(target, "human");
      return;
    }
  }

  if (piece && piece.revealed && state.turnSide && piece.side === state.turnSide) {
    if (state.selectedIndex === index) {
      clearSelection();
    } else {
      selectPiece(index);
    }
    renderBoard();
    return;
  }

  clearSelection();
  renderBoard();
}

function isLocalActorTurn() {
  if (state.mode === "local") {
    return true;
  }

  if (state.humanSide === null) {
    return true;
  }

  return state.turnSide === state.humanSide;
}

function performAction(action, actor) {
  clearSelection();
  applyActualAction(state, action, actor);
  state.turnCount += 1;
  if (actor === "human" && action.type === "capture" && pet) pet.react("gasp", "wow");   // 🐾 你吃了牠的子:「哇」
  finalizeAfterAction(actor);
  render();
}


function finalizeAfterAction() {
  const outcome = detectWinner(state);

  if (outcome) {
    state.winner = outcome.side;
    state.winnerReason = outcome.reason;
    // 📡 完賽 beacon:對局分出勝負 = 一次 -done(finalizeAfterAction 在 winner 定下後不會再進來;統計是配菜,失敗靜默)。
    try { if (window.psDone) window.psDone(); } catch (e) {}
    state.aiThinking = false;
    state.message = outcome.message;
    scoreDailyIfWon();   // 📅 每日同副牌:贏了就記今天最少回合(會蓋掉 message)
    petEndGame();        // 🐾 牠贏了跳、輸了低頭(每局一次)
    return;
  }

  if (state.mode === "ai" && state.aiSide && state.turnSide === state.aiSide) {
    state.aiThinking = true;
    renderStatus();
    if (pet) pet.think();   // 🐾 手托腮想棋(人聲每三手一次)
    window.setTimeout(runAiTurn, 220);
  } else {
    state.aiThinking = false;
  }
}


function runAiTurn() {
  if (!state.aiThinking || state.winner || state.mode !== "ai" || state.turnSide !== state.aiSide) {
    return;
  }

  const action = chooseAiAction(state);
  if (!action) {
    state.aiThinking = false;
    const winner = state.humanSide || "red";
    state.winner = winner;
    state.message = "AI 無合法手，這局由你拿下。";
    scoreDailyIfWon();   // 📅 這條也是「贏」的其中一條路,別漏記(#32 守門存在不等於會攔的同型)
    petEndGame();        // 🐾 這條也是「你贏」
    render();
    return;
  }

  applyActualAction(state, action);
  state.turnCount += 1;
  state.aiThinking = false;
  petAfterAiAction(action);   // 🐾 翻 / 吃 / 走位的反應(要在 finalize 之前:結束那一手由 petEndGame 蓋過去)
  finalizeAfterAction();
  render();
}


function selectPiece(index) {
  state.selectedIndex = index;
  state.legalTargets = getPieceActions(state, index);
}

function clearSelection() {
  state.selectedIndex = null;
  state.legalTargets = [];
}


function render(options = {}) {
  const { fullBoard = false } = options;
  syncControls();
  renderBoard(fullBoard);
  renderStatus();
  renderCaptureSummary();
  renderPoolSummary();
  syncPet();   // 🐾 等你 / 鈕 / 小窗位子
}

function renderBoard(forceFull = false) {
  ensureBoardCells();
  renderBoardView();
  const snapshot = getBoardUiSnapshot();
  const dirtyIndexes = getDirtyBoardIndexes(viewRefs.boardUi, snapshot, forceFull);

  for (const index of dirtyIndexes) {
    updateBoardCell(index);
  }

  viewRefs.boardUi = snapshot;
}

function ensureBoardCells() {
  if (viewRefs.boardCells.length === BOARD_SIZE) {
    return;
  }

  viewRefs.boardCells = [];
  const fragment = document.createDocumentFragment();

  for (let index = 0; index < BOARD_SIZE; index += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.index = String(index);
    button.innerHTML = `
      <span class="piece" hidden>
        <span class="piece__body"></span>
        <span class="piece__top">
          <span class="piece__glyph">
            <span class="piece__char"></span>
            <span class="piece__type"></span>
          </span>
        </span>
      </span>
      <span class="cell__marker"></span>
      <span class="cell__hint" aria-hidden="true">💡</span>
    `;

    viewRefs.boardCells.push({
      button,
      piece: button.querySelector(".piece"),
      pieceChar: button.querySelector(".piece__char"),
      pieceType: button.querySelector(".piece__type"),
      marker: button.querySelector(".cell__marker"),
    });
    fragment.append(button);
  }

  elements.board.replaceChildren(fragment);
}

function updateBoardCell(index) {
  const refs = viewRefs.boardCells[index];
  const piece = getPieceAt(index);
  const markerLabel = buildTargetMarker(index);
  const nextState = {
    className: buildCellClass(index, piece),
    ariaLabel: describeCell(index, piece),
    markerLabel,
    pieceHidden: !piece,
    pieceClass: piece ? `piece piece--${!piece.revealed ? "hidden" : piece.side}` : "piece",
    pieceChar: !piece ? "" : piece.revealed ? pieceLabelFor(piece) : "暗",
    pieceType: !piece ? "" : piece.revealed ? PIECE_META[piece.type].shortName : "FLIP",
  };
  const previousState = refs.rendered;

  if (previousState && shallowEqual(previousState, nextState)) {
    return;
  }

  if (!previousState || previousState.className !== nextState.className) {
    refs.button.className = nextState.className;
  }

  if (!previousState || previousState.ariaLabel !== nextState.ariaLabel) {
    refs.button.setAttribute("aria-label", nextState.ariaLabel);
  }

  if (!previousState || previousState.markerLabel !== nextState.markerLabel) {
    refs.marker.textContent = nextState.markerLabel;
  }

  if (!previousState || previousState.pieceHidden !== nextState.pieceHidden) {
    refs.piece.hidden = nextState.pieceHidden;
  }

  if (!previousState || previousState.pieceClass !== nextState.pieceClass) {
    refs.piece.className = nextState.pieceClass;
  }

  if (!previousState || previousState.pieceChar !== nextState.pieceChar) {
    refs.pieceChar.textContent = nextState.pieceChar;
  }

  if (!previousState || previousState.pieceType !== nextState.pieceType) {
    refs.pieceType.textContent = nextState.pieceType;
  }

  refs.rendered = nextState;
}

function getBoardUiSnapshot() {
  return {
    selectedIndex: state.selectedIndex,
    legalTargetIndexes: [...new Set(state.legalTargets.map((action) => action.to))],
    lastActionIndexes: getActionIndexes(state.lastAction),
  };
}

function getDirtyBoardIndexes(previousSnapshot, nextSnapshot, forceFull) {
  if (forceFull || !previousSnapshot) {
    return [...Array(BOARD_SIZE).keys()];
  }

  const dirty = new Set();

  for (const index of [
    previousSnapshot.selectedIndex,
    nextSnapshot.selectedIndex,
    ...previousSnapshot.legalTargetIndexes,
    ...nextSnapshot.legalTargetIndexes,
    ...previousSnapshot.lastActionIndexes,
    ...nextSnapshot.lastActionIndexes,
  ]) {
    if (index !== null && index !== undefined && index >= 0) {
      dirty.add(index);
    }
  }

  return [...dirty];
}

function getActionIndexes(action) {
  if (!action) {
    return [];
  }

  const indexes = [];

  if (typeof action.index === "number") {
    indexes.push(action.index);
  }

  if (typeof action.from === "number") {
    indexes.push(action.from);
  }

  if (typeof action.to === "number") {
    indexes.push(action.to);
  }

  return [...new Set(indexes)];
}

/* 💡 提示只在「算它的那一手」上有效 —— 對不上就當沒有。
   ★ 不去每個會改動局面的地方補一行 clearHint():漏一處就是「提示指著一格早就過期的棋」,
     而且不會有任何東西報錯。用**比對**取代**逐處清除**,結構上不可能過期。 */
function getActiveHintAction() {
  if (!state.hint) {
    return null;
  }
  return (state.hint.turnCount === state.turnCount && state.hint.side === state.turnSide)
    ? state.hint.action
    : null;
}

/* 💡 AI 提示:借的是**同一支** chooseAiAction —— 提示與對手同源,
   只是把 aiSide 換成「現在該走的這一邊」,並掛上零隨機的 HINT_LEVEL。
   ⚠ 暗棋是**不完全資訊**(蓋著的子還沒翻開),所以這裡的建議本質上是
     「以目前看得到的資訊,期望值最高的一手」,不是保證最好的一手 ——
     文案要照這個講,不可以講成「照著走一定贏」(那是對孩子說謊)。
   文案三態不可混講:有建議 / 這局結束了 / 真的沒有可走的。 */
function showHint() {
  if (state.winner) {
    setHintMessage("💡 這一局已經結束了。");
    return;
  }
  if (state.aiThinking || !isLocalActorTurn()) {
    return;                                   // 不是你的回合,或 AI 正在想
  }

  /* ★ 還沒定邊(一子都還沒翻)⇒ 誠實說「不用建議」,不要假裝算得出東西。
     暗棋的第一翻決定你是哪一邊,每一枚在那一刻都一樣 ——
     這時候硬推薦某一格,是給一個沒有根據的答案。 */
  if (state.turnSide === null) {
    setHintMessage("💡 還沒定邊:第一翻決定你是紅方還是黑方,翻哪一枚都可以。");
    return;
  }

  if (getActiveHintAction()) {                // 同一手按幾次都回同一個建議
    renderBoard(true);
    renderStatus();
    return;
  }

  let action = null;
  try {
    const probe = cloneState(state);
    probe.aiSide = state.turnSide;            // 讓搜尋站在「現在該走的這一邊」
    probe.hintLevel = HINT_LEVEL;             // 最深 + 零隨機
    action = chooseHintAction(probe);         // ★ 不是 chooseAiAction:提示多兩道「別做白工交換」的關卡
  } catch (error) {
    console.error("[hint] chooseHintAction threw:", error);
    setHintMessage("💡 這一手算不出來,先自己走走看。");
    return;
  }

  if (!action) {
    setHintMessage("💡 找不到可走的棋了。");
    return;
  }

  state.hint = { turnCount: state.turnCount, side: state.turnSide, action };
  renderBoard(true);
  renderStatus();
}

/* 提示文字寫進 statusMessage,並且**下一次 renderStatus 就會被蓋掉** ——
   這是刻意的:提示是一次性的話,不該留在畫面上假裝是常駐狀態。 */
function setHintMessage(text) {
  elements.statusMessage.textContent = text;
}

function describeHintAction(action) {
  if (!action) {
    return "";
  }
  if (action.type === "flip") {
    return "💡 建議:翻開紫框那一枚暗子(暗棋看不到蓋著的子,這是以目前資訊最划算的一翻)";
  }
  const moving = getPieceAt(action.from);
  const target = getPieceAt(action.to);
  const name = moving && moving.revealed ? pieceLabelFor(moving) : "那一枚";
  return action.type === "capture" && target && target.revealed
    ? `💡 建議:用${name}吃掉對方的${pieceLabelFor(target)}(紫框=從哪裡到哪裡)`
    : `💡 建議:把${name}走到另一個紫框(紫框=從哪裡到哪裡)`;
}

function buildCellClass(index, piece) {
  const classes = ["cell"];

  if (state.selectedIndex === index) {
    classes.push("cell--selected");
  }

  /* 💡 提示指的那一格(翻子=那一枚;走/吃=起點與終點都標)。
     紫色是挑過的:selected/last/movable/capturable 四色都已佔用,
     撞色的話「提示」跟「這格我可以走」在畫面上分不出來。 */
  const hintAction = getActiveHintAction();
  if (hintAction) {
    if (hintAction.type === "flip" && hintAction.index === index) {
      classes.push("cell--hint");
    } else if (hintAction.from === index || hintAction.to === index) {
      classes.push("cell--hint");
    }
  }

  if (
    state.lastAction &&
    ((state.lastAction.from === index) || (state.lastAction.to === index) || (state.lastAction.index === index))
  ) {
    classes.push("cell--last");
  }

  if (state.legalTargets.some((action) => action.to === index && action.type === "move")) {
    classes.push("cell--movable");
  }

  if (state.legalTargets.some((action) => action.to === index && action.type === "capture")) {
    classes.push("cell--capturable");
  }

  if (!piece) {
    classes.push("cell--empty");
  }

  return classes.join(" ");
}

function buildTargetMarker(index) {
  const action = state.legalTargets.find((item) => item.to === index);
  if (!action) {
    return "";
  }
  return action.type === "capture" ? "吃" : "走";
}

function describeCell(index, piece) {
  const { row, col } = indexToCoord(index);
  const location = `第${row + 1}列第${col + 1}行`;

  if (!piece) {
    return `${location}，空格`;
  }

  if (!piece.revealed) {
    return `${location}，暗子`;
  }

  return `${location}，${SIDE_LABEL[piece.side]}${pieceLabelFor(piece)}`;
}

function renderStatus() {
  const hiddenCount = state.pieces.filter((piece) => !piece.revealed && !piece.captured).length;
  const emptyCount = state.board.filter((cell) => cell === null).length;

  // 📅 每日同副牌:常駐一行(哪一天的牌、已走幾回合)
  const dailyLine = document.querySelector("#dailyLine");
  if (dailyLine) {
    dailyLine.hidden = !state.dailyKey;
    if (state.dailyKey) {
      const prog = dailyProgress();
      dailyLine.textContent = `📅 ${state.dailyKey} 第 ${state.dailyDeck}/${prog ? prog.total : 1} 副`
        + `(今天已破 ${prog ? prog.broken : 0} 副)・已走 ${state.turnCount} 回合`;
    }
  }

  if (state.winner) {
    const winnerLabel =
      state.mode === "ai" && state.humanSide
        ? state.winner === state.humanSide
          ? "你獲勝"
          : "AI 獲勝"
        : `${SIDE_LABEL[state.winner]}獲勝`;
    elements.statusTurn.textContent = winnerLabel;
  } else if (state.aiThinking) {
    elements.statusTurn.textContent = `${pet && pet.on ? pet.emoji + " " : ""}AI 思考中`;   // 🐾 帶牠的臉
  } else if (state.turnSide) {
    elements.statusTurn.textContent = `輪到${SIDE_LABEL[state.turnSide]}`;
  } else {
    elements.statusTurn.textContent = "翻開任一枚暗子開始";
  }

  /* 💡 提示還有效的時候,它蓋過常駐訊息;局面一動 getActiveHintAction() 就回 null,
     訊息自己換回來 —— 不需要另外去清。 */
  const liveHint = getActiveHintAction();
  elements.statusMessage.textContent = liveHint ? describeHintAction(liveHint) : state.message;
  elements.statusCounts.textContent = `暗子 ${hiddenCount} ・ 空格 ${emptyCount}`;

  if (state.mode === "ai") {
    if (state.humanSide) {
      const aiName = pet && pet.on ? `${pet.emoji} ${pet.name}(AI)` : "AI";   // 🐾 對手是誰就寫誰,孩子知道「輸給的是牠」
      elements.statusSide.textContent = `你執${SIDE_CHAR[state.humanSide]}，${aiName}執${SIDE_CHAR[state.aiSide]}。`;
    } else {
      elements.statusSide.textContent = "尚未定邊，先翻到哪一色就執哪一色。";
    }
  } else {
    elements.statusSide.textContent = state.turnSide
      ? `${SIDE_LABEL[state.turnSide]}請行棋。`
      : "雙人同機模式，先翻子定邊。";
  }
}

function renderCaptureSummary() {
  ensureSummaryCards();

  for (const side of ["red", "black"]) {
    const refs = viewRefs.captureCards[side];
    const live = state.pieces.filter((piece) => !piece.captured && piece.side === side).length;
    const captured = state.pieces.filter((piece) => piece.captured && piece.side === side);
    refs.count.textContent = `剩餘 ${live}`;

    for (const definition of PIECE_TYPES) {
      const count = captured.filter((piece) => piece.type === definition.type).length;
      const chip = refs.chips[definition.type];
      chip.value.textContent = `x${count}`;
      chip.root.classList.toggle("chip--empty", count === 0);
    }
  }
}

function renderPoolSummary() {
  ensureSummaryCards();

  for (const side of ["red", "black"]) {
    const refs = viewRefs.poolCards[side];
    refs.count.textContent = `${state.pieces.filter(
      (piece) => piece.side === side && !piece.revealed && !piece.captured,
    ).length} 枚`;

    for (const definition of PIECE_TYPES) {
      const count = state.pieces.filter(
        (piece) => piece.side === side && piece.type === definition.type && !piece.revealed && !piece.captured,
      ).length;
      const chip = refs.chips[definition.type];
      chip.value.textContent = `x${count}`;
      chip.root.classList.toggle("chip--empty", count === 0);
    }
  }
}

function ensureSummaryCards() {
  if (!Object.keys(viewRefs.captureCards).length) {
    viewRefs.captureCards = buildSummaryCards(elements.captureSummary, (side) => SIDE_LABEL[side]);
  }

  if (!Object.keys(viewRefs.poolCards).length) {
    viewRefs.poolCards = buildSummaryCards(elements.poolSummary, (side) => `${SIDE_LABEL[side]}未翻開`);
  }
}

function buildSummaryCards(container, titleFactory) {
  const cards = {};
  const fragment = document.createDocumentFragment();

  for (const side of ["red", "black"]) {
    const wrapper = document.createElement("article");
    const head = document.createElement("div");
    const title = document.createElement("span");
    const count = document.createElement("span");
    const chipRow = document.createElement("div");
    const chips = {};

    wrapper.className = "team-card";
    head.className = "team-card__head";
    title.className = `team-card__title team-card__title--${side}`;
    title.textContent = titleFactory(side);
    count.className = "status-mini";
    chipRow.className = "chip-row";

    head.append(title, count);
    wrapper.append(head, chipRow);

    for (const definition of PIECE_TYPES) {
      const chip = document.createElement("span");
      const char = document.createElement("span");
      const value = document.createElement("span");

      chip.className = "chip chip--empty";
      char.className = "chip__char";
      char.textContent = definition.label[side];
      value.textContent = "x0";

      chip.append(char, value);
      chipRow.append(chip);
      chips[definition.type] = {
        root: chip,
        value,
      };
    }

    fragment.append(wrapper);
    cards[side] = { count, chips };
  }

  container.replaceChildren(fragment);
  return cards;
}


function updateInstallHint() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

  if (IN_APP_BROWSER) {
    elements.installButton.hidden = true;
    elements.installHint.textContent = `你正用 ${IN_APP_BROWSER.n} 內建瀏覽器開啟——要安裝到手機請先點${IN_APP_BROWSER.m}。棋照樣可以下!`;
    return;
  }

  if (standalone) {
    elements.installButton.hidden = true;
    elements.installHint.textContent = "目前已在安裝模式中執行，可離線開局。";
    return;
  }

  if (state.installPrompt) {
    elements.installButton.hidden = false;
    elements.installHint.textContent = "可直接安裝到主畫面，之後就能像手機 App 一樣開啟。";
    return;
  }

  elements.installButton.hidden = true;
  elements.installHint.textContent = isIos
    ? "iPhone 或 iPad 請用 Safari 的「分享」→「加入主畫面」安裝。"
    : "使用 Chrome 或 Edge 開啟時，可支援安裝與離線遊玩。";
}

function isBoardInteractionLocked() {
  return !isLocalActorTurn() || state.aiThinking || Boolean(state.winner);
}

function shallowEqual(left, right) {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (const key of leftKeys) {
    if (left[key] !== right[key]) {
      return false;
    }
  }

  return true;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeAngle(value) {
  const angle = value % 360;
  return angle < 0 ? angle + 360 : angle;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // The game still works online without a service worker.
    });
  });
}
