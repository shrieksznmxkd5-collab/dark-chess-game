import { ensureAnonymousSession } from "./auth-service.js";
import { sanitizeSupabaseError } from "./supabase-client.js";

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

function wrapOnlineError(action, error) {
  console.error(`[Supabase] ${action}失败`, {
    code: error?.code ?? null,
    message: sanitizeSupabaseError(error?.message),
    details: sanitizeSupabaseError(error?.details),
    hint: sanitizeSupabaseError(error?.hint)
  });
  return new Error(`${action}失败：${formatSupabaseError(error)}`);
}

export async function startOnlineGame(roomId) {
  const { supabase } = await ensureAnonymousSession();
  const result = await supabase.functions.invoke("start-online-game", {
    body: { roomId }
  });

  if (result.error) {
    throw wrapOnlineError("初始化在线棋局", result.error);
  }

  if (result.data?.error) {
    throw wrapOnlineError("初始化在线棋局", result.data);
  }

  return result.data;
}

export async function loadOnlineSnapshot(roomId) {
  const { supabase } = await ensureAnonymousSession();
  const result = await supabase
    .from("game_snapshots_public")
    .select("room_id, snapshot, version, current_turn, updated_at")
    .eq("room_id", roomId)
    .single();

  if (result.error) {
    throw wrapOnlineError("读取在线棋局快照", result.error);
  }

  return result.data;
}

export function subscribeOnlineSnapshot(roomId, onChange) {
  const channelName = `online-game-${roomId}`;
  return ensureAnonymousSession().then(({ supabase }) => {
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_snapshots_public",
          filter: `room_id=eq.${roomId}`
        },
        onChange
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  });
}
