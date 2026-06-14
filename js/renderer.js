import { APP_VIEWS, CAMP_NAMES, GAME_MODES, PHASES, TYPE_NAMES, getPieceLabel } from "./config.js";
import { getLogicPhase } from "./delayed-threat.js";
import { findGeneral, getAttackersToGeneral, isGeneralUnderAttack } from "./attacks.js";
import { getActiveCamp } from "./rules.js";

const boardSvg = `
  <div class="board-inner">
    <svg class="board-lines" viewBox="0 0 8 9" preserveAspectRatio="none" aria-hidden="true">
      ${Array.from({ length: 10 }, (_, row) => `<line x1="0" y1="${row}" x2="8" y2="${row}" />`).join("")}
      <line x1="0" y1="0" x2="0" y2="9" />
      <line x1="8" y1="0" x2="8" y2="9" />
      ${Array.from({ length: 7 }, (_, index) => {
        const col = index + 1;
        return `<line x1="${col}" y1="0" x2="${col}" y2="4" /><line x1="${col}" y1="5" x2="${col}" y2="9" />`;
      }).join("")}
      <path d="M3 0 L5 2 M5 0 L3 2 M3 7 L5 9 M5 7 L3 9" />
      <text class="river-label" x="1.25" y="4.63">楚河</text>
      <text class="river-label" x="5.65" y="4.63">汉界</text>
    </svg>
  </div>
`;

const BOARD_COORDINATES = {
  maxCol: 8,
  maxRow: 9
};

function getElement(id) {
  return document.getElementById(id);
}

let victoryDialogTimer = null;
let queuedVictoryKey = null;

export function getIntersectionPosition(row, col) {
  return {
    xPercent: (col / BOARD_COORDINATES.maxCol) * 100,
    yPercent: (row / BOARD_COORDINATES.maxRow) * 100
  };
}

function pointStyle(row, col) {
  const position = getIntersectionPosition(row, col);
  return `--point-x:${position.xPercent}%;--point-y:${position.yPercent}%;left:var(--point-x);top:var(--point-y)`;
}

function createLineStyle(from, to) {
  const start = getIntersectionPosition(from.row, from.col);
  const end = getIntersectionPosition(to.row, to.col);
  const dx = end.xPercent - start.xPercent;
  const dy = end.yPercent - start.yPercent;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  return `--line-x:${start.xPercent}%;--line-y:${start.yPercent}%;--line-length:${length}%;--line-angle:${angle}rad`;
}

function getPieceText(piece) {
  if (!piece.faceUp) {
    return "暗";
  }
  return getPieceLabel(piece.realType, piece.realCamp);
}

function isSelected(state, piece) {
  return state.selectedPieceId === piece.id;
}

function isLegalTarget(state, row, col) {
  return state.legalTargets.find((target) => target.row === row && target.col === col);
}

function getThreatClasses(state, piece) {
  const classes = [];
  const delayed = state.delayedThreat;

  if (delayed?.active && piece.id === delayed.triggerPieceId) {
    classes.push("delayed-trigger");
  }

  if (delayed?.active) {
    const protectedGeneral = findGeneral(state.pieces, delayed.protectedCamp);
    if (protectedGeneral?.id === piece.id) {
      classes.push("protected-general");
    }
  } else if (
    piece.realType === "general" &&
    isGeneralUnderAttack(state.pieces, piece.realCamp)
  ) {
    classes.push("in-check");
  }

  return classes.join(" ");
}

function renderCheckEffects(state, boardInner) {
  if (
    state.gameOver ||
    state.delayedThreat?.active ||
    !isGeneralUnderAttack(state.pieces, state.currentCamp)
  ) {
    return;
  }

  const general = findGeneral(state.pieces, state.currentCamp);
  if (!general) {
    return;
  }

  const layer = document.createElement("div");
  layer.className = "check-effect-layer";
  layer.setAttribute("aria-hidden", "true");

  getAttackersToGeneral(state.pieces, state.currentCamp).forEach((attacker) => {
    const line = document.createElement("span");
    line.className = "check-attack-line";
    line.style.cssText = createLineStyle(attacker, general);
    layer.append(line);
  });

  const seal = document.createElement("span");
  seal.className = "check-seal";
  seal.style.cssText = pointStyle(general.row, general.col);
  seal.textContent = "将";
  layer.append(seal);
  boardInner.append(layer);
}

function renderFinalStrikeEffect(state, boardInner) {
  if (!state.gameOver) {
    return;
  }

  const point = state.lastMove?.to ?? { row: 4.5, col: 4 };
  const layer = document.createElement("div");
  layer.className = "final-strike-layer";
  layer.setAttribute("aria-hidden", "true");

  const burst = document.createElement("span");
  burst.className = "final-ink-burst";
  burst.style.cssText = pointStyle(point.row, point.col);

  const title = document.createElement("span");
  title.className = "final-strike-title";
  title.textContent = "绝杀";

  const caption = document.createElement("span");
  caption.className = "final-strike-caption";
  caption.textContent = `${CAMP_NAMES[state.winner]}吃掉将帅`;

  layer.append(burst, title, caption);
  boardInner.append(layer);
}

function renderBoard(state) {
  const board = getElement("board");
  board.classList.remove("board-load-failed");
  board.innerHTML = boardSvg;
  const boardInner = board.querySelector(".board-inner");
  renderCheckEffects(state, boardInner);
  renderFinalStrikeEffect(state, boardInner);

  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 9; col += 1) {
      const legalTarget = isLegalTarget(state, row, col);
      const point = document.createElement("button");
      point.type = "button";
      point.className = `board-point ${legalTarget ? (legalTarget.capture ? "legal-capture" : "legal-dot") : ""}`;
      point.dataset.row = String(row);
      point.dataset.col = String(col);
      point.style.cssText = pointStyle(row, col);
      point.setAttribute("aria-label", `第${row + 1}行第${col + 1}列`);
      boardInner.append(point);
    }
  }

  state.pieces
    .filter((piece) => piece.alive)
    .forEach((piece) => {
      const button = document.createElement("button");
      const activeCamp = getActiveCamp(piece);
      button.type = "button";
      button.className = [
        "piece",
        piece.faceUp ? piece.realCamp : "hidden",
        isSelected(state, piece) ? "selected" : "",
        getThreatClasses(state, piece)
      ]
        .filter(Boolean)
        .join(" ");
      button.dataset.pieceId = piece.id;
      button.dataset.row = String(piece.row);
      button.dataset.col = String(piece.col);
      button.style.cssText = pointStyle(piece.row, piece.col);
      button.disabled = state.inputLocked;
      button.setAttribute(
        "aria-label",
        piece.faceUp
          ? `${CAMP_NAMES[piece.realCamp]}${TYPE_NAMES[piece.realType]}`
          : `${CAMP_NAMES[activeCamp]}控制的暗棋`
      );
      button.innerHTML = `<span>${getPieceText(piece)}</span>`;
      boardInner.append(button);
    });
}

function renderCapturedList(state, camp) {
  const element = getElement(camp === "red" ? "redCaptured" : "blackCaptured");
  const captured = state.captured.filter((record) => record.displayCamp === camp);

  if (captured.length === 0) {
    element.innerHTML = `<span class="muted">暂无</span>`;
    return;
  }

  element.innerHTML = captured
    .map((record) => {
      const text = record.faceUp
        ? getPieceLabel(record.displayType, record.displayCamp)
        : "暗";
      const title = record.faceUp
        ? `${CAMP_NAMES[record.displayCamp]}${TYPE_NAMES[record.displayType]}`
        : `未翻暗棋，临时身份：${TYPE_NAMES[record.initialRole]}`;
      return `<span class="captured-chip ${record.displayCamp}" title="${title}">${text}</span>`;
    })
    .join("");
}

function getSpecialText(state) {
  const phase = getLogicPhase(state);
  const delayed = state.delayedThreat;

  if (state.gameOver) {
    return `<strong>${CAMP_NAMES[state.winner]}获胜</strong><br>将或帅已被合法吃掉。`;
  }

  if (state.aiThinking) {
    return `<strong>黑方思考中</strong><br>AI 正在从当前所有合法着法中选择一步。`;
  }

  if (phase === PHASES.RESTRICTED && delayed) {
    return `<strong>潜在威胁</strong><br>${CAMP_NAMES[delayed.restrictedCamp]}行动，本回合不能对${CAMP_NAMES[delayed.protectedCamp]}将帅形成新的将军。`;
  }

  if (phase === PHASES.ADJUSTMENT && delayed) {
    return `<strong>调整回合</strong><br>${CAMP_NAMES[delayed.protectedCamp]}请在本回合结束前解除潜在威胁。`;
  }

  if (isGeneralUnderAttack(state.pieces, state.currentCamp)) {
    return `<strong class="danger">将军</strong><br>当前玩家必须解除将帅受到的攻击。`;
  }

  return `<strong>普通回合</strong><br>${state.message}`;
}

function getStateLabel(state) {
  const phase = getLogicPhase(state);
  if (state.gameOver) {
    return "终局";
  }
  if (state.aiThinking) {
    return "AI 思考";
  }
  if (phase === PHASES.RESTRICTED) {
    return "潜在威胁";
  }
  if (phase === PHASES.ADJUSTMENT) {
    return "调整回合";
  }
  if (isGeneralUnderAttack(state.pieces, state.currentCamp)) {
    return "将军";
  }
  return "普通";
}

function renderStatus(state) {
  getElement("turnText").textContent = state.gameOver
    ? "游戏结束"
    : `${CAMP_NAMES[state.currentCamp]}行动`;
  const modeText = getElement("modeText");
  const stateText = getElement("stateText");
  if (modeText) {
    modeText.textContent = state.mode === GAME_MODES.AI ? "人机模式" : "双人模式";
  }
  if (stateText) {
    stateText.textContent = getStateLabel(state);
  }
  getElement("statusPanel").innerHTML = getSpecialText(state);
}

function renderSelectionInfo(state) {
  const element = getElement("selectionInfo");
  const piece = state.pieces.find((item) => item.id === state.selectedPieceId && item.alive);

  if (!piece) {
    element.innerHTML = "选择棋子后会显示可走位置。暗棋不会提前公开真实身份。";
    return;
  }

  if (!piece.faceUp) {
    element.innerHTML = `
      <strong>当前临时职能：</strong>${TYPE_NAMES[piece.initialRole]}<br>
      <strong>当前临时阵营：</strong>${CAMP_NAMES[piece.initialCamp]}<br>
      首次行动结束后将揭示真实身份
    `;
    return;
  }

  element.innerHTML = `
    <strong>当前棋子：</strong>${CAMP_NAMES[piece.realCamp]}·${TYPE_NAMES[piece.realType]}<br>
    按真实身份行动
  `;
}

function renderVictory(state) {
  const dialog = getElement("victoryDialog");
  if (!dialog) {
    return;
  }

  if (state.gameOver && !dialog.open) {
    getElement("victoryTitle").textContent = `卧底象棋：${CAMP_NAMES[state.winner]}获胜`;
    getElement("victoryText").textContent = "将或帅被合法吃掉，本局结束。";
    const victoryKey = `${state.winner}-${state.lastMove?.pieceId ?? "move"}-${state.moveCount}`;
    if (queuedVictoryKey !== victoryKey) {
      window.clearTimeout(victoryDialogTimer);
      queuedVictoryKey = victoryKey;
      victoryDialogTimer = window.setTimeout(() => {
        if (state.gameOver && !dialog.open) {
          dialog.showModal();
        }
      }, 860);
    }
  }

  if (!state.gameOver && dialog.open) {
    dialog.close();
  }

  if (!state.gameOver) {
    window.clearTimeout(victoryDialogTimer);
    victoryDialogTimer = null;
    queuedVictoryKey = null;
  }
}

function canUseAiUndo(state) {
  return (
    state.mode === GAME_MODES.AI &&
    (state.undoRemaining ?? 0) > 0 &&
    Boolean(state.undoSnapshot) &&
    !state.inputLocked &&
    !state.aiThinking
  );
}

function renderUndoControls(state) {
  const remaining = Math.max(0, state.undoRemaining ?? 0);
  const enabled = canUseAiUndo(state);
  const label = state.mode === GAME_MODES.AI ? `悔棋（${remaining}）` : "悔棋";
  const buttons = [getElement("undoBtn"), getElement("victoryUndoBtn")].filter(Boolean);

  buttons.forEach((button) => {
    button.textContent = label;
    button.disabled = !enabled;
    button.title =
      state.mode === GAME_MODES.AI
        ? "人机模式下，可在 AI 落子后撤回上一轮行动。"
        : "悔棋仅在人机模式中开放。";
  });
}

function setChecked(id, checked) {
  const element = getElement(id);
  if (element) {
    element.checked = checked;
  }
}

function renderAppView(state) {
  const appView = state.appView ?? APP_VIEWS.HOME;
  const isGameView = appView === APP_VIEWS.GAME;
  const homeView = getElement("homeView");
  const gameView = getElement("gameView");

  document.body.dataset.view = appView;

  if (homeView) {
    homeView.hidden = isGameView;
  }

  if (gameView) {
    gameView.hidden = !isGameView;
  }

  setChecked("homeSoundToggle", state.settings.sound);
  setChecked("homeVibrationToggle", state.settings.vibration);
  setChecked("soundToggle", state.settings.sound);
  setChecked("vibrationToggle", state.settings.vibration);
}

export function renderGame(state) {
  renderAppView(state);

  if ((state.appView ?? APP_VIEWS.HOME) !== APP_VIEWS.GAME) {
    return;
  }

  renderStatus(state);
  renderBoard(state);
  renderCapturedList(state, "red");
  renderCapturedList(state, "black");
  renderSelectionInfo(state);
  renderVictory(state);
  renderUndoControls(state);
}

let toastTimer = null;
export function showToast(message) {
  const toast = getElement("toast");
  if (!toast) {
    return;
  }

  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 1800);
}
