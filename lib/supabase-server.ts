import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Private Storage bucket holding inline images for item rich-text bodies. */
export const ITEM_IMAGES_BUCKET = "item-images";

let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "Set them in .env.local (local) or Vercel project env (prod).",
    );
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
