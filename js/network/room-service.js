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
  logSupabaseError(action, error);
  const message = formatSupabaseError(error);
  if (message.includes("row-level security") || message.includes("permission denied")) {
    return new Error(`${action}失败：数据库 RLS 拒绝了本次写入。${message}`);
  }
  return new Error(`${action}失败：${message}`);
}

function formatSupabaseError(error) {
  const parts = [];
  if (error?.code) {
    parts.push(`code=${sanitizeSupabaseError(error.code)}`);
  }
  if (error?.message) {
    parts.push(`message=${sanitizeSupabaseError(error.message)}`);
  }
  if (error?.details) {
    parts.push(`details=${sanitizeSupabaseError(error.details)}`);
  }
  if (error?.hint) {
    parts.push(`hint=${sanitizeSupabaseError(error.hint)}`);
  }
  return parts.join("; ") || sanitizeSupabaseError(error);
}

function logSupabaseError(action, error) {
  console.error(`[Supabase] ${action}失败`, {
    code: error?.code ?? null,
    message: sanitizeSupabaseError(error?.message),
    details: sanitizeSupabaseError(error?.details),
    hint: sanitizeSupabaseError(error?.hint)
  });
}

export async function createFriendRoom(nickname) {
  const displayName = assertNickname(nickname);
  const { supabase, user } = await ensureAnonymousSession();

  if (!user?.id) {
    throw new Error("匿名登录未返回用户 ID，已停止创建房间。");
  }

  const roomResult = await supabase
    .rpc("create_friend_room", {
      p_display_name: displayName,
      p_room_code: null
    })
    .single();

  if (roomResult.error) {
    throw wrapRoomError("创建好友房 RPC", roomResult.error);
  }

  return loadRoomBundle(roomResult.data.id);
}

export async function joinFriendRoom(roomCode, nickname) {
  const code = normalizeRoomCode(roomCode);
  const displayName = assertNickname(nickname);
  if (code.length !== ROOM_CODE_LENGTH) {
    throw new Error("请输入 6 位房间码。");
  }

  const { supabase, user } = await ensureAnonymousSession();
  if (!user?.id) {
    throw new Error("匿名登录未返回用户 ID，已停止加入房间。");
  }

  const roomResult = await supabase
    .rpc("join_friend_room", {
      p_room_code: code,
      p_display_name: displayName
    })
    .single();

  if (roomResult.error) {
    throw wrapRoomError("加入好友房 RPC", roomResult.error);
  }

  return loadRoomBundle(roomResult.data.id);
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
