export function createDelayedThreat({
  protectedCamp,
  restrictedCamp,
  triggerPieceId,
  triggerRow,
  triggerCol
}) {
  return {
    active: true,
    protectedCamp,
    restrictedCamp,
    triggerPieceId,
    triggerRow,
    triggerCol,
    phase: "restricted-turn"
  };
}

export function isDelayedThreatActive(state) {
  return Boolean(state.delayedThreat?.active);
}

export function getLogicPhase(state) {
  if (state.gameOver) {
    return "game-over";
  }

  if (state.delayedThreat?.active) {
    return state.delayedThreat.phase;
  }

  return state.phase ?? "normal";
}

export function isFrozenTriggerAttacker(delayedThreat, piece) {
  return (
    delayedThreat?.active &&
    delayedThreat.phase === "restricted-turn" &&
    piece.id === delayedThreat.triggerPieceId &&
    piece.row === delayedThreat.triggerRow &&
    piece.col === delayedThreat.triggerCol
  );
}

