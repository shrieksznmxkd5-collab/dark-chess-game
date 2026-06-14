export const BOARD_ROWS = 10;
export const BOARD_COLS = 9;

export const CAMPS = {
  RED: "red",
  BLACK: "black"
};

export const PIECE_TYPES = {
  GENERAL: "general",
  ADVISOR: "advisor",
  ELEPHANT: "elephant",
  HORSE: "horse",
  ROOK: "rook",
  CANNON: "cannon",
  SOLDIER: "soldier"
};

export const PHASES = {
  NORMAL: "normal",
  SELECTED: "selected",
  ANIMATING: "animating",
  REVEALING: "revealing",
  RESTRICTED: "restricted-turn",
  ADJUSTMENT: "adjustment-turn",
  GAME_OVER: "game-over"
};

export function opponentCamp(camp) {
  return camp === CAMPS.RED ? CAMPS.BLACK : CAMPS.RED;
}

