import { AI_CAMP, APP_VIEWS, CAMPS, GAME_MODES } from "./config.js";
import { chooseAiMove, getAiThinkDelay } from "./ai.js";
import { cloneState, createGameState, replaceState } from "./game-state.js";
import { clearAnimationArtifacts, playMoveFeedback } from "./animations.js";
import { loadSettings, playSound, saveSettings, vibrate } from "./audio.js";
import {
  advancePastNoLegalMoves,
  getLegalTargets,
  makeMove
} from "./move-transaction.js";
import { getActiveCamp } from "./rules.js";
import { renderGame, showToast } from "./renderer.js";

let aiTaskRunning = false;
let aiTimerId = null;
let aiTimerResolve = null;

function waitForAi(ms) {
  return new Promise((resolve) => {
    aiTimerResolve = resolve;
    aiTimerId = window.setTimeout(() => {
      aiTimerId = null;
      aiTimerResolve = null;
      resolve(true);
    }, ms);
  });
}

function findPieceAt(state, row, col) {
  return state.pieces.find((piece) => piece.alive && piece.row === row && piece.col === col);
}

function findPieceById(state, pieceId) {
  return state.pieces.find((piece) => piece.alive && piece.id === pieceId);
}

function isAiTurn(state) {
  return (
    state.appView === APP_VIEWS.GAME &&
    state.gameActive &&
    state.mode === GAME_MODES.AI &&
    state.currentCamp === AI_CAMP &&
    !state.gameOver
  );
}

function clearSelection(state) {
  state.selectedPieceId = null;
  state.legalTargets = [];
  state.uiState = "idle";
}

export function stopAiTask(state) {
  if (aiTimerId) {
    window.clearTimeout(aiTimerId);
    aiTimerId = null;
  }

  if (aiTimerResolve) {
    aiTimerResolve(false);
    aiTimerResolve = null;
  }

  aiTaskRunning = false;

  if (state) {
    state.inputLocked = false;
    state.aiThinking = false;
    clearSelection(state);
  }
}

function canCreateAiUndoSnapshot(state) {
  return state.mode === GAME_MODES.AI && (state.undoRemaining ?? 0) > 0 && !state.gameOver;
}

function createAiUndoSnapshot(state) {
  const snapshot = cloneState(state);
  snapshot.uiState = "idle";
  snapshot.selectedPieceId = null;
  snapshot.legalTargets = [];
  snapshot.inputLocked = false;
  snapshot.aiThinking = false;
  snapshot.undoSnapshot = null;
  snapshot.pendingUndoSnapshot = null;
  return snapshot;
}

function canUseAiUndo(state) {
  return (
    state.mode === GAME_MODES.AI &&
    (state.undoRemaining ?? 0) > 0 &&
    Boolean(state.undoSnapshot) &&
    !state.inputLocked &&
    !state.aiThinking &&
    !aiTaskRunning
  );
}

function commitPendingAiUndo(state) {
  if (state.mode !== GAME_MODES.AI || !state.pendingUndoSnapshot || (state.undoRemaining ?? 0) <= 0) {
    state.pendingUndoSnapshot = null;
    return;
  }

  state.undoSnapshot = state.pendingUndoSnapshot;
  state.pendingUndoSnapshot = null;
}

function clearAiUndoCycle(state) {
  state.undoSnapshot = null;
  state.pendingUndoSnapshot = null;
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog?.open) {
    dialog.close();
  }
}

function selectPiece(state, piece) {
  state.selectedPieceId = piece.id;
  state.legalTargets = getLegalTargets(state, piece.id);
  state.uiState = "selected";
  playSound("select", state.settings);
  renderGame(state);
}

function playMoveResultFeedback(state, result) {
  playSound(result.capturedPiece ? "capture" : "move", state.settings);

  if (result.revealed) {
    playSound("reveal", state.settings);
    vibrate("reveal", state.settings);
  } else if (result.capturedPiece) {
    vibrate("capture", state.settings);
  } else {
    vibrate("move", state.settings);
  }

  if (result.delayedThreatCreated) {
    playSound("threat", state.settings);
    vibrate("threat", state.settings);
  }

  if (result.winner) {
    playSound("win", state.settings);
    vibrate("win", state.settings);
  }
}

async function executeMove(state, pieceId, toRow, toCol, actor = "player") {
  state.inputLocked = true;
  const result = makeMove(state, pieceId, toRow, toCol);

  if (!result.ok) {
    state.inputLocked = false;
    state.aiThinking = false;
    showToast(result.reason);
    playSound("illegal", state.settings);
    vibrate("illegal", state.settings);
    renderGame(state);
    return false;
  }

  clearSelection(state);
  renderGame(state);
  playMoveResultFeedback(state, result);
  await playMoveFeedback(result, state.settings);

  state.inputLocked = false;
  state.aiThinking = false;
  renderGame(state);

  if (actor === "ai") {
    showToast("黑方已落子。");
  }

  return true;
}

async function attemptSelectedMove(state, toRow, toCol) {
  const selectedPieceId = state.selectedPieceId;
  if (!selectedPieceId) {
    return;
  }

  const undoSnapshot = canCreateAiUndoSnapshot(state) ? createAiUndoSnapshot(state) : null;
  const moved = await executeMove(state, selectedPieceId, toRow, toCol, "player");
  if (moved) {
    if (undoSnapshot && isAiTurn(state)) {
      state.undoSnapshot = null;
      state.pendingUndoSnapshot = undoSnapshot;
      renderGame(state);
    } else if (state.mode === GAME_MODES.AI) {
      clearAiUndoCycle(state);
      renderGame(state);
    }

    queueAiMove(state);
  }
}

async function runAiMove(state) {
  if (aiTaskRunning || !isAiTurn(state)) {
    return;
  }

  aiTaskRunning = true;
  state.inputLocked = true;
  state.aiThinking = true;
  clearSelection(state);
  state.message = "黑方正在思考。";
  renderGame(state);

  const canContinue = await waitForAi(getAiThinkDelay());
  if (!canContinue) {
    return;
  }

  if (!isAiTurn(state)) {
    state.inputLocked = false;
    state.aiThinking = false;
    aiTaskRunning = false;
    renderGame(state);
    return;
  }

  const move = chooseAiMove(state, AI_CAMP);
  if (!move) {
    advancePastNoLegalMoves(state);
    clearAiUndoCycle(state);
    state.inputLocked = false;
    state.aiThinking = false;
    aiTaskRunning = false;
    renderGame(state);
    queueAiMove(state);
    return;
  }

  state.inputLocked = false;
  state.aiThinking = false;
  const moved = await executeMove(state, move.pieceId, move.row, move.col, "ai");
  aiTaskRunning = false;

  if (moved) {
    commitPendingAiUndo(state);
    renderGame(state);
    queueAiMove(state);
  } else {
    state.pendingUndoSnapshot = null;
    renderGame(state);
  }
}

function queueAiMove(state) {
  if (!isAiTurn(state)) {
    return;
  }
  runAiMove(state);
}

function handleBoardClick(state, event) {
  if (state.mode === GAME_MODES.ONLINE) {
    showToast("在线棋盘已同步，走棋将在下一步开放。");
    return;
  }

  if (state.inputLocked || state.gameOver) {
    return;
  }

  if (isAiTurn(state)) {
    showToast("人机模式下黑方由 AI 操作。");
    return;
  }

  const pieceButton = event.target.closest(".piece");
  const pointButton = event.target.closest(".board-point");
  const row = Number(pieceButton?.dataset.row ?? pointButton?.dataset.row);
  const col = Number(pieceButton?.dataset.col ?? pointButton?.dataset.col);

  if (!Number.isInteger(row) || !Number.isInteger(col)) {
    return;
  }

  const clickedPiece = pieceButton
    ? findPieceById(state, pieceButton.dataset.pieceId)
    : findPieceAt(state, row, col);
  const selectedPiece = findPieceById(state, state.selectedPieceId);

  if (!selectedPiece) {
    if (clickedPiece && getActiveCamp(clickedPiece) === state.currentCamp) {
      selectPiece(state, clickedPiece);
    }
    return;
  }

  if (clickedPiece && clickedPiece.id === selectedPiece.id) {
    clearSelection(state);
    renderGame(state);
    return;
  }

  if (clickedPiece && getActiveCamp(clickedPiece) === state.currentCamp) {
    selectPiece(state, clickedPiece);
    return;
  }

  const isLegal = state.legalTargets.some((target) => target.row === row && target.col === col);
  if (!isLegal) {
    showToast("此处不可落子");
    playSound("illegal", state.settings);
    vibrate("illegal", state.settings);
    return;
  }

  attemptSelectedMove(state, row, col);
}

export function startGame(state, mode = GAME_MODES.LOCAL) {
  stopAiTask(state);
  const settings = state.settings;
  replaceState(
    state,
    createGameState({
      settings,
      mode,
      appView: APP_VIEWS.GAME,
      gameActive: true
    })
  );
  renderGame(state);
  showToast(mode === GAME_MODES.AI ? "人机模式开始，玩家执红。" : "双人模式开始，红方先行。");
  queueAiMove(state);
}

function restart(state, mode = state.mode) {
  startGame(state, mode);
}

export function returnHome(state, { skipConfirm = false } = {}) {
  const shouldConfirm =
    !skipConfirm &&
    state.appView === APP_VIEWS.GAME &&
    state.gameActive &&
    !state.gameOver;

  if (shouldConfirm && !window.confirm("当前棋局尚未结束，确认返回首页吗？")) {
    return false;
  }

  if (state.mode === GAME_MODES.ONLINE) {
    import("./network/online-game-controller.js").then((module) => {
      module.leaveOnlineGame();
    });
  }

  stopAiTask(state);
  clearAnimationArtifacts();
  closeDialog("victoryDialog");
  closeDialog("rulesDialog");

  const settings = state.settings;
  const mode = state.mode ?? GAME_MODES.LOCAL;
  replaceState(
    state,
    createGameState({
      settings,
      mode,
      appView: APP_VIEWS.HOME,
      gameActive: false
    })
  );
  renderGame(state);
  return true;
}

function undoAiTurn(state) {
  if (!canUseAiUndo(state)) {
    showToast("当前没有可用悔棋。人机模式下需要等 AI 落子后才能悔棋。");
    return;
  }

  const snapshot = state.undoSnapshot;
  const settings = state.settings;
  const remaining = Math.max(0, (state.undoRemaining ?? 0) - 1);
  const victoryDialog = document.getElementById("victoryDialog");

  if (victoryDialog?.open) {
    victoryDialog.close();
  }

  replaceState(state, snapshot);
  state.settings = settings;
  state.undoRemaining = remaining;
  clearAiUndoCycle(state);
  state.inputLocked = false;
  state.aiThinking = false;
  clearSelection(state);
  renderGame(state);
  showToast(`已悔棋，剩余 ${remaining} 次。`);
}

function bindSettingToggle(state, id, key) {
  const element = document.getElementById(id);
  if (!element) {
    return;
  }

  element.addEventListener("change", (event) => {
    state.settings = saveSettings({ [key]: event.target.checked });
    renderGame(state);
  });
}

export function bindInput(state) {
  state.settings = { ...state.settings, ...loadSettings() };
  renderGame(state);

  document.getElementById("board").addEventListener("click", (event) => {
    handleBoardClick(state, event);
  });

  document.getElementById("restartBtn").addEventListener("click", () => restart(state));
  document.getElementById("backHomeBtn").addEventListener("click", () => returnHome(state));
  document.getElementById("backBtn").addEventListener("click", () => returnHome(state));
  document.getElementById("undoBtn").addEventListener("click", () => undoAiTurn(state));
  document.getElementById("victoryRestartBtn").addEventListener("click", () => {
    closeDialog("victoryDialog");
    restart(state);
  });
  document.getElementById("victoryUndoBtn").addEventListener("click", () => undoAiTurn(state));
  document.getElementById("rulesBtn").addEventListener("click", () => {
    document.getElementById("rulesDialog").showModal();
  });

  bindSettingToggle(state, "soundToggle", "sound");
  bindSettingToggle(state, "homeSoundToggle", "sound");
  bindSettingToggle(state, "vibrationToggle", "vibration");
  bindSettingToggle(state, "homeVibrationToggle", "vibration");

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      clearSelection(state);
      renderGame(state);
    }
  });

  window.DarkChessDebug = {
    state,
    restart: () => restart(state),
    startGame: (mode) => {
      if (mode === GAME_MODES.LOCAL || mode === GAME_MODES.HUMAN || mode === GAME_MODES.AI) {
        startGame(state, mode);
      }
    },
    returnHome: () => returnHome(state, { skipConfirm: true }),
    forceTurn: (camp) => {
      if (camp === CAMPS.RED || camp === CAMPS.BLACK) {
        state.currentCamp = camp;
        renderGame(state);
        queueAiMove(state);
      }
    }
  };

  queueAiMove(state);
}
