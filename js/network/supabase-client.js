import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL
} from "./supabase-config.js";

const URL_PLACEHOLDER = "PASTE_SUPABASE_URL_HERE";
const KEY_PLACEHOLDER = "PASTE_SUPABASE_PUBLISHABLE_KEY_HERE";

let supabaseClient = null;

export function getNormalizedSupabaseUrl() {
  return SUPABASE_URL.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
}

export function sanitizeSupabaseError(error) {
  return String(error?.message ?? error ?? "Unknown Supabase error")
    .replaceAll(SUPABASE_URL, "[supabase-url]")
    .replaceAll(getNormalizedSupabaseUrl(), "[supabase-url]")
    .replaceAll(SUPABASE_PUBLISHABLE_KEY, "[publishable-key]");
}

export function hasSupabaseConfig() {
  return (
    SUPABASE_URL &&
    SUPABASE_PUBLISHABLE_KEY &&
    SUPABASE_URL !== URL_PLACEHOLDER &&
    SUPABASE_PUBLISHABLE_KEY !== KEY_PLACEHOLDER
  );
}

export function getSupabaseClient() {
  if (!hasSupabaseConfig()) {
    throw new Error("Supabase config is missing. Fill js/network/supabase-config.js first.");
  }

  if (!supabaseClient) {
    supabaseClient = createClient(getNormalizedSupabaseUrl(), SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true
      }
    });
  }

  return supabaseClient;
}
