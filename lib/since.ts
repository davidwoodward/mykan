// The `created_since` / `updated_since` filters on list_items (KANBAN-70). Pure.

export type SinceFilter = { created_since?: string; updated_since?: string };

/**
 * Turn an ISO date or date/time into the ISO instant the query compares
 * against, or an error naming the field. A bare date ("2026-10-07") means the
 * start of that day in UTC, as `Date` reads it.
 */
export function parseSince(
  field: string,
  value: string | undefined,
): { ok: true; iso: string | null } | { ok: false; error: string } {
  const v = value?.trim();
  if (!v) return { ok: true, iso: null };
  const t = /^\d{4}-\d{2}-\d{2}/.test(v) ? Date.parse(v) : NaN;
  if (Number.isNaN(t)) {
    return { ok: false, error: `${field} must be an ISO date or date/time, e.g. 2026-10-07` };
  }
  return { ok: true, iso: new Date(t).toISOString() };
}
