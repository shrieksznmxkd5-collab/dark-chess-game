import { getSavedNickname } from "./auth-service.js";
import {
  copyInviteLink,
  createFriendRoom,
  joinFriendRoom,
  loadRoomBundle,
  normalizeRoomCode,
  setReady,
  subscribeRoom
} from "./room-service.js";
import { showToast } from "../renderer.js";

let currentBundle = null;
let unsubscribeLobby = null;
let refreshTimer = null;

function getElement(id) {
  return document.getElementById(id);
}

function ensureOnlineDialogs() {
  if (!getElement("onlineEntryDialog")) {
    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <dialog id="onlineEntryDialog" class="online-dialog">
          <form id="onlineEntryForm" class="online-form">
            <h2 id="onlineEntryTitle">在线好友房</h2>
            <p id="onlineEntryHint" class="online-hint">进入在线模式前，请先输入昵称。</p>
            <label>
              <span>昵称</span>
              <input id="onlineNicknameInput" name="nickname" maxlength="24" autocomplete="nickname" required />
            </label>
            <label id="onlineRoomCodeField">
              <span>房间码</span>
              <input id="onlineRoomCodeInput" name="roomCode" maxlength="6" autocomplete="off" />
            </label>
            <p id="onlineEntryError" class="online-error" role="alert"></p>
            <div class="online-actions">
              <button id="onlineEntryCancelBtn" type="button">取消</button>
              <button id="onlineEntrySubmitBtn" type="submit">确认</button>
            </div>
          </form>
        </dialog>
      `
    );
  }

  if (!getElement("onlineLobbyDialog")) {
    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <dialog id="onlineLobbyDialog" class="online-dialog online-lobby-dialog">
          <section class="online-lobby">
            <div class="online-lobby-head">
              <div>
                <p class="online-hint">在线好友房</p>
                <h2>房间 <span id="onlineRoomCodeText">------</span></h2>
              </div>
              <button id="onlineLobbyCloseBtn" type="button">关闭</button>
            </div>
            <label class="invite-box">
              <span>邀请链接</span>
              <input id="onlineInviteInput" readonly />
            </label>
            <div class="online-actions">
              <button id="copyInviteBtn" type="button">复制邀请链接</button>
              <button id="refreshLobbyBtn" type="button">刷新大厅</button>
            </div>
            <div class="online-seats" aria-live="polite">
              <article class="online-seat red-seat">
                <span>红方</span>
                <strong id="onlineRedName">等待中</strong>
                <small id="onlineRedReady">未准备</small>
              </article>
              <article class="online-seat black-seat">
                <span>黑方</span>
                <strong id="onlineBlackName">等待中</strong>
                <small id="onlineBlackReady">未准备</small>
              </article>
            </div>
            <p id="onlineLobbyStatus" class="online-lobby-status">等待玩家加入。</p>
            <div class="online-actions">
              <button id="onlineReadyBtn" type="button">准备</button>
            </div>
          </section>
        </dialog>
      `
    );

    getElement("onlineLobbyCloseBtn").addEventListener("click", closeLobby);
    getElement("copyInviteBtn").addEventListener("click", async () => {
      if (!currentBundle?.inviteUrl) {
        return;
      }
      try {
        await copyInviteLink(currentBundle.inviteUrl);
        showToast("邀请链接已复制。");
      } catch {
        showToast("复制失败，请手动复制邀请链接。");
      }
    });
    getElement("refreshLobbyBtn").addEventListener("click", refreshLobby);
    getElement("onlineReadyBtn").addEventListener("click", toggleReady);
  }
}

function setEntryBusy(isBusy) {
  const submit = getElement("onlineEntrySubmitBtn");
  const cancel = getElement("onlineEntryCancelBtn");
  if (submit) {
    submit.disabled = isBusy;
    submit.textContent = isBusy ? "连接中..." : "确认";
  }
  if (cancel) {
    cancel.disabled = isBusy;
  }
}

function setEntryError(message = "") {
  const error = getElement("onlineEntryError");
  if (error) {
    error.textContent = message;
  }
}

function requestOnlineEntry({ mode, roomCode = "" }) {
  ensureOnlineDialogs();
  const dialog = getElement("onlineEntryDialog");
  const form = getElement("onlineEntryForm");
  const title = getElement("onlineEntryTitle");
  const hint = getElement("onlineEntryHint");
  const nicknameInput = getElement("onlineNicknameInput");
  const roomCodeField = getElement("onlineRoomCodeField");
  const roomCodeInput = getElement("onlineRoomCodeInput");

  title.textContent = mode === "create" ? "创建好友房" : "加入好友房";
  hint.textContent =
    mode === "create"
      ? "将先进行 Supabase 匿名登录，然后创建房间。"
      : "将先进行 Supabase 匿名登录，然后通过房间码加入。";
  nicknameInput.value = getSavedNickname();
  roomCodeField.hidden = mode === "create";
  roomCodeInput.required = mode !== "create";
  roomCodeInput.value = normalizeRoomCode(roomCode);
  setEntryError("");
  setEntryBusy(false);

  return new Promise((resolve) => {
    const cleanup = () => {
      form.removeEventListener("submit", handleSubmit);
      getElement("onlineEntryCancelBtn").removeEventListener("click", handleCancel);
      dialog.removeEventListener("cancel", handleCancel);
    };

    const handleCancel = () => {
      cleanup();
      dialog.close();
      resolve(null);
    };

    const handleSubmit = (event) => {
      event.preventDefault();
      const nickname = nicknameInput.value.trim();
      const cleanRoomCode = normalizeRoomCode(roomCodeInput.value);

      if (!nickname) {
        setEntryError("请输入昵称。");
        return;
      }

      if (mode !== "create" && cleanRoomCode.length !== 6) {
        setEntryError("请输入 6 位房间码。");
        return;
      }

      cleanup();
      dialog.close();
      resolve({ nickname, roomCode: cleanRoomCode });
    };

    form.addEventListener("submit", handleSubmit);
    getElement("onlineEntryCancelBtn").addEventListener("click", handleCancel);
    dialog.addEventListener("cancel", handleCancel);
    dialog.showModal();
    nicknameInput.focus();
  });
}

function getMember(camp) {
  return currentBundle?.members.find((member) => member.camp === camp) ?? null;
}

function getCurrentMember() {
  return currentBundle?.members.find((member) => member.user_id === currentBundle.currentUserId) ?? null;
}

function renderLobby(bundle) {
  ensureOnlineDialogs();
  currentBundle = bundle;
  const red = getMember("red");
  const black = getMember("black");
  const currentMember = getCurrentMember();
  const bothReady = Boolean(red?.ready && black?.ready);

  getElement("onlineRoomCodeText").textContent = bundle.room.code;
  getElement("onlineInviteInput").value = bundle.inviteUrl;
  getElement("onlineRedName").textContent = red?.display_name ?? "等待中";
  getElement("onlineBlackName").textContent = black?.display_name ?? "等待中";
  getElement("onlineRedReady").textContent = red ? (red.ready ? "已准备" : "未准备") : "空位";
  getElement("onlineBlackReady").textContent = black ? (black.ready ? "已准备" : "未准备") : "空位";

  const readyButton = getElement("onlineReadyBtn");
  readyButton.disabled = !currentMember;
  readyButton.textContent = currentMember?.ready ? "取消准备" : "准备";

  getElement("onlineLobbyStatus").textContent = bothReady
    ? "双方已准备。在线走棋将在下一阶段开放。"
    : black
      ? "等待双方准备。"
      : "房主为红方，等待黑方玩家加入。";

  const dialog = getElement("onlineLobbyDialog");
  if (!dialog.open) {
    dialog.showModal();
  }
}

function scheduleLobbyRefresh() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refreshLobby, 180);
}

async function startLobbySubscription(roomId) {
  if (unsubscribeLobby) {
    unsubscribeLobby();
    unsubscribeLobby = null;
  }

  try {
    unsubscribeLobby = await subscribeRoom(roomId, scheduleLobbyRefresh);
  } catch {
    unsubscribeLobby = null;
  }
}

async function showLobby(bundle) {
  renderLobby(bundle);
  await startLobbySubscription(bundle.room.id);
}

async function refreshLobby() {
  if (!currentBundle?.room?.id) {
    return;
  }

  try {
    renderLobby(await loadRoomBundle(currentBundle.room.id));
  } catch (error) {
    showToast(error.message);
  }
}

async function toggleReady() {
  const currentMember = getCurrentMember();
  if (!currentBundle?.room?.id || !currentMember) {
    return;
  }

  const button = getElement("onlineReadyBtn");
  button.disabled = true;
  try {
    renderLobby(await setReady(currentBundle.room.id, !currentMember.ready));
  } catch (error) {
    showToast(error.message);
    button.disabled = false;
  }
}

export function closeLobby() {
  if (unsubscribeLobby) {
    unsubscribeLobby();
    unsubscribeLobby = null;
  }
  window.clearTimeout(refreshTimer);
  refreshTimer = null;
  currentBundle = null;
  const dialog = getElement("onlineLobbyDialog");
  if (dialog?.open) {
    dialog.close();
  }
}

export async function openCreateRoomFlow() {
  const entry = await requestOnlineEntry({ mode: "create" });
  if (!entry) {
    return;
  }

  setEntryBusy(true);
  showToast("正在匿名登录并创建房间...");
  try {
    const bundle = await createFriendRoom(entry.nickname);
    getElement("onlineEntryDialog")?.close();
    showToast("房间已创建，匿名登录成功。");
    await showLobby(bundle);
  } catch (error) {
    window.alert(error.message);
    showToast(error.message);
  }
}

export async function openJoinRoomFlow(roomCode = "") {
  const entry = await requestOnlineEntry({ mode: "join", roomCode });
  if (!entry) {
    return;
  }

  setEntryBusy(true);
  showToast("正在匿名登录并加入房间...");
  try {
    const bundle = await joinFriendRoom(entry.roomCode, entry.nickname);
    getElement("onlineEntryDialog")?.close();
    showToast("已加入房间，匿名登录成功。");
    await showLobby(bundle);
  } catch (error) {
    window.alert(error.message);
    showToast(error.message);
  }
}
