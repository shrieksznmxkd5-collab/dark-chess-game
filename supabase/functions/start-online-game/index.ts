import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  CAMPS,
  createEngineState,
  createPublicSnapshot
} from "../../../shared/engine/index.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}

function sanitizeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "未知错误");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "只支持 POST 请求。" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const authorization = request.headers.get("Authorization");

    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse({ error: "Edge Function 缺少 Supabase 环境变量。" }, 500);
    }

    if (!authorization) {
      return jsonResponse({ error: "需要登录后才能开始在线棋局。" }, 401);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authorization
        }
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });

    const userResult = await supabase.auth.getUser();
    if (userResult.error || !userResult.data.user) {
      return jsonResponse(
        {
          error: "登录状态无效，请重新进入好友房。",
          details: userResult.error?.message ?? null
        },
        401
      );
    }

    const body = await request.json().catch(() => ({}));
    const roomId = String(body.roomId ?? body.room_id ?? "").trim();
    if (!roomId) {
      return jsonResponse({ error: "缺少 roomId。" }, 400);
    }

    const privateState = {
      ...createEngineState(),
      roomId,
      version: 1,
      currentCamp: CAMPS.RED,
      message: "在线对局开始，红方先行。"
    };

    const publicSnapshot = createPublicSnapshot(privateState);
    publicSnapshot.roomId = roomId;
    publicSnapshot.version = 1;
    publicSnapshot.currentCamp = CAMPS.RED;
    publicSnapshot.message = privateState.message;

    const commitResult = await supabase
      .rpc("commit_online_game_start", {
        p_room_id: roomId,
        p_private_state: privateState,
        p_public_snapshot: publicSnapshot
      })
      .single();

    if (commitResult.error) {
      return jsonResponse(
        {
          error: "初始化在线棋局失败。",
          code: commitResult.error.code,
          message: commitResult.error.message,
          details: commitResult.error.details,
          hint: commitResult.error.hint
        },
        400
      );
    }

    return jsonResponse({
      roomId,
      status: commitResult.data.status,
      version: commitResult.data.version,
      currentTurn: commitResult.data.current_turn,
      snapshot: commitResult.data.snapshot
    });
  } catch (error) {
    return jsonResponse(
      {
        error: "初始化在线棋局时发生异常。",
        message: sanitizeError(error)
      },
      500
    );
  }
});
