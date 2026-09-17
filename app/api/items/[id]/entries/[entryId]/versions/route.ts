import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { coreResponse, gateEntry } from "@/lib/api-entries";
import {
  entrySnapshotOf,
  listEntryVersions,
  restoreEntryVersion,
} from "@/lib/item-entries";
import { entryChangeSummary } from "@/lib/entry-panels";

type Ctx = { params: Promise<{ id: string; entryId: string }> };

/** What an entry's history list renders per version. */
export type EntryHistoryEntry = {
  id: string;
  created_at: string;
  created_by: string | null;
  source: string;
  /** Short change summaries, e.g. ["text edited"], ["deleted"]. */
  changes: string[];
  /** The entry's text before this change (what Restore would bring back). */
  body_text: string;
};

/**
 * An entry's history, newest first, with display-ready change summaries: the
 * same shape and idea as the card's history (app/api/items/[id]/history).
 */
export async function GET(_req: Request, { params }: Ctx) {
  const { id, entryId } = await params;
  const g = await gateEntry(id, entryId);
  if ("error" in g) return g.error;

  const versions = await listEntryVersions(getSupabase(), g.email, g.entry.id);
  if (!versions.ok) return coreResponse(versions);
  const now = entrySnapshotOf(g.entry);
  const out: EntryHistoryEntry[] = versions.data.map((v, i) => {
    const after = i === 0 ? now : versions.data[i - 1].snapshot;
    return {
      id: v.id,
      created_at: v.created_at,
      created_by: v.created_by,
      source: v.source,
      changes: entryChangeSummary(v.fields_changed, v.snapshot, after),
      body_text: v.snapshot.body,
    };
  });
  return NextResponse.json(out);
}

/**
 * Restore a version as the entry's new state. Just another versioned write, so
 * the pre-restore state is recorded first and the restore can be undone.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id, entryId } = await params;
  const g = await gateEntry(id, entryId);
  if ("error" in g) return g.error;

  const body = (await req.json().catch(() => ({}))) as { version_id?: unknown };
  if (typeof body.version_id !== "string") {
    return NextResponse.json({ error: "version_id required" }, { status: 400 });
  }
  return coreResponse(
    await restoreEntryVersion(getSupabase(), g.email, g.entry.id, body.version_id, "recovery"),
  );
}
