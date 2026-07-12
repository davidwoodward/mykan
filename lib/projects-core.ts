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
  // Fetch the project rows and the per-project item activity CONCURRENTLY. The
  // activity query used to filter by the visible project ids, which forced it to
  // wait for the projects query first — two sequential round-trips to Supabase
  // (the dominant cost of this endpoint from Vercel). Dropping that dependency
  // lets both run in parallel; we only read activity for visible projects below,
  // so fetching every item's (project_id, updated_at) is harmless — two tiny
  // columns. (If the item count ever grows large enough that this transfer
  // matters, denormalise a `last_activity_at` column onto projects via a trigger
  // and select+order in one query.)
  const [projectsRes, itemsRes] = await Promise.all([
    sb.from("projects").select("*"),
    sb.from("items").select("project_id, updated_at"),
  ]);
  if (projectsRes.error) return coreErr(projectsRes.error.message, 500);
  if (itemsRes.error) return coreErr(itemsRes.error.message, 500);

  const visible = (projectsRes.data ?? []).filter(
    (p) => p.created_by === actor || (p.shared_with ?? []).includes(actor),
  ) as Project[];
  if (visible.length === 0) return coreOk(visible);

  // Max item activity per visible project. ISO-8601 timestamps from Postgres
  // share one format, so lexical string comparison is chronological.
  const lastActivity = new Map<string, string>();
  for (const row of (itemsRes.data ?? []) as { project_id: string; updated_at: string }[]) {
    const cur = lastActivity.get(row.project_id);
    if (!cur || row.updated_at > cur) lastActivity.set(row.project_id, row.updated_at);
  }

  // Stamp each project's last activity, then order by it (most recent first).
  for (const p of visible) {
    p.last_activity = lastActivity.get(p.id) ?? p.updated_at ?? p.created_at ?? null;
  }
  visible.sort((a, b) => {
    const at = a.last_activity ?? "";
    const bt = b.last_activity ?? "";
    return at < bt ? 1 : at > bt ? -1 : 0;
  });
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
