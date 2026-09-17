import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { keyError } from "@/lib/card-url";
import { keyWriteError } from "@/lib/key-rename";

/**
 * The project whose OLD key (alias, KANBAN-45) `key` is, or null. Expects the
 * canonical uppercase key. A failed lookup reads as "no alias" (logged), so a
 * database hiccup here degrades to a 404 / "not found" rather than an error
 * page, the same as before aliases existed.
 */
export async function aliasProjectId(sb: SupabaseClient, key: string): Promise<string | null> {
  if (keyError(key)) return null;
  const { data, error } = await sb
    .from("project_key_aliases")
    .select("project_id")
    .eq("key", key)
    .maybeSingle();
  if (error) {
    console.error("project_key_aliases lookup failed:", error.message);
    return null;
  }
  return (data as { project_id: string } | null)?.project_id ?? null;
}

/** A project's old keys (aliases), oldest first. */
export async function projectKeyAliases(sb: SupabaseClient, projectId: string): Promise<string[]> {
  const { data, error } = await sb
    .from("project_key_aliases")
    .select("key")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("project_key_aliases list failed:", error.message);
    return [];
  }
  return ((data ?? []) as { key: string }[]).map((r) => r.key);
}

/**
 * Why `key` can't be written as the key of project `projectId` (null when
 * creating a project), or null. Format and reserved words come from
 * lib/card-url.ts; whether another project holds it, as its current key or as
 * an old key, only the database can answer. The database enforces all of this
 * too (CHECKs, unique index, the alias trigger); this is the clear message up
 * front.
 */
export async function projectKeyWriteError(
  sb: SupabaseClient,
  key: string,
  projectId: string | null = null,
): Promise<{ error: string; status: number } | null> {
  const bad = keyError(key);
  if (bad) return { error: bad, status: 400 };
  const [owner, alias] = await Promise.all([
    sb.from("projects").select("id").eq("key", key).limit(1),
    sb.from("project_key_aliases").select("project_id").eq("key", key).limit(1),
  ]);
  if (owner.error) return { error: owner.error.message, status: 500 };
  if (alias.error) return { error: alias.error.message, status: 500 };
  return keyWriteError({
    next: key,
    projectId,
    keyOwnerId: ((owner.data ?? [])[0] as { id: string } | undefined)?.id ?? null,
    aliasOwnerId: ((alias.data ?? [])[0] as { project_id: string } | undefined)?.project_id ?? null,
  });
}

/** The database's refusal of a key write, as a user-facing message (else null). */
export function keyConstraintMessage(err: { code?: string; message: string }): string | null {
  const m = err.message ?? "";
  if (err.code === "23505" && m.includes("key")) return "That key is already used by another project";
  if (m.includes("projects_key_format")) return "A project key is 2 to 10 uppercase letters and digits, starting with a letter";
  if (m.includes("projects_key_not_reserved")) return "That key is reserved for the app's own pages";
  if (m.includes("is an old key of another project")) {
    return "That key is an old key of another project, and old links to it still go there. Choose another key.";
  }
  if (err.code === "23502" && m.includes("key")) return "A project key is required";
  return null;
}
