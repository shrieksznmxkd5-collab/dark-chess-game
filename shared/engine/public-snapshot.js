import { cloneState } from "./game-state.js";

export function createPublicPiece(piece) {
  const publicPiece = {
    id: piece.id,
    initialRole: piece.initialRole,
    initialCamp: piece.initialCamp,
    faceUp: piece.faceUp,
    alive: piece.alive,
    hasActed: piece.hasActed,
    row: piece.row,
    col: piece.col,
    lockedRiverSide: piece.lockedRiverSide
  };

  if (piece.faceUp) {
    publicPiece.realType = piece.realType;
    publicPiece.realCamp = piece.realCamp;
  } else {
    publicPiece.realType = null;
    publicPiece.realCamp = null;
  }

  return publicPiece;
}

export function createPublicSnapshot(privateState) {
  const state = cloneState(privateState);
  return {
    id: state.id ?? null,
    roomId: state.roomId ?? null,
    version: state.version ?? state.moveCount ?? 0,
    pieces: state.pieces.map(createPublicPiece),
    currentCamp: state.currentCamp,
    phase: state.phase,
    captured: state.captured,
    delayedThreat: state.delayedThreat,
    gameOver: state.gameOver,
    winner: state.winner,
    message: state.message,
    moveCount: state.moveCount,
    lastMove: state.lastMove
  };
}

