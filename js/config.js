export {
  BOARD_ROWS,
  BOARD_COLS,
  CAMPS,
  PIECE_TYPES,
  PHASES,
  opponentCamp
} from "../shared/engine/config.js";

import { CAMPS } from "../shared/engine/config.js";

export const CAMP_NAMES = {
  red: "红方",
  black: "黑方"
};

export const TYPE_NAMES = {
  general: "将帅",
  advisor: "士",
  elephant: "象相",
  horse: "马",
  rook: "车",
  cannon: "炮",
  soldier: "兵卒"
};

export const PIECE_LABELS = {
  red: {
    general: "帅",
    advisor: "仕",
    elephant: "相",
    horse: "马",
    rook: "车",
    cannon: "炮",
    soldier: "兵"
  },
  black: {
    general: "将",
    advisor: "士",
    elephant: "象",
    horse: "马",
    rook: "车",
    cannon: "炮",
    soldier: "卒"
  }
};

export const GAME_MODES = {
  LOCAL: "local",
  HUMAN: "local",
  AI: "ai"
};

export const APP_VIEWS = {
  HOME: "home",
  GAME: "game"
};

export const HUMAN_CAMP = CAMPS.RED;
export const AI_CAMP = CAMPS.BLACK;

export const ANIMATION = {
  moveMs: 320,
  captureMs: 220,
  revealMs: 420,
  trailMs: 720
};

export const DEFAULT_SETTINGS = {
  sound: true,
  vibration: true
};

export function getPieceLabel(type, camp) {
  return PIECE_LABELS[camp]?.[type] ?? "?";
}
