import { AI_CAMP, CAMPS, PHASES, PIECE_TYPES, opponentCamp } from "./config.js";
import {
  canPieceAttackSquare,
  findGeneral,
  getAttackersToGeneral,
  isGeneralUnderAttack
} from "./attacks.js";
import { getLogicPhase } from "./delayed-threat.js";
import { evaluateMove, getLegalMoves, getLegalTargets } from "./move-transaction.js";
import { getActiveCamp, getActiveType, getPieceAt } from "./rules.js";

export const AI_DIFFICULTIES = {
  EASY: "easy",
  NORMAL: "normal",
  HARD: "hard"
};

const PIECE_VALUES = {
  [PIECE_TYPES.GENERAL]: 100000,
  [PIECE_TYPES.ROOK]: 900,
  [PIECE_TYPES.CANNON]: 500,
  [PIECE_TYPES.HORSE]: 450,
  [PIECE_TYPES.ELEPHANT]: 250,
  [PIECE_TYPES.ADVISOR]: 250,
  [PIECE_TYPES.SOLDIER]: 100
};

const HIGH_VALUE_TYPES = new Set([
  PIECE_TYPES.ROOK,
  PIECE_TYPES.CANNON,
  PIECE_TYPES.HORSE
]);

function getVisibleType(piece) {
  return piece ? getActiveType(piece) : null;
}

function getVisibleValue(piece) {
  if (!piece) {
    return 0;
  }
  return PIECE_VALUES[getVisibleType(piece)] ?? 0;
}

function isVisibleGeneral(piece) {
  return Boolean(piece?.faceUp && piece.realType === PIECE_TYPES.GENERAL);
}

function isHighValue(piece) {
  return HIGH_VALUE_TYPES.has(getVisibleType(piece));
}

function collectLegalMoves(state, camp = AI_CAMP) {
  const moves = [];

  state.pieces.forEach((piece) => {
    if (!piece.alive || getActiveCamp(piece) !== camp) {
      return;
    }

    getLegalTargets(state, piece.id).forEach((target) => {
      moves.push({
        pieceId: piece.id,
        fromRow: piece.row,
        fromCol: piece.col,
        row: target.row,
        col: target.col,
        piece,
        targetPiece: getPieceAt(state.pieces, target.row, target.col, piece.id)
      });
    });
  });

  return moves;
}

function scorePosition(move) {
  const camp = getActiveCamp(move.piece);
  const centerDistance = Math.abs(move.col - 4);
  const centerScore = 10 - centerDistance * 2;
  const forwardScore =
    camp === CAMPS.BLACK ? move.row - move.fromRow : move.fromRow - move.row;
  return centerScore + forwardScore * 6;
}

function getAttackersToPiece(state, targetPiece, attackerCamp) {
  return state.pieces.filter(
    (piece) =>
      piece.alive &&
      piece.id !== targetPiece.id &&
      getActiveCamp(piece) === attackerCamp &&
      canPieceAttackSquare(state.pieces, piece, targetPiece.row, targetPiece.col)
  );
}

function getProtectorsOfPiece(state, targetPiece, camp) {
  return state.pieces.filter(
    (piece) =>
      piece.alive &&
      piece.id !== targetPiece.id &&
      getActiveCamp(piece) === camp &&
      canPieceAttackSquare(state.pieces, piece, targetPiece.row, targetPiece.col)
  );
}

function sumThreatenedValue(state, camp) {
  const enemyCamp = opponentCamp(camp);
  return state.pieces.reduce((total, piece) => {
    if (!piece.alive || getActiveCamp(piece) !== camp || getVisibleType(piece) === PIECE_TYPES.GENERAL) {
      return total;
    }

    const attackers = getAttackersToPiece(state, piece, enemyCamp);
    if (attackers.length === 0) {
      return total;
    }

    const value = getVisibleValue(piece);
    return total + (isHighValue(piece) ? value : value * 0.45);
  }, 0);
}

function sumProtectedThreatenedHighValue(state, camp) {
  const enemyCamp = opponentCamp(camp);
  return state.pieces.reduce((total, piece) => {
    if (!piece.alive || getActiveCamp(piece) !== camp || !isHighValue(piece)) {
      return total;
    }

    const attackers = getAttackersToPiece(state, piece, enemyCamp);
    if (attackers.length === 0) {
      return total;
    }

    const protectors = getProtectorsOfPiece(state, piece, camp);
    return protectors.length > 0 ? total + getVisibleValue(piece) : total;
  }, 0);
}

function countGeneralGuards(state, camp) {
  const general = findGeneral(state.pieces, camp);
  if (!general) {
    return 0;
  }

  return state.pieces.filter((piece) => {
    if (!piece.alive || piece.id === general.id || getActiveCamp(piece) !== camp) {
      return false;
    }
    const distance = Math.abs(piece.row - general.row) + Math.abs(piece.col - general.col);
    return distance <= 2;
  }).length;
}

function scoreStructure(move, movedAfter, beforeState, afterState, camp) {
  let score = 0;
  const beforeGuards = countGeneralGuards(beforeState, camp);
  const afterGuards = countGeneralGuards(afterState, camp);
  score += (afterGuards - beforeGuards) * 45;

  if (getVisibleType(move.piece) === PIECE_TYPES.ADVISOR) {
    const general = findGeneral(beforeState.pieces, camp);
    if (general) {
      const beforeDistance =
        Math.abs(move.fromRow - general.row) + Math.abs(move.fromCol - general.col);
      const afterDistance =
        Math.abs(movedAfter.row - general.row) + Math.abs(movedAfter.col - general.col);
      if (beforeDistance <= 2 && afterDistance > beforeDistance) {
        score -= 80;
      }
    }
  }

  return score;
}

function scoreMovedPieceSafety(afterState, movedAfter, camp) {
  if (!movedAfter || getActiveCamp(movedAfter) !== camp) {
    return 0;
  }

  const enemyCamp = opponentCamp(camp);
  const attackers = getAttackersToPiece(afterState, movedAfter, enemyCamp);
  const protectors = getProtectorsOfPiece(afterState, movedAfter, camp);
  const movedValue = getVisibleValue(movedAfter);

  let score = protectors.length * (isHighValue(movedAfter) ? 55 : 22);

  if (attackers.length > 0) {
    const lowestAttackerValue = Math.min(...attackers.map(getVisibleValue));
    const risk = Math.max(0, movedValue - lowestAttackerValue * 0.45);
    score -= protectors.length > 0 ? risk * 0.42 : risk * 0.85;
  }

  return score;
}

function scoreOpponentMoveThreat(state, move, threatenedCamp) {
  let threat = 0;
  const target = move.targetPiece;

  if (target) {
    if (isVisibleGeneral(target)) {
      threat += PIECE_VALUES[PIECE_TYPES.GENERAL];
    } else {
      const protectors = getProtectorsOfPiece(state, target, threatenedCamp);
      const exchangeFactor = protectors.length > 0 ? 0.45 : 1;
      threat += getVisibleValue(target) * exchangeFactor;
    }
  }

  if (move.piece.faceUp) {
    const result = evaluateMove(state, move.pieceId, move.row, move.col);
    if (result.ok && isGeneralUnderAttack(result.state.pieces, threatenedCamp)) {
      threat += 1500;
    }
  }

  return threat;
}

function getWorstOpponentReplyPenalty(afterState, camp, difficulty) {
  if (difficulty === AI_DIFFICULTIES.EASY) {
    return 0;
  }

  const enemyCamp = opponentCamp(camp);
  const opponentMoves = getLegalMoves(afterState, enemyCamp).slice(0, difficulty === AI_DIFFICULTIES.HARD ? 48 : 18);
  if (opponentMoves.length === 0) {
    return 0;
  }

  const worstThreat = opponentMoves.reduce((worst, move) => {
    const piece = afterState.pieces.find((item) => item.id === move.pieceId);
    const targetPiece = getPieceAt(afterState.pieces, move.to.row, move.to.col, move.pieceId);
    const threat = scoreOpponentMoveThreat(
      afterState,
      {
        pieceId: move.pieceId,
        row: move.to.row,
        col: move.to.col,
        piece,
        targetPiece
      },
      camp
    );
    return Math.max(worst, threat);
  }, 0);

  return worstThreat * (difficulty === AI_DIFFICULTIES.HARD ? 0.72 : 0.5);
}

function scoreHiddenMoveWithoutPeeking(state, move, camp, random) {
  let score = random() * 8;
  const target = move.targetPiece;

  if (target) {
    if (isVisibleGeneral(target)) {
      score += PIECE_VALUES[PIECE_TYPES.GENERAL];
    }
    score += getVisibleValue(target) * 0.9;
  }

  score += scorePosition(move);
  score += 18;

  if (isGeneralUnderAttack(state.pieces, camp)) {
    score += 6000;
  }

  return score;
}

export function scoreAiMove(state, move, camp = AI_CAMP, options = {}) {
  const difficulty = options.difficulty ?? options.aiDifficulty ?? AI_DIFFICULTIES.NORMAL;
  const random = options.random ?? Math.random;
  const target = move.targetPiece;
  const currentPhase = getLogicPhase(state);

  if (target && isVisibleGeneral(target)) {
    return PIECE_VALUES[PIECE_TYPES.GENERAL] * 2 + getVisibleValue(move.piece);
  }

  if (!move.piece.faceUp) {
    return scoreHiddenMoveWithoutPeeking(state, move, camp, random);
  }

  const result = evaluateMove(state, move.pieceId, move.row, move.col);
  if (!result.ok) {
    return Number.NEGATIVE_INFINITY;
  }

  const afterState = result.state;
  const movedAfter = afterState.pieces.find((piece) => piece.id === move.pieceId);
  const beforeThreatened = sumThreatenedValue(state, camp);
  const afterThreatened = sumThreatenedValue(afterState, camp);
  const beforeProtectedHigh = sumProtectedThreatenedHighValue(state, camp);
  const afterProtectedHigh = sumProtectedThreatenedHighValue(afterState, camp);
  const beforeGeneralAttackers = getAttackersToGeneral(state.pieces, camp).length;
  const afterGeneralAttackers = getAttackersToGeneral(afterState.pieces, camp).length;

  let score = random() * 10;
  score += scorePosition(move);

  if (target) {
    const captureValue = getVisibleValue(target);
    score += captureValue;
    if (isHighValue(target)) {
      score += captureValue * 0.35;
    }
  }

  if (beforeGeneralAttackers > afterGeneralAttackers) {
    score += (beforeGeneralAttackers - afterGeneralAttackers) * 2800;
  }

  if (currentPhase === PHASES.ADJUSTMENT) {
    score += 2200;
  }

  score += (beforeThreatened - afterThreatened) * 0.75;
  score += (afterProtectedHigh - beforeProtectedHigh) * 0.55;
  score += scoreStructure(move, movedAfter, state, afterState, camp);
  score += scoreMovedPieceSafety(afterState, movedAfter, camp);

  const shouldLookAhead =
    difficulty === AI_DIFFICULTIES.HARD ||
    Boolean(target) ||
    isHighValue(move.piece) ||
    beforeThreatened > 0 ||
    beforeGeneralAttackers > 0 ||
    currentPhase === PHASES.ADJUSTMENT;

  if (shouldLookAhead) {
    score -= getWorstOpponentReplyPenalty(afterState, camp, difficulty);
  }

  return score;
}

function pickWeightedTop(scoredMoves, random) {
  const sorted = [...scoredMoves].sort((a, b) => b.score - a.score);
  const topScore = sorted[0].score;
  const candidates = sorted
    .filter((move) => topScore - move.score <= 80)
    .slice(0, 3);
  const minScore = Math.min(...candidates.map((move) => move.score));
  const weights = candidates.map((move) => Math.max(1, move.score - minScore + 12) ** 1.35);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = random() * total;

  for (let index = 0; index < candidates.length; index += 1) {
    cursor -= weights[index];
    if (cursor <= 0) {
      return candidates[index];
    }
  }

  return candidates[0];
}

export function chooseAiMove(state, camp = AI_CAMP, options = {}) {
  const difficulty = options.difficulty ?? options.aiDifficulty ?? AI_DIFFICULTIES.NORMAL;
  const random = options.random ?? Math.random;
  const moves = collectLegalMoves(state, camp);
  if (moves.length === 0) {
    return null;
  }

  const directWins = moves.filter((move) => move.targetPiece && isVisibleGeneral(move.targetPiece));
  if (directWins.length > 0) {
    return directWins
      .map((move) => ({
        ...move,
        score: scoreAiMove(state, move, camp, { difficulty, random })
      }))
      .sort((a, b) => b.score - a.score)[0];
  }

  const critical =
    isGeneralUnderAttack(state.pieces, camp) ||
    getLogicPhase(state) === PHASES.ADJUSTMENT;

  const scoredMoves = moves
    .map((move) => ({
      ...move,
      score: scoreAiMove(state, move, camp, { difficulty, random })
    }))
    .sort((a, b) => b.score - a.score);

  if (critical || difficulty === AI_DIFFICULTIES.HARD) {
    return scoredMoves[0];
  }

  if (difficulty === AI_DIFFICULTIES.EASY) {
    return pickWeightedTop(scoredMoves.slice(0, Math.min(6, scoredMoves.length)), random);
  }

  return pickWeightedTop(scoredMoves, random);
}

export function getAiThinkDelay() {
  return 300 + Math.floor(Math.random() * 601);
}
