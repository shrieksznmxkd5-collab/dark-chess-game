import { CAMPS, PIECE_TYPES } from "./config.js";
import { FIXED_VISIBLE_POSITIONS, HIDDEN_START_SLOTS } from "./board.js";

function makeId(index) {
  return `piece-${String(index + 1).padStart(2, "0")}`;
}

function createPieceFromPosition(position, index, options = {}) {
  const faceUp = options.faceUp ?? true;
  return {
    id: makeId(index),
    realType: options.realType ?? position.type,
    realCamp: options.realCamp ?? position.camp,
    initialRole: options.initialRole ?? position.type,
    initialCamp: options.initialCamp ?? position.camp,
    faceUp,
    alive: true,
    hasActed: faceUp,
    row: position.row,
    col: position.col,
    lockedRiverSide: null
  };
}

export function createRealHiddenDeck() {
  return HIDDEN_START_SLOTS.map((slot) => ({
    realType: slot.type,
    realCamp: slot.camp
  }));
}

export function shuffle(items, random = Math.random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function createInitialPieces(random = Math.random) {
  const pieces = [];

  FIXED_VISIBLE_POSITIONS.forEach((position) => {
    pieces.push(createPieceFromPosition(position, pieces.length, { faceUp: true }));
  });

  const shuffledDeck = shuffle(createRealHiddenDeck(), random);
  HIDDEN_START_SLOTS.forEach((slot, slotIndex) => {
    const real = shuffledDeck[slotIndex];
    pieces.push(
      createPieceFromPosition(slot, pieces.length, {
        faceUp: false,
        realType: real.realType,
        realCamp: real.realCamp,
        initialRole: slot.type,
        initialCamp: slot.camp
      })
    );
  });

  return pieces;
}

export function createFixturePiece({
  id,
  type = PIECE_TYPES.ROOK,
  camp = CAMPS.RED,
  row = 0,
  col = 0,
  faceUp = true,
  realType = type,
  realCamp = camp,
  initialRole = type,
  initialCamp = camp,
  alive = true,
  hasActed = faceUp,
  lockedRiverSide = null
}) {
  return {
    id: id ?? `fixture-${Math.random().toString(36).slice(2)}`,
    realType,
    realCamp,
    initialRole,
    initialCamp,
    faceUp,
    alive,
    hasActed,
    row,
    col,
    lockedRiverSide
  };
}

export function createCapturedRecord(piece, capturedBy) {
  return {
    id: piece.id,
    capturedBy,
    faceUp: piece.faceUp,
    displayType: piece.faceUp ? piece.realType : null,
    displayCamp: piece.faceUp ? piece.realCamp : piece.initialCamp,
    initialRole: piece.initialRole,
    initialCamp: piece.initialCamp
  };
}

