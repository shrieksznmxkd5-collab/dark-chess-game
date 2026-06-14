import { BOARD_COLS, BOARD_ROWS, CAMPS, PIECE_TYPES } from "./config.js";

export const STANDARD_POSITIONS = [
  { camp: CAMPS.BLACK, type: PIECE_TYPES.ROOK, row: 0, col: 0 },
  { camp: CAMPS.BLACK, type: PIECE_TYPES.HORSE, row: 0, col: 1 },
  { camp: CAMPS.BLACK, type: PIECE_TYPES.ELEPHANT, row: 0, col: 2 },
  { camp: CAMPS.BLACK, type: PIECE_TYPES.ADVISOR, row: 0, col: 3 },
  { camp: CAMPS.BLACK, type: PIECE_TYPES.GENERAL, row: 0, col: 4 },
  { camp: CAMPS.BLACK, type: PIECE_TYPES.ADVISOR, row: 0, col: 5 },
  { camp: CAMPS.BLACK, type: PIECE_TYPES.ELEPHANT, row: 0, col: 6 },
  { camp: CAMPS.BLACK, type: PIECE_TYPES.HORSE, row: 0, col: 7 },
  { camp: CAMPS.BLACK, type: PIECE_TYPES.ROOK, row: 0, col: 8 },
  { camp: CAMPS.BLACK, type: PIECE_TYPES.CANNON, row: 2, col: 1 },
  { camp: CAMPS.BLACK, type: PIECE_TYPES.CANNON, row: 2, col: 7 },
  { camp: CAMPS.BLACK, type: PIECE_TYPES.SOLDIER, row: 3, col: 0 },
  { camp: CAMPS.BLACK, type: PIECE_TYPES.SOLDIER, row: 3, col: 2 },
  { camp: CAMPS.BLACK, type: PIECE_TYPES.SOLDIER, row: 3, col: 4 },
  { camp: CAMPS.BLACK, type: PIECE_TYPES.SOLDIER, row: 3, col: 6 },
  { camp: CAMPS.BLACK, type: PIECE_TYPES.SOLDIER, row: 3, col: 8 },
  { camp: CAMPS.RED, type: PIECE_TYPES.SOLDIER, row: 6, col: 0 },
  { camp: CAMPS.RED, type: PIECE_TYPES.SOLDIER, row: 6, col: 2 },
  { camp: CAMPS.RED, type: PIECE_TYPES.SOLDIER, row: 6, col: 4 },
  { camp: CAMPS.RED, type: PIECE_TYPES.SOLDIER, row: 6, col: 6 },
  { camp: CAMPS.RED, type: PIECE_TYPES.SOLDIER, row: 6, col: 8 },
  { camp: CAMPS.RED, type: PIECE_TYPES.CANNON, row: 7, col: 1 },
  { camp: CAMPS.RED, type: PIECE_TYPES.CANNON, row: 7, col: 7 },
  { camp: CAMPS.RED, type: PIECE_TYPES.ROOK, row: 9, col: 0 },
  { camp: CAMPS.RED, type: PIECE_TYPES.HORSE, row: 9, col: 1 },
  { camp: CAMPS.RED, type: PIECE_TYPES.ELEPHANT, row: 9, col: 2 },
  { camp: CAMPS.RED, type: PIECE_TYPES.ADVISOR, row: 9, col: 3 },
  { camp: CAMPS.RED, type: PIECE_TYPES.GENERAL, row: 9, col: 4 },
  { camp: CAMPS.RED, type: PIECE_TYPES.ADVISOR, row: 9, col: 5 },
  { camp: CAMPS.RED, type: PIECE_TYPES.ELEPHANT, row: 9, col: 6 },
  { camp: CAMPS.RED, type: PIECE_TYPES.HORSE, row: 9, col: 7 },
  { camp: CAMPS.RED, type: PIECE_TYPES.ROOK, row: 9, col: 8 }
];

export const FIXED_VISIBLE_POSITIONS = STANDARD_POSITIONS.filter(
  (position) =>
    position.type === PIECE_TYPES.GENERAL || position.type === PIECE_TYPES.ADVISOR
);

export const HIDDEN_START_SLOTS = STANDARD_POSITIONS.filter(
  (position) =>
    position.type !== PIECE_TYPES.GENERAL && position.type !== PIECE_TYPES.ADVISOR
);

export function inBounds(row, col) {
  return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS;
}

export function pointKey(row, col) {
  return `${row},${col}`;
}

export function inPalace(row, col, camp) {
  if (col < 3 || col > 5) {
    return false;
  }

  if (camp === CAMPS.BLACK) {
    return row >= 0 && row <= 2;
  }

  return row >= 7 && row <= 9;
}

export function hasCrossedRiver(row, camp) {
  return camp === CAMPS.RED ? row <= 4 : row >= 5;
}

export function getRiverSide(row) {
  return row <= 4 ? CAMPS.BLACK : CAMPS.RED;
}

export function isOnRiverSide(row, side) {
  return getRiverSide(row) === side;
}

export function getAllBoardPoints() {
  const points = [];
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    for (let col = 0; col < BOARD_COLS; col += 1) {
      points.push({ row, col });
    }
  }
  return points;
}

