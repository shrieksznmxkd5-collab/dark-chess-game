import { APP_VIEWS, GAME_MODES } from "./config.js";
import { createGameState } from "./game-state.js";
import { bindInput, startGame } from "./input.js";
import { renderGame, showToast } from "./renderer.js";

function openRulesDialog() {
  document.getElementById("rulesDialog")?.showModal();
}

async function loadOnlineLobby() {
  return import("./network/online-lobby-controller.js");
}

function bindHomeActions(state) {
  document.getElementById("homeAiBtn")?.addEventListener("click", () => {
    startGame(state, GAME_MODES.AI);
  });

  document.getElementById("homeLocalBtn")?.addEventListener("click", () => {
    startGame(state, GAME_MODES.LOCAL);
  });

  document.getElementById("homeCreateRoomBtn")?.addEventListener("click", async () => {
    try {
      const lobby = await loadOnlineLobby();
      lobby.openCreateRoomFlow(state);
    } catch (error) {
      showToast(`在线房间模块加载失败：${error.message}`);
    }
  });

  document.getElementById("homeJoinRoomBtn")?.addEventListener("click", async () => {
    try {
      const lobby = await loadOnlineLobby();
      lobby.openJoinRoomFlow();
    } catch (error) {
      showToast(`在线房间模块加载失败：${error.message}`);
    }
  });

  document.getElementById("homeRulesBtn")?.addEventListener("click", openRulesDialog);
}

async function openRoomFromUrl(state) {
  const roomCode = new URLSearchParams(window.location.search).get("room");
  if (!roomCode) {
    return;
  }

  try {
    const lobby = await loadOnlineLobby();
    lobby.openJoinRoomFlow(roomCode);
  } catch (error) {
    showToast(`邀请链接处理失败：${error.message}`);
  }
}

export function initApp() {
  const state = createGameState({
    mode: GAME_MODES.LOCAL,
    appView: APP_VIEWS.HOME,
    gameActive: false
  });

  bindInput(state);
  bindHomeActions(state);
  renderGame(state);
  document.body.dataset.appReady = "true";
  openRoomFromUrl(state);

  window.UndercoverChessDebug = window.DarkChessDebug;
  return state;
}
