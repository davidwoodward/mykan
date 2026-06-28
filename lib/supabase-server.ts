import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Private Storage bucket holding inline images for item rich-text bodies. */
export const ITEM_IMAGES_BUCKET = "item-images";

/** Private Storage bucket holding item file attachments. */
export const ITEM_ATTACHMENTS_BUCKET = "item-attachments";

/**
 * mykan's tables live in their own `mykan` Postgres schema (not `public`).
 * The shared Supabase project hosts several apps, each isolated to its own
 * exposed schema. The Data API (PostgREST) must have `mykan` in its exposed
 * schemas for this to resolve. Storage buckets are unaffected — they go
 * through the separate Storage API, independent of the DB schema.
 */
const DB_SCHEMA = "mykan";

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
  // db.schema targets mykan's schema. The generic is widened back to the
  // default-typed SupabaseClient (the schema is a runtime PostgREST header; the
  // codebase uses an untyped Database, so the schema generic carries no safety).
  cached = createClient(url, key, {
    db: { schema: DB_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as SupabaseClient;
  return cached;
}
