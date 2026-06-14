import {
  advancePastNoLegalMoves,
  applyMove,
  evaluateMove,
  getLegalMoves,
  getLegalTargets,
  hasAnyLegalMove
} from "../shared/engine/move-engine.js";
import { replaceState } from "./game-state.js";

export {
  advancePastNoLegalMoves,
  applyMove,
  evaluateMove,
  getLegalMoves,
  getLegalTargets,
  hasAnyLegalMove
};

export function makeMove(state, pieceId, toRow, toCol) {
  const result = applyMove(state, {
    pieceId,
    to: { row: toRow, col: toCol }
  });

  if (!result.ok) {
    return result;
  }

  replaceState(state, result.state);
  result.state = state;
  return result;
}

