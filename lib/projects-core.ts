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

/**
 * Projects visible to `actor`: the ones they own plus any shared with them,
 * ordered by most recently touched item first (the max `items.updated_at`
 * across the project's items — every item mutation stamps `updated_at`). A
 * project with no items falls back to its own `updated_at`/`created_at`, so
 * freshly created empty projects still surface near the top.
 */
export async function listProjects(
  sb: SupabaseClient,
  actor: string,
): Promise<CoreResult<Project[]>> {
  const { data, error } = await sb.from("projects").select("*");
  if (error) return coreErr(error.message, 500);
  const visible = (data ?? []).filter(
    (p) => p.created_by === actor || (p.shared_with ?? []).includes(actor),
  ) as Project[];
  if (visible.length === 0) return coreOk(visible);

  // Max item activity per visible project. ISO-8601 timestamps from Postgres
  // share one format, so lexical string comparison is chronological.
  const lastActivity = new Map<string, string>();
  const { data: rows, error: itemsErr } = await sb
    .from("items")
    .select("project_id, updated_at")
    .in(
      "project_id",
      visible.map((p) => p.id),
    );
  if (itemsErr) return coreErr(itemsErr.message, 500);
  for (const row of (rows ?? []) as { project_id: string; updated_at: string }[]) {
    const cur = lastActivity.get(row.project_id);
    if (!cur || row.updated_at > cur) lastActivity.set(row.project_id, row.updated_at);
  }

  const touchedAt = (p: Project) =>
    lastActivity.get(p.id) ?? p.updated_at ?? p.created_at ?? "";
  visible.sort((a, b) => (touchedAt(a) < touchedAt(b) ? 1 : touchedAt(a) > touchedAt(b) ? -1 : 0));
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
