/* banqi-core.js — 雲臺暗棋的**唯一一份**規則 + 搜尋(2026-09-29,v12 真 3D 升級時從 app.js 逐字搬出來)
 *
 * 為什麼抽出來:3D 版要把 AI / 💡 提示的搜尋丟進 Web Worker(ai-worker.js),主執行緒才能在 AI 想棋時照樣轉視角、跑動畫
 *   (skill board3d-kit 坑 ⑦)。Worker 讀不到 app.js(那支頂層就抓 DOM)⇒ 規則與搜尋必須是一支零 DOM 的純模組,
 *   而且**主執行緒、Worker、node 測試三邊共用同一份**——各抄一份就是「一份真相放在贏的那一邊」(board3d-kit 坑 ⑧)。
 * ★ 函式本體與 app.js 784d49e 逐字相同,只改兩處:
 *   ① getPieceAt 不再預設讀全域 state(這裡沒有全域 state;app.js 另有一層預設帶 state 的包裝)
 *   ② Math.random() → rand():預設仍是 Math.random(頁面上覆寫 Math.random 照樣生效),測試 / Worker 可用 setRandom 換成種子亂數
 *   守門:test/core-parity.mjs 拿 test/fixtures/search-golden.json(抽離前錄的 40 局)逐局比 AI 三檔 + 提示的選擇。
 * ★ 暗子資訊:搜尋只用「未翻子池的組成」估翻牌(estimateFlipChoice),從不看某一格底下是誰 ⇒ 交換兩枚暗子,
 *   AI / 提示的選擇不變(test/hidden-invariance.mjs 守)。改搜尋時不可以打破這條。
 * 載入方式:瀏覽器 <script src="banqi-core.js">(→ window.BanqiCore)、Worker importScripts、node require。
 */
(function (root) {
"use strict";
let rand = () => Math.random();
function setRandom(fn) { rand = typeof fn === "function" ? fn : () => Math.random(); }

const BOARD_COLS = 4;
const BOARD_ROWS = 8;
const BOARD_SIZE = BOARD_COLS * BOARD_ROWS;

const WIN_SCORE = 100000;

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

/* 💡 提示專用的檔位:最深、而且**零隨機**。
   ⚠ 刻意不放進 AI_LEVELS —— 難度下拉是直接遍歷 AI_LEVELS 生出來的(見 renderDifficultyOptions),
     放進去會多一個玩家選得到的假難度。
   為什麼一定要零隨機:chooseAiAction 會加 (rand-0.5)*randomness*70 的噪音、
   還會從 topChoices 裡隨機挑 ⇒ 同一個局面按兩次會給不同的手,看起來像跳針。
   randomness 0 + topChoices 1 ⇒ 噪音項是 0、pool 只有一個、rand() < 0 恆假。 */
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

    score += (rand() - 0.5) * level.randomness * 70;
    return { action, score };
  });

  scored.sort((left, right) => right.score - left.score);
  const pool = scored.slice(0, Math.max(1, Math.min(level.topChoices, scored.length)));

  if (pool.length > 1 && rand() < level.randomness) {
    return pool[Math.floor(rand() * pool.length)].action;
  }

  return pool[0].action;
}

/* ══════════ 💡 提示品質三件套(2026-09-07)══════════
   使用者退件(先在 3D 幻影西洋棋抓到,全棋類體檢後確認本站也有):
   「提示叫我吃掉某顆,吃完我又被對手其他棋子吃掉,等於交換被吃」。本站的兩條病因:
     ① 同分偏好吃子:scored.sort 是穩定排序,平手時就照 orderActionsForSearch 的順序,
        而那支把吃子(value × 1.2)排在最前面 ⇒ 一堆同分裡永遠是吃子勝出;
     ② 葉子沒有靜態搜尋 ⇒ 水平線效應(見 minimax 內註解)。
   修法與西洋棋兩站(3dchess-an v9 / 3dchesscodex v24)、中國象棋站同一條規則:
     quiesceCaptures(算到底)+ captureGain(子力真的有賺)+ HINT_TRADE_MARGIN(多賺半個兵)。
   ★ 誠實寫下缺點:少數「換掉對方關鍵防守子」的等價交換也會被跳過,提示因此偏保守——
     這是為了不教壞初學者刻意付的代價(使用者 2026-09-07 拍板)。 */
const HINT_QUIESCE_DEPTH = 3;
const HINT_TRADE_MARGIN = 60;      // 半個兵(兵=120)

/** 只算「已翻開」的子力(暗棋的吃子鏈碰不到蓋著的子,所以蓋著的算 0,差值不受影響) */
function revealedMaterial(targetState, side) {
  let score = 0;

  for (const piece of targetState.pieces) {
    if (piece.captured || !piece.revealed) {
      continue;
    }
    score += (piece.side === side ? 1 : -1) * PIECE_META[piece.type].value;
  }

  return score;
}

/** 只走吃子、只看子力,算到沒人想再吃(side 視角,越大越好) */
function materialQuiesce(targetState, side, alpha, beta, deadline, depth) {
  const stand = revealedMaterial(targetState, side);

  if (depth <= 0 || performance.now() > deadline) {
    return stand;
  }

  const sideToMove = targetState.turnSide;
  const maximizing = sideToMove === side;
  let best = stand;

  if (maximizing) {
    if (best >= beta) return best;
    if (best > alpha) alpha = best;
  } else {
    if (best <= alpha) return best;
    if (best < beta) beta = best;
  }

  const caps = getLegalActions(targetState, sideToMove).filter((action) => action.type === "capture");

  if (!caps.length) {
    return best;
  }

  for (const action of orderActionsForSearch(targetState, caps, sideToMove, side)) {
    const next = cloneState(targetState);
    applySearchAction(next, action);
    const score = materialQuiesce(next, side, alpha, beta, deadline, depth - 1);

    if (maximizing) {
      if (score > best) best = score;
      if (best > alpha) alpha = best;
    } else {
      if (score < best) best = score;
      if (best < beta) beta = best;
    }

    if (beta <= alpha || performance.now() > deadline) break;
  }

  return best;
}

/** 走了這一手吃子之後,把交換算到底,對走棋方的淨子力(>0 賺、=0 等價、<0 虧) */
function captureGain(targetState, action, side) {
  const before = revealedMaterial(targetState, side);
  const next = cloneState(targetState);
  applySearchAction(next, action);
  const after = materialQuiesce(next, side, -Infinity, Infinity, performance.now() + 150, HINT_QUIESCE_DEPTH + 2);
  return after - before;
}

/** 靜態搜尋:葉子只繼續走吃子(含完整評估),直到局面安靜 */
function quiesceCaptures(targetState, aiSide, alpha, beta, deadline, depth) {
  const outcome = detectWinner(targetState);

  if (outcome) {
    return outcome.side === aiSide ? WIN_SCORE - targetState.turnCount : -WIN_SCORE + targetState.turnCount;
  }

  const stand = evaluateState(targetState, aiSide);

  if (depth <= 0 || performance.now() > deadline) {
    return stand;
  }

  const sideToMove = targetState.turnSide;
  const maximizing = sideToMove === aiSide;
  let best = stand;

  if (maximizing) {
    if (best >= beta) return best;
    if (best > alpha) alpha = best;
  } else {
    if (best <= alpha) return best;
    if (best < beta) beta = best;
  }

  const caps = getLegalActions(targetState, sideToMove).filter((action) => action.type === "capture");

  if (!caps.length) {
    return best;
  }

  for (const action of orderActionsForSearch(targetState, caps, sideToMove, aiSide)) {
    const next = cloneState(targetState);
    applySearchAction(next, action);
    const score = quiesceCaptures(next, aiSide, alpha, beta, deadline, depth - 1);

    if (maximizing) {
      if (score > best) best = score;
      if (best > alpha) alpha = best;
    } else {
      if (score < best) best = score;
      if (best < beta) beta = best;
    }

    if (beta <= alpha || performance.now() > deadline) break;
  }

  return best;
}

/* 💡 提示專用挑手:兩段式。
   先把「不吃子的手」(移動 + 翻牌)搜完拿到最好的安靜手,再搜吃子 —— 而且吃子要同時過兩關:
     ① 子力關 captureGain > 0(吃將例外,那是直接贏)
     ② 分數關 比最好的安靜手多賺 HINT_TRADE_MARGIN
   贏不過就寧可建議走位。零隨機(HINT_LEVEL 的 randomness=0、topChoices=1 本來就是),
   所以同一個局面按幾次都給同一手。 */
function chooseHintAction(targetState) {
  const side = targetState.aiSide;
  const level = targetState.hintLevel || HINT_LEVEL;
  const deadline = performance.now() + level.thinkMs;
  const all = getLegalActions(targetState, side);

  if (!all.length) {
    return null;
  }

  const scoreOf = (action, floor) => {
    if (action.type === "flip") {
      // 翻牌翻到什麼是隨機的,搜不下去 —— 沿用 chooseAiAction 的期望值估計
      return evaluateState(targetState, side) + estimateFlipChoice(targetState, action.index, side, side);
    }
    const next = cloneState(targetState);
    applySearchAction(next, action);
    return minimax(next, level.depth - 1, side, floor, Infinity, deadline);
  };

  const quiet = all.filter((action) => action.type !== "capture");
  const noisyAll = all.filter((action) => action.type === "capture");
  const winning = noisyAll.filter((action) => {
    const victim = getPieceAt(action.to, targetState);
    if (victim && victim.type === "general") return true;      // 吃將=贏,一定要推薦
    return captureGain(targetState, action, side) > 0;
  });
  /* 只有「還有安靜手可退」時才敢把沒賺頭的吃子濾光;不然沒棋可推薦了 */
  const noisy = (winning.length || quiet.length) ? winning : noisyAll;

  let best = null;
  let bestScore = -Infinity;
  for (const action of orderActionsForSearch(targetState, quiet, side, side)) {
    const score = scoreOf(action, -Infinity);
    if (score > bestScore) { bestScore = score; best = action; }
  }

  const floor = best ? bestScore + HINT_TRADE_MARGIN : -Infinity;
  let bestNoisy = null;
  let bestNoisyScore = floor;
  for (const action of orderActionsForSearch(targetState, noisy, side, side)) {
    const score = scoreOf(action, bestNoisyScore);
    if (score > bestNoisyScore) { bestNoisyScore = score; bestNoisy = action; }
  }

  return bestNoisy || best || all[0];
}

function minimax(targetState, depth, aiSide, alpha, beta, deadline) {
  const outcome = detectWinner(targetState);
  if (outcome) {
    return outcome.side === aiSide ? WIN_SCORE - targetState.turnCount : -WIN_SCORE + targetState.turnCount;
  }

  if (depth <= 0 || performance.now() > deadline) {
    /* ★ 葉子不可以停在「吃到一半」的局面(2026-09-07 全棋類提示體檢)。
       深度 3 是奇數層,「我吃 → 他回吃 → 我再吃」到此為止看起來賺,第 4 步他再吃回來看不到
       (水平線效應)⇒ 提示會叫人做虧本交換。evaluateState 對「被威脅的子」扣 18% 只擋得住一部分。
       改成:到葉子後只繼續走**吃子**,直到沒得吃為止。 */
    return quiesceCaptures(targetState, aiSide, alpha, beta, deadline, HINT_QUIESCE_DEPTH);
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

function getPieceAt(index, targetState) {
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

function pieceLabelFor(piece) {
  return PIECE_META[piece.type].label[piece.side];
}

const api = {
  setRandom,
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
  getPieceAt,
  getAdjacentIndexes,
  step,
  indexToCoord,
  coordToIndex,
  getLivePieces,
  pieceLabelFor,
};
root.BanqiCore = api;
if (typeof module === "object" && module.exports) module.exports = api;
})(typeof self !== "undefined" ? self : globalThis);
