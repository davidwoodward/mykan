import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { keyError } from "@/lib/card-url";

/**
 * Why `key` can't be given to a new project (or to a legacy project that has
 * none), or null. Format and reserved words come from lib/card-url.ts; the one
 * thing only the database can answer is whether another project already has it.
 * The database enforces all of this too (CHECK + unique index + NOT NULL); this
 * is the clear message up front.
 */
export async function projectKeyWriteError(
  sb: SupabaseClient,
  key: string,
): Promise<{ error: string; status: number } | null> {
  const bad = keyError(key);
  if (bad) return { error: bad, status: 400 };
  const { data, error } = await sb.from("projects").select("id").eq("key", key).limit(1);
  if (error) return { error: error.message, status: 500 };
  if ((data ?? []).length > 0) {
    return { error: `The key ${key} is already used by another project`, status: 409 };
  }
  return null;
}

/** The database's refusal of a key write, as a user-facing message (else null). */
export function keyConstraintMessage(err: { code?: string; message: string }): string | null {
  const m = err.message ?? "";
  if (err.code === "23505" && m.includes("key")) return "That key is already used by another project";
  if (m.includes("projects_key_format")) return "A project key is 2 to 10 uppercase letters and digits, starting with a letter";
  if (m.includes("projects_key_not_reserved")) return "That key is reserved for the app's own pages";
  if (m.includes("project key is permanent")) return "A project key is permanent once set";
  if (err.code === "23502" && m.includes("key")) return "A project key is required";
  return null;
}
