import "server-only";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getSupabase } from "@/lib/supabase-server";
import { loadVisibleEntry, type ItemEntry } from "@/lib/item-entries";
import type { CoreResult } from "@/lib/projects-core";

/**
 * Shared gate for the web entry routes under /api/items/[id]/entries/[entryId]
 * (KANBAN-38): a signed-in user, an entry they may see (its item's project is
 * visible to them, via loadVisibleEntry), AND an entry that belongs to the item
 * in the URL, so /api/items/A/entries/<an entry of B> is the same 404 as a
 * missing entry.
 */
export async function gateEntry(
  itemId: string,
  entryId: string,
): Promise<{ error: NextResponse } | { email: string; entry: ItemEntry }> {
  const gate = await requireSession();
  if ("error" in gate && gate.error) return { error: gate.error };
  const v = await loadVisibleEntry(getSupabase(), gate.email, entryId);
  if (!v.ok && v.status !== 404) {
    return { error: NextResponse.json({ error: v.error }, { status: v.status }) };
  }
  if (!v.ok || v.data.entry.item_id !== itemId) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { email: gate.email, entry: v.data.entry };
}

/** A core result as a route response. */
export function coreResponse<T>(r: CoreResult<T>, okStatus = 200): NextResponse {
  return r.ok
    ? NextResponse.json(r.data, { status: okStatus })
    : NextResponse.json({ error: r.error }, { status: r.status });
}

/** The editor's per-open session id (≤64 chars), else null. */
export function editSessionOf(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= 64 ? v : null;
}
