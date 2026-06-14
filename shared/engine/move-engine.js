import { CAMPS, PHASES, PIECE_TYPES, opponentCamp } from "./config.js";
import { getRiverSide } from "./board.js";
import { cloneState } from "./game-state.js";
import { createCapturedRecord } from "./pieces.js";
import { getActiveCamp, getAllTargetPoints, getPieceAt, validateBasicMove } from "./rules.js";
import {
  canPieceAttackSquare,
  findGeneral,
  getAttackersToGeneral,
  isGeneralFaceToFace,
  isGeneralUnderAttack
} from "./attacks.js";
import {
  createDelayedThreat,
  getLogicPhase,
  isFrozenTriggerAttacker
} from "./delayed-threat.js";

function findAlivePiece(state, pieceId) {
  return state.pieces.find((piece) => piece.id === pieceId && piece.alive);
}

function findAlivePieceAt(state, row, col) {
  return state.pieces.find((piece) => piece.alive && piece.row === row && piece.col === col);
}

function isGeneralPiece(piece) {
  return piece?.realType === PIECE_TYPES.GENERAL;
}

function isCampSafe(pieces, camp) {
  return !isGeneralUnderAttack(pieces, camp);
}

function buildMoveMessage(result) {
  if (result.winner) {
    return `${result.winner === CAMPS.RED ? "红方" : "黑方"}吃掉将帅，游戏结束。`;
  }

  if (result.delayedThreatCreated) {
    return "潜在威胁：该攻击暂时冻结，受保护方稍后获得调整机会。";
  }

  if (result.revealed) {
    return "暗棋已揭示，控制权按真实阵营生效。";
  }

  if (result.capturedPiece) {
    return "吃子完成。";
  }

  return "行动完成。";
}

function normalizeMove(state, move) {
  if (move.pieceId) {
    return {
      pieceId: move.pieceId,
      toRow: move.toRow ?? move.to?.row,
      toCol: move.toCol ?? move.to?.col
    };
  }

  if (move.from) {
    const piece = findAlivePieceAt(state, move.from.row, move.from.col);
    return {
      pieceId: piece?.id ?? null,
      toRow: move.to?.row,
      toCol: move.to?.col
    };
  }

  return {
    pieceId: null,
    toRow: move.toRow ?? move.row,
    toCol: move.toCol ?? move.col
  };
}

function detectDelayedThreat(sourceState, workState, movedPiece, moverCamp, wasDarkFirst) {
  const beforeSafe =
    isCampSafe(sourceState.pieces, moverCamp) && !isGeneralFaceToFace(sourceState.pieces);

  if (!beforeSafe || !wasDarkFirst || movedPiece.realCamp === moverCamp) {
    return null;
  }

  const attackers = getAttackersToGeneral(workState.pieces, moverCamp);
  const ownGeneral = findGeneral(workState.pieces, moverCamp);
  if (
    attackers.length !== 1 ||
    attackers[0].id !== movedPiece.id ||
    !ownGeneral ||
    !canPieceAttackSquare(workState.pieces, movedPiece, ownGeneral.row, ownGeneral.col)
  ) {
    return null;
  }

  return createDelayedThreat({
    protectedCamp: moverCamp,
    restrictedCamp: movedPiece.realCamp,
    triggerPieceId: movedPiece.id,
    triggerRow: movedPiece.row,
    triggerCol: movedPiece.col
  });
}

function validateRestrictedTurn(workState, moverCamp, target) {
  const delayedThreat = workState.delayedThreat;

  if (target && isGeneralPiece(target) && target.realCamp === delayedThreat.protectedCamp) {
    return { ok: false, reason: "延迟保护期间不能直接吃掉将帅" };
  }

  if (!isCampSafe(workState.pieces, moverCamp)) {
    return { ok: false, reason: "该行动会让自己的将帅受到攻击" };
  }

  const protectedAttackers = getAttackersToGeneral(
    workState.pieces,
    delayedThreat.protectedCamp
  );
  const illegalAttackers = protectedAttackers.filter(
    (attacker) => !isFrozenTriggerAttacker(delayedThreat, attacker)
  );

  if (illegalAttackers.length > 0) {
    return { ok: false, reason: "延迟保护期间不能形成新的将军" };
  }

  return { ok: true };
}

function validateAdjustmentTurn(workState, protectedCamp) {
  if (!isCampSafe(workState.pieces, protectedCamp)) {
    return { ok: false, reason: "调整回合结束时必须解除潜在威胁" };
  }
  return { ok: true };
}

function applyMoveToWorkState(workState, piece, toRow, toCol, moverCamp, validation) {
  const wasDarkFirst = !piece.faceUp;
  const target = validation.target;
  let capturedRecord = null;

  if (target) {
    capturedRecord = createCapturedRecord(target, moverCamp);
    target.alive = false;
  }

  const from = { row: piece.row, col: piece.col };
  piece.row = toRow;
  piece.col = toCol;
  piece.hasActed = true;

  if (wasDarkFirst) {
    piece.faceUp = true;
    if (piece.realType === PIECE_TYPES.ELEPHANT) {
      piece.lockedRiverSide = getRiverSide(piece.row);
    }
  }

  if (capturedRecord) {
    workState.captured.push(capturedRecord);
  }

  return {
    from,
    to: { row: toRow, col: toCol },
    wasDarkFirst,
    target,
    capturedRecord
  };
}

function finishNormalTurn(sourceState, workState, movedPiece, moverCamp, context) {
  if (!isCampSafe(workState.pieces, moverCamp)) {
    const delayedThreat = detectDelayedThreat(
      sourceState,
      workState,
      movedPiece,
      moverCamp,
      context.wasDarkFirst
    );

    if (!delayedThreat) {
      return { ok: false, reason: "该行动会让自己的将帅受到攻击" };
    }

    workState.delayedThreat = delayedThreat;
    workState.currentCamp = delayedThreat.restrictedCamp;
    workState.phase = PHASES.RESTRICTED;
    return { ok: true, delayedThreatCreated: true };
  }

  workState.currentCamp = opponentCamp(moverCamp);
  workState.phase = PHASES.NORMAL;
  return { ok: true };
}

function finishRestrictedTurn(workState, moverCamp, context) {
  const restrictedCheck = validateRestrictedTurn(workState, moverCamp, context.target);
  if (!restrictedCheck.ok) {
    return restrictedCheck;
  }

  workState.delayedThreat.phase = "adjustment-turn";
  workState.currentCamp = workState.delayedThreat.protectedCamp;
  workState.phase = PHASES.ADJUSTMENT;
  return { ok: true };
}

function finishAdjustmentTurn(workState) {
  const protectedCamp = workState.delayedThreat.protectedCamp;
  const adjustmentCheck = validateAdjustmentTurn(workState, protectedCamp);
  if (!adjustmentCheck.ok) {
    return adjustmentCheck;
  }

  workState.delayedThreat = null;
  workState.currentCamp = opponentCamp(protectedCamp);
  workState.phase = PHASES.NORMAL;
  return { ok: true, threatResolved: true };
}

export function evaluateMove(sourceState, pieceId, toRow, toCol) {
  const workState = cloneState(sourceState);
  const piece = findAlivePiece(workState, pieceId);
  const sourcePiece = findAlivePiece(sourceState, pieceId);

  if (sourceState.gameOver || getLogicPhase(sourceState) === PHASES.GAME_OVER) {
    return { ok: false, reason: "游戏已经结束" };
  }

  if (!piece || !sourcePiece) {
    return { ok: false, reason: "棋子不存在" };
  }

  const moverCamp = getActiveCamp(piece);
  if (moverCamp !== workState.currentCamp) {
    return { ok: false, reason: "现在不是这枚棋子的回合" };
  }

  const validation = validateBasicMove(workState, piece, toRow, toCol);
  if (!validation.ok) {
    return validation;
  }

  const context = applyMoveToWorkState(workState, piece, toRow, toCol, moverCamp, validation);

  if (isGeneralFaceToFace(workState.pieces)) {
    return { ok: false, reason: "该行动会导致将帅照面" };
  }

  if (!isCampSafe(workState.pieces, moverCamp)) {
    const phase = getLogicPhase(sourceState);
    if (
      !(phase === PHASES.NORMAL && context.wasDarkFirst) &&
      phase !== PHASES.ADJUSTMENT
    ) {
      return { ok: false, reason: "该行动会让自己的将帅受到攻击" };
    }
  }

  const capturedGeneral =
    context.target && isGeneralPiece(context.target) && context.target.realCamp !== moverCamp;

  let phaseResult;
  const logicPhase = getLogicPhase(sourceState);
  if (logicPhase === PHASES.RESTRICTED) {
    phaseResult = finishRestrictedTurn(workState, moverCamp, context);
  } else if (capturedGeneral) {
    if (!isCampSafe(workState.pieces, moverCamp)) {
      return { ok: false, reason: "该行动会让自己的将帅受到攻击" };
    }
    workState.gameOver = true;
    workState.winner = moverCamp;
    workState.currentCamp = moverCamp;
    workState.phase = PHASES.GAME_OVER;
    workState.delayedThreat = null;
    phaseResult = { ok: true };
  } else if (logicPhase === PHASES.ADJUSTMENT) {
    phaseResult = finishAdjustmentTurn(workState);
  } else {
    phaseResult = finishNormalTurn(sourceState, workState, piece, moverCamp, context);
  }

  if (!phaseResult.ok) {
    return phaseResult;
  }

  workState.moveCount += 1;

  const result = {
    ok: true,
    state: workState,
    pieceId,
    from: context.from,
    to: context.to,
    capturedPiece: context.capturedRecord,
    capturedPieceId: context.target?.id ?? null,
    revealed: context.wasDarkFirst,
    revealedType: context.wasDarkFirst ? piece.realType : null,
    revealedCamp: context.wasDarkFirst ? piece.realCamp : null,
    delayedThreatCreated: Boolean(phaseResult.delayedThreatCreated),
    threatResolved: Boolean(phaseResult.threatResolved),
    winner: workState.winner,
    events: []
  };

  workState.lastMove = {
    pieceId,
    from: context.from,
    to: context.to,
    capturedPieceId: result.capturedPieceId,
    revealed: result.revealed,
    delayedThreatCreated: result.delayedThreatCreated
  };
  workState.message = buildMoveMessage(result);

  return result;
}

export function getLegalTargets(state, pieceId) {
  const piece = findAlivePiece(state, pieceId);
  if (!piece || getActiveCamp(piece) !== state.currentCamp) {
    return [];
  }

  return getAllTargetPoints()
    .map((point) => {
      const result = evaluateMove(state, pieceId, point.row, point.col);
      if (!result.ok) {
        return null;
      }
      const target = getPieceAt(state.pieces, point.row, point.col, pieceId);
      return {
        row: point.row,
        col: point.col,
        capture: Boolean(target),
        targetId: target?.id ?? null
      };
    })
    .filter(Boolean);
}

export function getLegalMoves(state, camp = state.currentCamp) {
  const moves = [];

  state.pieces.forEach((piece) => {
    if (!piece.alive || getActiveCamp(piece) !== camp) {
      return;
    }

    getLegalTargets(state, piece.id).forEach((target) => {
      moves.push({
        pieceId: piece.id,
        from: { row: piece.row, col: piece.col },
        to: { row: target.row, col: target.col },
        capture: target.capture,
        targetId: target.targetId
      });
    });
  });

  return moves;
}

export function hasAnyLegalMove(state, camp = state.currentCamp) {
  return state.pieces.some((piece) => {
    if (!piece.alive || getActiveCamp(piece) !== camp) {
      return false;
    }
    return getLegalTargets(state, piece.id).length > 0;
  });
}

export function advancePastNoLegalMoves(state) {
  const events = [];
  let guard = 0;

  while (!state.gameOver && guard < 4 && !hasAnyLegalMove(state, state.currentCamp)) {
    guard += 1;
    const phase = getLogicPhase(state);

    if (phase === PHASES.RESTRICTED && state.delayedThreat?.active) {
      events.push("限制方没有合法行动，自动进入调整回合。");
      state.delayedThreat.phase = "adjustment-turn";
      state.currentCamp = state.delayedThreat.protectedCamp;
      state.phase = PHASES.ADJUSTMENT;
      continue;
    }

    if (phase === PHASES.ADJUSTMENT && state.delayedThreat?.active) {
      const nextCamp = state.delayedThreat.restrictedCamp;
      events.push("受保护方没有可解除威胁的合法行动，延迟保护结束。");
      state.delayedThreat = null;
      state.currentCamp = nextCamp;
      state.phase = PHASES.NORMAL;
      continue;
    }

    events.push(`${state.currentCamp === CAMPS.RED ? "红方" : "黑方"}没有合法着法，自动跳过。`);
    state.currentCamp = opponentCamp(state.currentCamp);
    state.phase = PHASES.NORMAL;
  }

  if (events.length > 0) {
    state.message = events[events.length - 1];
  }

  return events;
}

export function applyMove(sourceState, move) {
  const normalizedMove = normalizeMove(sourceState, move);
  const result = evaluateMove(
    sourceState,
    normalizedMove.pieceId,
    normalizedMove.toRow,
    normalizedMove.toCol
  );

  if (!result.ok) {
    return result;
  }

  const nextState = result.state;
  const skipEvents = advancePastNoLegalMoves(nextState);
  result.events = skipEvents;
  result.state = nextState;
  if (skipEvents.length > 0) {
    result.message = skipEvents[skipEvents.length - 1];
  } else {
    result.message = nextState.message;
  }

  return result;
}
