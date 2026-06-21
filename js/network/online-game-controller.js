import { APP_VIEWS, CAMP_NAMES, GAME_MODES } from "../config.js";
import { replaceState } from "../game-state.js";
import { renderGame, showToast } from "../renderer.js";
import { loadOnlineSnapshot, subscribeOnlineSnapshot } from "./online-game-service.js";

let unsubscribeSnapshot = null;
let activeRoomId = null;
let activeState = null;
let activeBundle = null;
let snapshotRefreshTimer = null;

function getMember(bundle, camp) {
  return bundle?.members.find((member) => member.camp === camp) ?? null;
}

function getCurrentMember(bundle) {
  return bundle?.members.find((member) => member.user_id === bundle.currentUserId) ?? null;
}

function getSnapshotPayload(snapshotRecord) {
  return snapshotRecord?.snapshot ?? snapshotRecord;
}

function assertPublicSnapshotSafe(snapshot) {
  const leakedPiece = snapshot?.pieces?.find(
    (piece) => !piece.faceUp && (piece.realType || piece.realCamp)
  );

  if (leakedPiece) {
    throw new Error("公开快照包含未翻面棋子的真实身份，已拒绝渲染。");
  }
}

function buildOnlineRoomInfo(bundle, snapshotRecord) {
  const currentMember = getCurrentMember(bundle);
  const red = getMember(bundle, "red");
  const black = getMember(bundle, "black");
  const snapshot = getSnapshotPayload(snapshotRecord);

  return {
    id: bundle.room.id,
    code: bundle.room.code,
    userCamp: currentMember?.camp ?? null,
    userCampName: currentMember?.camp ? CAMP_NAMES[currentMember.camp] : "观战方",
    redName: red?.display_name ?? "等待中",
    blackName: black?.display_name ?? "等待中",
    version: snapshotRecord?.version ?? snapshot?.version ?? 1,
    currentTurn: snapshotRecord?.current_turn ?? snapshot?.currentCamp ?? "red"
  };
}

function applyOnlineSnapshot(state, bundle, snapshotRecord) {
  const snapshot = getSnapshotPayload(snapshotRecord);
  if (!snapshot?.pieces?.length) {
    throw new Error("公开棋局快照为空，无法渲染棋盘。");
  }

  assertPublicSnapshotSafe(snapshot);

  const settings = state.settings;
  const onlineRoom = buildOnlineRoomInfo(bundle, snapshotRecord);

  replaceState(state, {
    ...snapshot,
    currentCamp: snapshotRecord?.current_turn ?? snapshot.currentCamp,
    version: onlineRoom.version,
    mode: GAME_MODES.ONLINE,
    appView: APP_VIEWS.GAME,
    gameActive: true,
    uiState: "idle",
    selectedPieceId: null,
    legalTargets: [],
    inputLocked: true,
    aiThinking: false,
    undoRemaining: 0,
    undoSnapshot: null,
    pendingUndoSnapshot: null,
    settings,
    onlineRoom
  });

  renderGame(state);
}

function scheduleSnapshotRefresh() {
  window.clearTimeout(snapshotRefreshTimer);
  snapshotRefreshTimer = window.setTimeout(refreshOnlineSnapshot, 120);
}

async function startSnapshotSubscription(roomId) {
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
    unsubscribeSnapshot = null;
  }

  try {
    unsubscribeSnapshot = await subscribeOnlineSnapshot(roomId, scheduleSnapshotRefresh);
  } catch (error) {
    unsubscribeSnapshot = null;
    showToast(`在线棋盘同步订阅失败：${error.message}`);
  }
}

export async function refreshOnlineSnapshot() {
  if (!activeState || !activeBundle?.room?.id) {
    return;
  }

  try {
    const snapshotRecord = await loadOnlineSnapshot(activeBundle.room.id);
    applyOnlineSnapshot(activeState, activeBundle, snapshotRecord);
  } catch (error) {
    showToast(error.message);
  }
}

export async function enterOnlineGame(state, bundle, snapshotRecord = null) {
  activeState = state;
  activeBundle = bundle;
  activeRoomId = bundle.room.id;

  const record = snapshotRecord ?? (await loadOnlineSnapshot(bundle.room.id));
  applyOnlineSnapshot(state, bundle, record);
  await startSnapshotSubscription(bundle.room.id);
  showToast(`在线对局已开始，你是${buildOnlineRoomInfo(bundle, record).userCampName}。`);
}

export function leaveOnlineGame() {
  if (unsubscribeSnapshot) {
    unsubscribeSnapshot();
    unsubscribeSnapshot = null;
  }
  window.clearTimeout(snapshotRefreshTimer);
  snapshotRefreshTimer = null;
  activeRoomId = null;
  activeState = null;
  activeBundle = null;
}

export function isInOnlineRoom(roomId) {
  return activeRoomId === roomId;
}
