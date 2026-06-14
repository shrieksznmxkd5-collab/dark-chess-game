import {
  getSupabaseClient,
  hasSupabaseConfig,
  sanitizeSupabaseError
} from "./supabase-client.js";

const NICKNAME_KEY = "undercover-xiangqi-online-nickname";

export function getSavedNickname() {
  return window.localStorage.getItem(NICKNAME_KEY) ?? "";
}

export function saveNickname(nickname) {
  const cleanName = nickname.trim().slice(0, 24);
  if (cleanName) {
    window.localStorage.setItem(NICKNAME_KEY, cleanName);
  }
  return cleanName;
}

export async function ensureAnonymousSession() {
  if (!hasSupabaseConfig()) {
    throw new Error("Supabase 配置尚未填写，请先填写 Project URL 和 Publishable Key。");
  }

  try {
    const supabase = getSupabaseClient();
    const sessionResult = await supabase.auth.getSession();
    if (sessionResult.error) {
      throw sessionResult.error;
    }

    const existingUser = sessionResult.data.session?.user;
    if (existingUser) {
      return { supabase, user: existingUser };
    }

    const loginResult = await supabase.auth.signInAnonymously();
    if (loginResult.error) {
      throw loginResult.error;
    }

    const user = loginResult.data.user ?? loginResult.data.session?.user;
    if (!user) {
      throw new Error("匿名登录未返回用户信息，请检查 Supabase Auth 匿名登录是否已启用。");
    }

    return { supabase, user };
  } catch (error) {
    throw new Error(`Supabase 匿名登录失败：${sanitizeSupabaseError(error)}`);
  }
}
