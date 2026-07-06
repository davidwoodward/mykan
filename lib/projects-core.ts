import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project } from "@/lib/types";

export type CoreResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number };

export function coreOk<T>(data: T): CoreResult<T> {
  return { ok: true, data };
}
export function coreErr(error: string, status = 400): CoreResult<never> {
  return { ok: false, error, status };
}

/** Projects visible to `actor`: the ones they own plus any shared with them. */
export async function listProjects(
  sb: SupabaseClient,
  actor: string,
): Promise<CoreResult<Project[]>> {
  const { data, error } = await sb
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return coreErr(error.message, 500);
  const visible = (data ?? []).filter(
    (p) => p.created_by === actor || (p.shared_with ?? []).includes(actor),
  ) as Project[];
  return coreOk(visible);
}

/**
 * Resolve a project by id or case-insensitive name, enforcing visibility.
 * A project the actor can't see is reported as "not found" (never reveal it).
 */
export async function resolveProject(
  sb: SupabaseClient,
  actor: string,
  ref: string,
): Promise<CoreResult<Project>> {
  const list = await listProjects(sb, actor);
  if (!list.ok) return list;
  const r = ref.trim();
  const byId = list.data.find((p) => p.id === r);
  if (byId) return coreOk(byId);
  const lc = r.toLowerCase();
  const named = list.data.filter((p) => p.name.trim().toLowerCase() === lc);
  if (named.length === 1) return coreOk(named[0]);
  if (named.length > 1) return coreErr(`Multiple projects named "${r}" — use the id`, 400);
  return coreErr(`Project not found: ${r}`, 404);
}
