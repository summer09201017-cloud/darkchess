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

bootstrap();

function bootstrap() {
  fillDifficultyOptions();
  bindEvents();
  syncControls();
  render();
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

  const order = shuffle([...Array(BOARD_SIZE).keys()]);
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
    turnCount: 0,
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
    startNewGame("重新洗牌完成，翻開暗子開始新對局。");
  });

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

function startNewGame(message) {
  const settings = loadSettings();
  state = createInitialState({
    ...settings,
    mode: state.mode,
    difficulty: state.difficulty,
    perspective: state.perspective,
  });
  state.message = message;
  saveSettings();
  syncControls();
  render();
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
    render();
    return;
  }

  applyActualAction(state, action);
  state.turnCount += 1;
  state.aiThinking = false;
  finalizeAfterAction();
  render();
}

function chooseAiAction(targetState) {
  const side = targetState.aiSide;
  const level = AI_LEVELS[targetState.difficulty];
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

function render() {
  syncControls();
  renderBoard();
  renderStatus();
  renderCaptureSummary();
  renderPoolSummary();
}

function renderBoard() {
  renderBoardView();
  elements.board.innerHTML = "";

  for (let index = 0; index < BOARD_SIZE; index += 1) {
    const button = document.createElement("button");
    const piece = getPieceAt(index);
    button.type = "button";
    button.className = buildCellClass(index, piece);
    button.dataset.index = String(index);
    button.setAttribute("aria-label", describeCell(index, piece));

    const markerLabel = buildTargetMarker(index);

    if (!piece) {
      button.innerHTML = `<span class="cell__marker">${markerLabel}</span>`;
      elements.board.append(button);
      continue;
    }

    const isHidden = !piece.revealed;
    const pieceColor = isHidden ? "hidden" : piece.side;
    const glyph = isHidden
      ? { char: "暗", type: "FLIP" }
      : {
          char: pieceLabelFor(piece),
          type: PIECE_META[piece.type].shortName,
        };

    button.innerHTML = `
      <span class="piece piece--${pieceColor}">
        <span class="piece__body"></span>
        <span class="piece__top">
          <span class="piece__glyph">
            <span class="piece__char">${glyph.char}</span>
            <span class="piece__type">${glyph.type}</span>
          </span>
        </span>
      </span>
      <span class="cell__marker">${markerLabel}</span>
    `;

    elements.board.append(button);
  }
}

function buildCellClass(index, piece) {
  const classes = ["cell"];

  if (!isLocalActorTurn() || state.aiThinking || state.winner) {
    classes.push("cell--disabled");
  }

  if (state.selectedIndex === index) {
    classes.push("cell--selected");
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

  elements.statusMessage.textContent = state.message;
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
  elements.captureSummary.innerHTML = "";

  for (const side of ["red", "black"]) {
    const live = state.pieces.filter((piece) => !piece.captured && piece.side === side).length;
    const captured = state.pieces.filter((piece) => piece.captured && piece.side === side);
    const wrapper = document.createElement("article");
    wrapper.className = "team-card";

    wrapper.innerHTML = `
      <div class="team-card__head">
        <span class="team-card__title team-card__title--${side}">${SIDE_LABEL[side]}</span>
        <span class="status-mini">剩餘 ${live}</span>
      </div>
      <div class="chip-row">
        ${PIECE_TYPES.map((definition) => {
          const count = captured.filter((piece) => piece.type === definition.type).length;
          const sideLabel = definition.label[side];
          return `<span class="chip ${count === 0 ? "chip--empty" : ""}"><span class="chip__char">${sideLabel}</span>x${count}</span>`;
        }).join("")}
      </div>
    `;

    elements.captureSummary.append(wrapper);
  }
}

function renderPoolSummary() {
  elements.poolSummary.innerHTML = "";

  for (const side of ["red", "black"]) {
    const wrapper = document.createElement("article");
    wrapper.className = "team-card";

    wrapper.innerHTML = `
      <div class="team-card__head">
        <span class="team-card__title team-card__title--${side}">${SIDE_LABEL[side]}未翻開</span>
        <span class="status-mini">${
          state.pieces.filter((piece) => piece.side === side && !piece.revealed && !piece.captured).length
        } 枚</span>
      </div>
      <div class="chip-row">
        ${PIECE_TYPES.map((definition) => {
          const count = state.pieces.filter(
            (piece) => piece.side === side && piece.type === definition.type && !piece.revealed && !piece.captured,
          ).length;
          return `<span class="chip ${count === 0 ? "chip--empty" : ""}"><span class="chip__char">${definition.label[side]}</span>x${count}</span>`;
        }).join("")}
      </div>
    `;

    elements.poolSummary.append(wrapper);
  }
}

function pieceLabelFor(piece) {
  return PIECE_META[piece.type].label[piece.side];
}

function updateInstallHint() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
  const isIos = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

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
