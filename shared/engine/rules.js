import { BOARD_COLS, BOARD_ROWS, CAMPS, PIECE_TYPES } from "./config.js";
import { getRiverSide, hasCrossedRiver, inBounds, inPalace, isOnRiverSide } from "./board.js";

export function getActiveType(piece) {
  return piece.faceUp ? piece.realType : piece.initialRole;
}

export function getActiveCamp(piece) {
  return piece.faceUp ? piece.realCamp : piece.initialCamp;
}

export function getPieceAt(pieces, row, col, ignoredId = null) {
  return pieces.find(
    (piece) =>
      piece.alive && piece.id !== ignoredId && piece.row === row && piece.col === col
  );
}

export function countPiecesBetween(pieces, fromRow, fromCol, toRow, toCol) {
  if (fromRow !== toRow && fromCol !== toCol) {
    return -1;
  }

  const rowStep = Math.sign(toRow - fromRow);
  const colStep = Math.sign(toCol - fromCol);
  let row = fromRow + rowStep;
  let col = fromCol + colStep;
  let count = 0;

  while (row !== toRow || col !== toCol) {
    if (getPieceAt(pieces, row, col)) {
      count += 1;
    }
    row += rowStep;
    col += colStep;
  }

  return count;
}

export function validateBasicMove(state, piece, toRow, toCol) {
  if (!piece || !piece.alive) {
    return { ok: false, reason: "棋子不存在" };
  }

  if (!inBounds(toRow, toCol)) {
    return { ok: false, reason: "落点不在棋盘内" };
  }

  if (piece.row === toRow && piece.col === toCol) {
    return { ok: false, reason: "棋子没有移动" };
  }

  const pieces = state.pieces;
  const type = getActiveType(piece);
  const camp = getActiveCamp(piece);
  const target = getPieceAt(pieces, toRow, toCol, piece.id);

  if (target && getActiveCamp(target) === camp) {
    return { ok: false, reason: "不能吃自己的棋子" };
  }

  const deltaRow = toRow - piece.row;
  const deltaCol = toCol - piece.col;
  const absRow = Math.abs(deltaRow);
  const absCol = Math.abs(deltaCol);
  const blockers = countPiecesBetween(pieces, piece.row, piece.col, toRow, toCol);

  switch (type) {
    case PIECE_TYPES.ROOK:
      if (piece.row !== toRow && piece.col !== toCol) {
        return { ok: false, reason: "车只能横向或纵向移动" };
      }
      if (blockers !== 0) {
        return { ok: false, reason: "车不能越过阻挡棋子" };
      }
      return { ok: true, target };

    case PIECE_TYPES.CANNON:
      if (piece.row !== toRow && piece.col !== toCol) {
        return { ok: false, reason: "炮只能横向或纵向移动" };
      }
      if (target) {
        if (blockers !== 1) {
          return { ok: false, reason: "炮吃子需要一个炮架" };
        }
      } else if (blockers !== 0) {
        return { ok: false, reason: "炮移动时路径不能有棋子" };
      }
      return { ok: true, target };

    case PIECE_TYPES.HORSE: {
      const isHorseShape =
        (absRow === 2 && absCol === 1) || (absRow === 1 && absCol === 2);
      if (!isHorseShape) {
        return { ok: false, reason: "马走日字" };
      }
      const legRow = piece.row + (absRow === 2 ? deltaRow / 2 : 0);
      const legCol = piece.col + (absCol === 2 ? deltaCol / 2 : 0);
      if (getPieceAt(pieces, legRow, legCol)) {
        return { ok: false, reason: "马腿被阻挡" };
      }
      return { ok: true, target };
    }

    case PIECE_TYPES.ELEPHANT: {
      if (absRow !== 2 || absCol !== 2) {
        return { ok: false, reason: "象相走田字" };
      }
      const eyeRow = piece.row + deltaRow / 2;
      const eyeCol = piece.col + deltaCol / 2;
      if (getPieceAt(pieces, eyeRow, eyeCol)) {
        return { ok: false, reason: "象眼被阻挡" };
      }

      if (piece.faceUp) {
        const lockedSide = piece.lockedRiverSide ?? getRiverSide(piece.row);
        if (!isOnRiverSide(toRow, lockedSide)) {
          return { ok: false, reason: "象相不能跨越翻面时所在的河界" };
        }
      } else if (!isOnRiverSide(toRow, camp)) {
        return { ok: false, reason: "象相不能跨越楚河汉界" };
      }
      return { ok: true, target };
    }

    case PIECE_TYPES.SOLDIER: {
      const forward = camp === CAMPS.RED ? -1 : 1;
      const isForward = deltaRow === forward && deltaCol === 0;
      const isSideways =
        hasCrossedRiver(piece.row, camp) && deltaRow === 0 && Math.abs(deltaCol) === 1;
      if (!isForward && !isSideways) {
        return { ok: false, reason: camp === CAMPS.RED ? "兵不能这样移动" : "卒不能这样移动" };
      }
      return { ok: true, target };
    }

    case PIECE_TYPES.ADVISOR:
      if (absRow !== 1 || absCol !== 1) {
        return { ok: false, reason: "士只能斜走一格" };
      }
      if (!inPalace(toRow, toCol, camp)) {
        return { ok: false, reason: "士不能离开九宫" };
      }
      return { ok: true, target };

    case PIECE_TYPES.GENERAL:
      if (absRow + absCol !== 1) {
        return { ok: false, reason: "将帅只能横向或纵向移动一格" };
      }
      if (!inPalace(toRow, toCol, camp)) {
        return { ok: false, reason: "将帅不能离开九宫" };
      }
      return { ok: true, target };

    default:
      return { ok: false, reason: "未知棋子类型" };
  }
}

export function getBoardDistance(from, to) {
  return Math.abs(from.row - to.row) + Math.abs(from.col - to.col);
}

export function getAllTargetPoints() {
  const points = [];
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    for (let col = 0; col < BOARD_COLS; col += 1) {
      points.push({ row, col });
    }
  }
  return points;
}
