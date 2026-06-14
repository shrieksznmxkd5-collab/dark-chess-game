import { createGameState } from "./game-state.js";
import { bindInput } from "./input.js";
import { renderGame } from "./renderer.js";

const state = createGameState();
renderGame(state);
bindInput(state);
document.body.dataset.appReady = "true";
