import { CAMPS, DEFAULT_SETTINGS, GAME_MODES, PHASES } from "./config.js";
import {
  cloneState as cloneEngineState,
  createCustomEngineState,
  createEngineState
} from "../shared/engine/game-state.js";

function addUiState(engineState, options = {}) {
  return {
    ...engineState,
    mode: options.mode ?? GAME_MODES.HUMAN,
    uiState: "idle",
    selectedPieceId: null,
    legalTargets: [],
    inputLocked: false,
    aiThinking: false,
    undoRemaining: options.undoRemaining ?? 2,
    undoSnapshot: options.undoSnapshot ?? null,
    pendingUndoSnapshot: options.pendingUndoSnapshot ?? null,
    settings: {
      ...DEFAULT_SETTINGS,
      ...(options.settings ?? {})
    }
  };
}

export function createGameState(options = {}) {
  return addUiState(createEngineState(options), options);
}

export function createCustomState({
  pieces = [],
  currentCamp = CAMPS.RED,
  mode = GAME_MODES.HUMAN,
  phase = PHASES.NORMAL,
  delayedThreat = null,
  captured = []
} = {}) {
  return addUiState(
    createCustomEngineState({
      pieces,
      currentCamp,
      phase,
      delayedThreat,
      captured
    }),
    { mode }
  );
}

export function cloneState(state) {
  return cloneEngineState(state);
}

export function replaceState(target, source) {
  const cloned = cloneState(source);
  Object.keys(target).forEach((key) => {
    delete target[key];
  });
  Object.assign(target, cloned);
}
