import { AI_CAMP, CAMPS, PIECE_TYPES } from "./config.js";
import { isGeneralUnderAttack } from "./attacks.js";
import { getLegalTargets } from "./move-transaction.js";
import { getActiveCamp, getActiveType, getPieceAt } from "./rules.js";

const PIECE_VALUES = {
  [PIECE_TYPES.GENERAL]: 10000,
  [PIECE_TYPES.ROOK]: 90,
  [PIECE_TYPES.CANNON]: 70,
  [PIECE_TYPES.HORSE]: 65,
  [PIECE_TYPES.ELEPHANT]: 28,
  [PIECE_TYPES.ADVISOR]: 28,
  [PIECE_TYPES.SOLDIER]: 12
};

function getVisibleValue(piece) {
  if (!piece) {
    return 0;
  }
  return PIECE_VALUES[getActiveType(piece)] ?? 0;
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
  const centerScore = 8 - centerDistance;
  const forwardScore =
    camp === CAMPS.BLACK ? move.row - move.fromRow : move.fromRow - move.row;
  return centerScore + forwardScore * 2;
}

function scoreMove(state, move) {
  let score = Math.random() * 3;
  const target = move.targetPiece;
  const aiInDanger = isGeneralUnderAttack(state.pieces, AI_CAMP);

  if (aiInDanger) {
    score += 240;
  }

  if (target) {
    if (target.realType === PIECE_TYPES.GENERAL) {
      score += 100000;
    }
    score += getVisibleValue(target) * 12;
  }

  if (!move.piece.faceUp) {
    score += 8;
  }

  score += scorePosition(move);
  return score;
}

export function chooseAiMove(state, camp = AI_CAMP) {
  const moves = collectLegalMoves(state, camp);
  if (moves.length === 0) {
    return null;
  }

  return moves
    .map((move) => ({
      ...move,
      score: scoreMove(state, move)
    }))
    .sort((a, b) => b.score - a.score)[0];
}

export function getAiThinkDelay() {
  return 300 + Math.floor(Math.random() * 401);
}
