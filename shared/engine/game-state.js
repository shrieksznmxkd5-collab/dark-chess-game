import { CAMPS, PHASES } from "./config.js";
import { createInitialPieces } from "./pieces.js";

export function createEngineState(options = {}) {
  return {
    pieces: createInitialPieces(options.random),
    currentCamp: CAMPS.RED,
    phase: PHASES.NORMAL,
    captured: [],
    delayedThreat: null,
    gameOver: false,
    winner: null,
    message: "红方先行。选择一枚属于红方控制的棋子。",
    moveCount: 0,
    lastMove: null
  };
}

export function createCustomEngineState({
  pieces = [],
  currentCamp = CAMPS.RED,
  phase = PHASES.NORMAL,
  delayedThreat = null,
  captured = [],
  gameOver = false,
  winner = null,
  message = "",
  moveCount = 0,
  lastMove = null
} = {}) {
  return {
    pieces,
    currentCamp,
    phase,
    captured,
    delayedThreat,
    gameOver,
    winner,
    message,
    moveCount,
    lastMove
  };
}

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

