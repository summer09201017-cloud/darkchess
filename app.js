const BOARD_COLS = 4;
const BOARD_ROWS = 8;
const BOARD_SIZE = BOARD_COLS * BOARD_ROWS;
const SETTINGS_KEY = "cloud-banqi-settings-v1";
const WIN_SCORE = 100000;
const DEFAULT_VIEW = {
  tilt: 44,
  spin: -10,
};

const SIDE_LABEL = {
  red: "紅方",
  black: "黑方",
};

const SIDE_CHAR = {
  red: "紅",
  black: "黑",
};

const OPPOSITE = {
  red: "black",
  black: "red",
};

const PIECE_TYPES = [
  {
    type: "general",
    rank: 7,
    value: 1100,
    count: 1,
    label: { red: "帥", black: "將" },
    shortName: "將帥",
  },
  {
    type: "advisor",
    rank: 6,
    value: 200,
    count: 2,
    label: { red: "仕", black: "士" },
    shortName: "士仕",
  },
  {
    type: "elephant",
    rank: 5,
    value: 220,
    count: 2,
    label: { red: "相", black: "象" },
    shortName: "象相",
  },
  {
    type: "rook",
    rank: 4,
    value: 330,
    count: 2,
    label: { red: "俥", black: "車" },
    shortName: "車俥",
  },
  {
    type: "knight",
    rank: 3,
    value: 270,
    count: 2,
    label: { red: "傌", black: "馬" },
    shortName: "馬傌",
  },
  {
    type: "cannon",
    rank: 2,
    value: 300,
    count: 2,
    label: { red: "炮", black: "包" },
    shortName: "炮包",
  },
  {
    type: "pawn",
    rank: 1,
    value: 120,
    count: 5,
    label: { red: "兵", black: "卒" },
    shortName: "兵卒",
  },
];

const PIECE_META = Object.fromEntries(PIECE_TYPES.map((piece) => [piece.type, piece]));

const AI_LEVELS = {
  casual: {
    label: "休閒",
    depth: 1,
    thinkMs: 180,
    randomness: 0.45,
    topChoices: 4,
  },
  standard: {
    label: "標準",
    depth: 2,
    thinkMs: 520,
    randomness: 0.22,
    topChoices: 3,
  },
  master: {
    label: "高手",
    depth: 3,
    thinkMs: 900,
    randomness: 0.08,
    topChoices: 2,
  },
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
};

function bootstrap() {
  fillDifficultyOptions();
  bindEvents();
  ensureBoardCells();
  ensureSummaryCards();
  syncControls();
  render({ fullBoard: true });
  updateInstallHint();
  registerServiceWorker();
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
  finalizeAfterAction(actor);
  render();
}

function applyActualAction(targetState, action) {
  targetState.lastAction = action;

  if (action.type === "flip") {
    const piece = getPieceAt(action.index, targetState);
    piece.revealed = true;

    if (targetState.turnSide === null) {
      if (targetState.mode === "ai") {
        targetState.humanSide = piece.side;
        targetState.aiSide = OPPOSITE[piece.side];
      }
      targetState.turnSide = OPPOSITE[piece.side];
      targetState.message = `${pieceLabelFor(piece)}翻開，${SIDE_LABEL[piece.side]}定邊。`;
    } else {
      targetState.turnSide = OPPOSITE[targetState.turnSide];
      targetState.message = `${pieceLabelFor(piece)}翻開，局勢更明朗了。`;
    }

    return;
  }

  const fromPiece = getPieceAt(action.from, targetState);
  targetState.board[action.from] = null;

  if (action.type === "capture") {
    const capturedPiece = getPieceAt(action.to, targetState);
    capturedPiece.captured = true;
    capturedPiece.position = -1;
    targetState.message = `${pieceLabelFor(fromPiece)}吃掉${pieceLabelFor(capturedPiece)}。`;
  } else {
    targetState.message = `${pieceLabelFor(fromPiece)}移動到新位置。`;
  }

  targetState.board[action.to] = fromPiece.id;
  fromPiece.position = action.to;
  targetState.turnSide = OPPOSITE[targetState.turnSide];
}

function finalizeAfterAction() {
  const outcome = detectWinner(state);

  if (outcome) {
    state.winner = outcome.side;
    state.winnerReason = outcome.reason;
    state.aiThinking = false;
    state.message = outcome.message;
    scoreDailyIfWon();   // 📅 每日同副牌:贏了就記今天最少回合(會蓋掉 message)
    return;
  }

  if (state.mode === "ai" && state.aiSide && state.turnSide === state.aiSide) {
    state.aiThinking = true;
    renderStatus();
    window.setTimeout(runAiTurn, 220);
  } else {
    state.aiThinking = false;
  }
}

function detectWinner(targetState) {
  const liveRed = getLivePieces(targetState, "red");
  const liveBlack = getLivePieces(targetState, "black");

  if (liveRed.length === 0) {
    return {
      side: "black",
      reason: "capture",
      message: "黑方清空紅方所有棋子，對局結束。",
    };
  }

  if (liveBlack.length === 0) {
    return {
      side: "red",
      reason: "capture",
      message: "紅方清空黑方所有棋子，對局結束。",
    };
  }

  if (targetState.turnSide) {
    const actions = getLegalActions(targetState, targetState.turnSide);
    if (actions.length === 0) {
      const winner = OPPOSITE[targetState.turnSide];
      return {
        side: winner,
        reason: "stuck",
        message: `${SIDE_LABEL[targetState.turnSide]}已無合法手，${SIDE_LABEL[winner]}獲勝。`,
      };
    }
  }

  return null;
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
    render();
    return;
  }

  applyActualAction(state, action);
  state.turnCount += 1;
  state.aiThinking = false;
  finalizeAfterAction();
  render();
}

/* 💡 提示專用的檔位:最深、而且**零隨機**。
   ⚠ 刻意不放進 AI_LEVELS —— 難度下拉是直接遍歷 AI_LEVELS 生出來的(見 renderDifficultyOptions),
     放進去會多一個玩家選得到的假難度。
   為什麼一定要零隨機:chooseAiAction 會加 (rand-0.5)*randomness*70 的噪音、
   還會從 topChoices 裡隨機挑 ⇒ 同一個局面按兩次會給不同的手,看起來像跳針。
   randomness 0 + topChoices 1 ⇒ 噪音項是 0、pool 只有一個、Math.random() < 0 恆假。 */
const HINT_LEVEL = { label: "提示", depth: 3, thinkMs: 900, randomness: 0, topChoices: 1 };

function chooseAiAction(targetState) {
  const side = targetState.aiSide;
  const level = targetState.hintLevel || AI_LEVELS[targetState.difficulty];
  const deadline = performance.now() + level.thinkMs;
  const actions = orderActionsForSearch(
    targetState,
    getLegalActions(targetState, side),
    side,
    side,
  );

  if (!actions.length) {
    return null;
  }

  const scored = actions.map((action) => {
    let score;

    if (action.type === "flip") {
      score = evaluateState(targetState, side) + estimateFlipChoice(targetState, action.index, side, side);
    } else {
      const nextState = cloneState(targetState);
      applySearchAction(nextState, action);
      score = minimax(nextState, level.depth - 1, side, -Infinity, Infinity, deadline);
    }

    score += (Math.random() - 0.5) * level.randomness * 70;
    return { action, score };
  });

  scored.sort((left, right) => right.score - left.score);
  const pool = scored.slice(0, Math.max(1, Math.min(level.topChoices, scored.length)));

  if (pool.length > 1 && Math.random() < level.randomness) {
    return pool[Math.floor(Math.random() * pool.length)].action;
  }

  return pool[0].action;
}

function minimax(targetState, depth, aiSide, alpha, beta, deadline) {
  const outcome = detectWinner(targetState);
  if (outcome) {
    return outcome.side === aiSide ? WIN_SCORE - targetState.turnCount : -WIN_SCORE + targetState.turnCount;
  }

  if (depth <= 0 || performance.now() > deadline) {
    return evaluateState(targetState, aiSide);
  }

  const sideToMove = targetState.turnSide;
  const actions = orderActionsForSearch(
    targetState,
    getLegalActions(targetState, sideToMove),
    sideToMove,
    aiSide,
  );

  if (!actions.length) {
    return sideToMove === aiSide ? -WIN_SCORE : WIN_SCORE;
  }

  const maximizing = sideToMove === aiSide;
  let bestScore = maximizing ? -Infinity : Infinity;

  for (const action of actions) {
    let score;

    if (action.type === "flip") {
      score = evaluateState(targetState, aiSide) + estimateFlipChoice(targetState, action.index, sideToMove, aiSide);
    } else {
      const nextState = cloneState(targetState);
      applySearchAction(nextState, action);
      score = minimax(nextState, depth - 1, aiSide, alpha, beta, deadline);
    }

    if (maximizing) {
      bestScore = Math.max(bestScore, score);
      alpha = Math.max(alpha, score);
    } else {
      bestScore = Math.min(bestScore, score);
      beta = Math.min(beta, score);
    }

    if (beta <= alpha || performance.now() > deadline) {
      break;
    }
  }

  return bestScore;
}

function orderActionsForSearch(targetState, actions, sideToMove, aiSide) {
  const scored = actions.map((action) => {
    if (action.type === "flip") {
      return {
        action,
        score: estimateFlipChoice(targetState, action.index, sideToMove, aiSide),
      };
    }

    return {
      action,
      score: quickActionBonus(targetState, action, aiSide),
    };
  });

  scored.sort((left, right) => right.score - left.score);

  const result = [];
  let flipCount = 0;

  for (const entry of scored) {
    if (entry.action.type === "flip") {
      flipCount += 1;
      if (flipCount > 6) {
        continue;
      }
    }
    result.push(entry.action);
  }

  return result;
}

function quickActionBonus(targetState, action, aiSide) {
  const movingPiece = getPieceAt(action.from, targetState);
  let score = 0;

  if (action.type === "capture") {
    const targetPiece = getPieceAt(action.to, targetState);
    score += PIECE_META[targetPiece.type].value * 1.2;
    score -= PIECE_META[movingPiece.type].value * 0.08;
  }

  const { row, col } = indexToCoord(action.to);
  const centerDistance = Math.abs(row - 3.5) + Math.abs(col - 1.5);
  score += 18 - centerDistance * 4;

  if (movingPiece.side !== aiSide) {
    score *= -1;
  }

  return score;
}

function estimateFlipChoice(targetState, index, actingSide, aiSide) {
  const pool = targetState.pieces.filter((piece) => !piece.captured && !piece.revealed);
  if (pool.length === 0) {
    return 0;
  }

  const neighborIndexes = getAdjacentIndexes(index);
  const nextTurnSide = actingSide ? OPPOSITE[actingSide] : null;
  let total = 0;

  for (const candidate of pool) {
    const meta = PIECE_META[candidate.type];
    const sign = candidate.side === aiSide ? 1 : -1;
    let candidateScore = sign * meta.value * 0.17;

    if (candidate.side === nextTurnSide) {
      candidateScore += sign * meta.value * 0.08;
    } else {
      candidateScore -= sign * meta.value * 0.04;
    }

    let support = 0;
    let pressure = 0;

    for (const neighborIndex of neighborIndexes) {
      const neighbor = getPieceAt(neighborIndex, targetState);
      if (!neighbor || !neighbor.revealed) {
        continue;
      }

      if (neighbor.side === candidate.side) {
        support += 1;
      } else {
        pressure += 1;
      }
    }

    candidateScore += sign * support * 16;
    candidateScore -= sign * pressure * 22;

    if (candidate.type === "cannon") {
      candidateScore += sign * countLineScreens(index, targetState) * 12;
    }

    total += candidateScore;
  }

  return total / pool.length;
}

function countLineScreens(index, targetState) {
  let screens = 0;

  for (const direction of ["up", "down", "left", "right"]) {
    let cursor = step(index, direction);
    while (cursor !== -1) {
      if (targetState.board[cursor] !== null) {
        screens += 1;
        break;
      }
      cursor = step(cursor, direction);
    }
  }

  return screens;
}

function evaluateState(targetState, aiSide) {
  let score = 0;

  for (const piece of targetState.pieces) {
    if (piece.captured) {
      continue;
    }

    const meta = PIECE_META[piece.type];
    const sign = piece.side === aiSide ? 1 : -1;
    const material = piece.revealed ? meta.value : meta.value * 0.62;
    score += sign * material;

    if (piece.revealed) {
      const { row, col } = indexToCoord(piece.position);
      const centerDistance = Math.abs(row - 3.5) + Math.abs(col - 1.5);
      score += sign * (18 - centerDistance * 4);

      if (isThreatened(targetState, piece.position, OPPOSITE[piece.side])) {
        score -= sign * meta.value * 0.18;
      }
    }
  }

  const ownVisible = getVisibleActions(targetState, aiSide);
  const rivalVisible = getVisibleActions(targetState, OPPOSITE[aiSide]);
  score += (ownVisible.length - rivalVisible.length) * 10;
  score += visibleCapturePressure(ownVisible, targetState) * 0.18;
  score -= visibleCapturePressure(rivalVisible, targetState) * 0.18;

  return score;
}

function visibleCapturePressure(actions, targetState) {
  return actions
    .filter((action) => action.type === "capture")
    .reduce((total, action) => total + PIECE_META[getPieceAt(action.to, targetState).type].value, 0);
}

function getVisibleActions(targetState, side) {
  return targetState.pieces
    .filter((piece) => !piece.captured && piece.revealed && piece.side === side)
    .flatMap((piece) => getPieceActions(targetState, piece.position));
}

function isThreatened(targetState, index, attackerSide) {
  return getVisibleActions(targetState, attackerSide).some(
    (action) => action.type === "capture" && action.to === index,
  );
}

function cloneState(targetState) {
  return {
    ...targetState,
    board: [...targetState.board],
    pieces: targetState.pieces.map((piece) => ({ ...piece })),
    legalTargets: [],
    lastAction: targetState.lastAction ? { ...targetState.lastAction } : null,
  };
}

function applySearchAction(targetState, action) {
  targetState.lastAction = action;
  targetState.turnCount += 1;

  const movingPiece = getPieceAt(action.from, targetState);
  targetState.board[action.from] = null;

  if (action.type === "capture") {
    const capturedPiece = getPieceAt(action.to, targetState);
    capturedPiece.captured = true;
    capturedPiece.position = -1;
  }

  targetState.board[action.to] = movingPiece.id;
  movingPiece.position = action.to;
  targetState.turnSide = OPPOSITE[targetState.turnSide];
}

function selectPiece(index) {
  state.selectedIndex = index;
  state.legalTargets = getPieceActions(state, index);
}

function clearSelection() {
  state.selectedIndex = null;
  state.legalTargets = [];
}

function getLegalActions(targetState, side) {
  const actions = [];

  for (let index = 0; index < BOARD_SIZE; index += 1) {
    const piece = getPieceAt(index, targetState);

    if (!piece) {
      continue;
    }

    if (!piece.revealed) {
      actions.push({ type: "flip", index });
      continue;
    }

    if (piece.side === side) {
      actions.push(...getPieceActions(targetState, index));
    }
  }

  return actions;
}

function getPieceActions(targetState, index) {
  const piece = getPieceAt(index, targetState);
  if (!piece || !piece.revealed) {
    return [];
  }

  const actions = [];

  for (const neighborIndex of getAdjacentIndexes(index)) {
    const occupant = getPieceAt(neighborIndex, targetState);

    if (!occupant) {
      actions.push({
        type: "move",
        from: index,
        to: neighborIndex,
      });
      continue;
    }

    if (piece.type !== "cannon" && occupant.revealed && occupant.side !== piece.side && canCapture(piece, occupant)) {
      actions.push({
        type: "capture",
        from: index,
        to: neighborIndex,
      });
    }
  }

  if (piece.type === "cannon") {
    for (const direction of ["up", "down", "left", "right"]) {
      let cursor = step(index, direction);
      let screens = 0;

      while (cursor !== -1) {
        const occupant = getPieceAt(cursor, targetState);

        if (occupant) {
          screens += 1;
          if (screens === 2) {
            if (occupant.revealed && occupant.side !== piece.side) {
              actions.push({
                type: "capture",
                from: index,
                to: cursor,
              });
            }
            break;
          }
        }

        cursor = step(cursor, direction);
      }
    }
  }

  return actions;
}

function canCapture(attacker, defender) {
  if (!defender.revealed || attacker.side === defender.side) {
    return false;
  }

  if (attacker.type === "general" && defender.type === "pawn") {
    return false;
  }

  if (attacker.type === "pawn" && defender.type === "general") {
    return true;
  }

  return PIECE_META[attacker.type].rank >= PIECE_META[defender.type].rank;
}

function getPieceAt(index, targetState = state) {
  const pieceId = targetState.board[index];
  if (pieceId === null || pieceId === undefined) {
    return null;
  }
  return targetState.pieces[pieceId];
}

function getAdjacentIndexes(index) {
  const results = [];
  for (const direction of ["up", "down", "left", "right"]) {
    const next = step(index, direction);
    if (next !== -1) {
      results.push(next);
    }
  }
  return results;
}

function step(index, direction) {
  const { row, col } = indexToCoord(index);

  switch (direction) {
    case "up":
      return row > 0 ? coordToIndex(row - 1, col) : -1;
    case "down":
      return row < BOARD_ROWS - 1 ? coordToIndex(row + 1, col) : -1;
    case "left":
      return col > 0 ? coordToIndex(row, col - 1) : -1;
    case "right":
      return col < BOARD_COLS - 1 ? coordToIndex(row, col + 1) : -1;
    default:
      return -1;
  }
}

function indexToCoord(index) {
  return {
    row: Math.floor(index / BOARD_COLS),
    col: index % BOARD_COLS,
  };
}

function coordToIndex(row, col) {
  return row * BOARD_COLS + col;
}

function getLivePieces(targetState, side) {
  return targetState.pieces.filter((piece) => !piece.captured && piece.side === side);
}

function render(options = {}) {
  const { fullBoard = false } = options;
  syncControls();
  renderBoard(fullBoard);
  renderStatus();
  renderCaptureSummary();
  renderPoolSummary();
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
    action = chooseAiAction(probe);
  } catch (error) {
    console.error("[hint] chooseAiAction threw:", error);
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
    elements.statusTurn.textContent = "AI 思考中";
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
      elements.statusSide.textContent = `你執${SIDE_CHAR[state.humanSide]}，AI 執${SIDE_CHAR[state.aiSide]}。`;
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

function pieceLabelFor(piece) {
  return PIECE_META[piece.type].label[piece.side];
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
