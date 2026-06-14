import { ensureAnonymousSession, saveNickname } from "./auth-service.js";
import { sanitizeSupabaseError } from "./supabase-client.js";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;

function normalizeRoomCode(code) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, ROOM_CODE_LENGTH);
}

function createRoomCode() {
  const values = new Uint32Array(ROOM_CODE_LENGTH);
  window.crypto?.getRandomValues?.(values);

  return Array.from({ length: ROOM_CODE_LENGTH }, (_, index) => {
    const value = values[index] || Math.floor(Math.random() * ROOM_CODE_ALPHABET.length);
    return ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length];
  }).join("");
}

function assertNickname(nickname) {
  const cleanName = saveNickname(nickname);
  if (!cleanName) {
    throw new Error("请输入 1 至 24 个字符的昵称。");
  }
  return cleanName;
}

function buildInviteUrl(code) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", code);
  return url.toString();
}

function wrapRoomError(action, error) {
  const message = sanitizeSupabaseError(error);
  if (message.includes("row-level security") || message.includes("permission denied")) {
    return new Error(`${action}失败：数据库 RLS 拒绝了本次写入，请确认已为好友房创建安全的写入策略或 Edge Function。`);
  }
  return new Error(`${action}失败：${message}`);
}

export async function createFriendRoom(nickname) {
  const displayName = assertNickname(nickname);
  const { supabase, user } = await ensureAnonymousSession();

  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = createRoomCode();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 6).toISOString();

    const roomResult = await supabase
      .from("rooms")
      .insert({
        code,
        status: "waiting",
        host_user_id: user.id,
        red_user_id: user.id,
        current_turn: null,
        expires_at: expiresAt
      })
      .select("id, code, status, host_user_id, red_user_id, black_user_id, version, created_at")
      .single();

    if (roomResult.error) {
      lastError = roomResult.error;
      if (roomResult.error.code === "23505") {
        continue;
      }
      throw wrapRoomError("创建房间", roomResult.error);
    }

    const memberResult = await supabase
      .from("room_members")
      .insert({
        room_id: roomResult.data.id,
        user_id: user.id,
        display_name: displayName,
        camp: "red",
        is_host: true,
        ready: false,
        connected: true,
        last_seen_at: new Date().toISOString()
      })
      .select("id")
      .single();

    if (memberResult.error) {
      throw wrapRoomError("创建房间成员", memberResult.error);
    }

    return loadRoomBundle(roomResult.data.id);
  }

  throw wrapRoomError("创建房间", lastError ?? new Error("房间码生成冲突，请重试。"));
}

export async function joinFriendRoom(roomCode, nickname) {
  const code = normalizeRoomCode(roomCode);
  const displayName = assertNickname(nickname);
  if (code.length !== ROOM_CODE_LENGTH) {
    throw new Error("请输入 6 位房间码。");
  }

  const { supabase, user } = await ensureAnonymousSession();
  const roomResult = await supabase
    .from("rooms")
    .select("id, code, status, host_user_id, red_user_id, black_user_id, version, created_at")
    .eq("code", code)
    .maybeSingle();

  if (roomResult.error) {
    throw wrapRoomError("查询房间", roomResult.error);
  }

  const room = roomResult.data;
  if (!room) {
    throw new Error("未找到该房间，或当前 RLS 策略不允许非成员通过房间码查询。");
  }
  if (room.status !== "waiting") {
    throw new Error("该房间已经开始或已关闭，无法加入。");
  }

  const existingMember = await supabase
    .from("room_members")
    .select("id, camp")
    .eq("room_id", room.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingMember.error) {
    throw wrapRoomError("查询成员", existingMember.error);
  }

  if (existingMember.data) {
    return loadRoomBundle(room.id);
  }

  if (room.black_user_id && room.black_user_id !== user.id) {
    throw new Error("该房间黑方位置已满。");
  }

  const updateResult = await supabase
    .from("rooms")
    .update({ black_user_id: user.id })
    .eq("id", room.id)
    .is("black_user_id", null)
    .select("id")
    .maybeSingle();

  if (updateResult.error) {
    throw wrapRoomError("加入房间", updateResult.error);
  }

  if (!updateResult.data && room.black_user_id !== user.id) {
    throw new Error("该房间刚刚被其他玩家加入。");
  }

  const memberResult = await supabase
    .from("room_members")
    .insert({
      room_id: room.id,
      user_id: user.id,
      display_name: displayName,
      camp: "black",
      is_host: false,
      ready: false,
      connected: true,
      last_seen_at: new Date().toISOString()
    })
    .select("id")
    .single();

  if (memberResult.error) {
    throw wrapRoomError("加入房间成员", memberResult.error);
  }

  return loadRoomBundle(room.id);
}

export async function loadRoomBundle(roomId) {
  const { supabase, user } = await ensureAnonymousSession();
  const roomResult = await supabase
    .from("rooms")
    .select("id, code, status, host_user_id, red_user_id, black_user_id, version, created_at")
    .eq("id", roomId)
    .single();

  if (roomResult.error) {
    throw wrapRoomError("读取房间", roomResult.error);
  }

  const membersResult = await supabase
    .from("room_members")
    .select("id, room_id, user_id, display_name, camp, is_host, ready, connected, joined_at, last_seen_at")
    .eq("room_id", roomId)
    .order("camp", { ascending: false });

  if (membersResult.error) {
    throw wrapRoomError("读取房间成员", membersResult.error);
  }

  return {
    room: roomResult.data,
    members: membersResult.data ?? [],
    currentUserId: user.id,
    inviteUrl: buildInviteUrl(roomResult.data.code)
  };
}

export async function setReady(roomId, ready) {
  const { supabase, user } = await ensureAnonymousSession();
  const result = await supabase
    .from("room_members")
    .update({
      ready,
      last_seen_at: new Date().toISOString()
    })
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .select("id")
    .single();

  if (result.error) {
    throw wrapRoomError("更新准备状态", result.error);
  }

  return loadRoomBundle(roomId);
}

export async function copyInviteLink(inviteUrl) {
  await navigator.clipboard.writeText(inviteUrl);
}

export function subscribeRoom(roomId, onChange) {
  const channelName = `room-lobby-${roomId}`;
  return ensureAnonymousSession().then(({ supabase }) => {
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        onChange
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_members", filter: `room_id=eq.${roomId}` },
        onChange
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  });
}

export { normalizeRoomCode };
