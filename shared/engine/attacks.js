import { CAMPS, PIECE_TYPES } from "./config.js";
import { inPalace, isOnRiverSide, getRiverSide } from "./board.js";
import { countPiecesBetween, getActiveCamp, getActiveType, getPieceAt } from "./rules.js";

export function findGeneral(pieces, camp) {
  return pieces.find(
    (piece) =>
      piece.alive &&
      piece.realType === PIECE_TYPES.GENERAL &&
      piece.realCamp === camp
  );
}

export function isGeneralFaceToFace(pieces) {
  const redGeneral = findGeneral(pieces, CAMPS.RED);
  const blackGeneral = findGeneral(pieces, CAMPS.BLACK);

  if (!redGeneral || !blackGeneral || redGeneral.col !== blackGeneral.col) {
    return false;
  }

  return countPiecesBetween(
    pieces,
    redGeneral.row,
    redGeneral.col,
    blackGeneral.row,
    blackGeneral.col
  ) === 0;
}

export function canPieceAttackSquare(pieces, piece, row, col) {
  if (!piece || !piece.alive) {
    return false;
  }

  const type = getActiveType(piece);
  const camp = getActiveCamp(piece);
  const deltaRow = row - piece.row;
  const deltaCol = col - piece.col;
  const absRow = Math.abs(deltaRow);
  const absCol = Math.abs(deltaCol);

  switch (type) {
    case PIECE_TYPES.ROOK:
      return (
        (piece.row === row || piece.col === col) &&
        countPiecesBetween(pieces, piece.row, piece.col, row, col) === 0
      );

    case PIECE_TYPES.CANNON:
      return (
        (piece.row === row || piece.col === col) &&
        countPiecesBetween(pieces, piece.row, piece.col, row, col) === 1
      );

    case PIECE_TYPES.HORSE: {
      const isHorseShape =
        (absRow === 2 && absCol === 1) || (absRow === 1 && absCol === 2);
      if (!isHorseShape) {
        return false;
      }
      const legRow = piece.row + (absRow === 2 ? deltaRow / 2 : 0);
      const legCol = piece.col + (absCol === 2 ? deltaCol / 2 : 0);
      return !getPieceAt(pieces, legRow, legCol);
    }

    case PIECE_TYPES.ELEPHANT: {
      if (absRow !== 2 || absCol !== 2) {
        return false;
      }
      const eyeRow = piece.row + deltaRow / 2;
      const eyeCol = piece.col + deltaCol / 2;
      if (getPieceAt(pieces, eyeRow, eyeCol)) {
        return false;
      }
      if (piece.faceUp) {
        const lockedSide = piece.lockedRiverSide ?? getRiverSide(piece.row);
        return isOnRiverSide(row, lockedSide);
      }
      return isOnRiverSide(row, camp);
    }

    case PIECE_TYPES.SOLDIER: {
      const forward = camp === CAMPS.RED ? -1 : 1;
      const isForward = deltaRow === forward && deltaCol === 0;
      const crossed = camp === CAMPS.RED ? piece.row <= 4 : piece.row >= 5;
      const isSideways = crossed && deltaRow === 0 && absCol === 1;
      return isForward || isSideways;
    }

    case PIECE_TYPES.ADVISOR:
      return absRow === 1 && absCol === 1 && inPalace(row, col, camp);

    case PIECE_TYPES.GENERAL:
      return absRow + absCol === 1 && inPalace(row, col, camp);

    default:
      return false;
  }
}

export function getAttackersToGeneral(pieces, camp) {
  const general = findGeneral(pieces, camp);
  if (!general) {
    return [];
  }

  return pieces.filter(
    (piece) =>
      piece.alive &&
      getActiveCamp(piece) !== camp &&
      canPieceAttackSquare(pieces, piece, general.row, general.col)
  );
}

export function isGeneralUnderAttack(pieces, camp) {
  return getAttackersToGeneral(pieces, camp).length > 0;
}

