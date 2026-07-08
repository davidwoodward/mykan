import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { denyItemAccess, requireSession } from "@/lib/api-auth";
import { categoryInProject, listCategories, pathOf } from "@/lib/categories-core";
import { displayName } from "@/lib/format";
import {
  listItemVersions,
  snapshotOf,
  snapshotThenWrite,
  type ItemSnapshot,
} from "@/lib/item-history";
import {
  richDocText,
  STATUS_LABEL,
  TYPE_LABEL,
  type Item,
  type Category,
} from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/** What the history panel renders per entry. */
export type HistoryEntry = {
  id: string;
  created_at: string;
  created_by: string | null;
  source: string;
  /** Compact per-field change summaries, e.g. ["tags +urgent −later"]. */
  changes: string[];
  /** Plain-text preview of the snapshot's body (what Restore would bring back). */
  body_text: string;
};

function arrayDiff(before: string[], after: string[], label: (v: string) => string) {
  const adds = after.filter((v) => !before.includes(v)).map((v) => `+${label(v)}`);
  const rems = before.filter((v) => !after.includes(v)).map((v) => `−${label(v)}`);
  return [...adds, ...rems].join(" ");
}

/**
 * Summarise what the write following `snap` changed, using the state it
 * produced (`after` — the next-newer snapshot, or the current row for the
 * newest entry).
 */
function summarize(
  fields: string[],
  snap: ItemSnapshot,
  after: ItemSnapshot,
  cats: Category[],
): string[] {
  return fields.map((f) => {
    switch (f) {
      case "body":
        return "body edited";
      case "tags":
        return `tags ${arrayDiff(snap.tags ?? [], after.tags ?? [], (t) => t)}`;
      case "assignees":
        return `assignees ${arrayDiff(snap.assignees ?? [], after.assignees ?? [], displayName)}`;
      case "category_id": {
        const path = after.category_id ? pathOf(cats, after.category_id) : "";
        return `area → ${path || "unfiled"}`;
      }
      case "type":
        return `type → ${TYPE_LABEL[after.type] ?? after.type}`;
      case "status":
        return `status → ${STATUS_LABEL[after.status] ?? after.status}`;
      default:
        return f;
    }
  });
}

async function loadCurrent(id: string): Promise<Item | null> {
  const { data } = await getSupabase()
    .from("items")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return (data as Item) ?? null;
}

/** The item's history, newest first, with display-ready change summaries. */
export async function GET(_req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const deny = await denyItemAccess(id, gate.email);
  if (deny) return deny;

  const current = await loadCurrent(id);
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });

  const versions = await listItemVersions(getSupabase(), id);
  if (!versions.ok) {
    return NextResponse.json({ error: versions.error }, { status: versions.status });
  }
  const cats = await listCategories(getSupabase(), current.project_id);

  const entries: HistoryEntry[] = versions.data.map((v, i) => {
    const after = i === 0 ? snapshotOf(current) : versions.data[i - 1].snapshot;
    return {
      id: v.id,
      created_at: v.created_at,
      created_by: v.created_by,
      source: v.source,
      changes: summarize(v.fields_changed, v.snapshot, after, cats),
      body_text: richDocText(v.snapshot.body),
    };
  });
  return NextResponse.json(entries);
}

/**
 * Recover: restore a snapshot as the item's new state. Just another write
 * through snapshotThenWrite, so the pre-recovery state is snapshotted first —
 * recovery is itself reversible.
 */
export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const deny = await denyItemAccess(id, gate.email);
  if (deny) return deny;

  const body = (await req.json().catch(() => ({}))) as { version_id?: unknown };
  if (typeof body.version_id !== "string") {
    return NextResponse.json({ error: "version_id required" }, { status: 400 });
  }

  const current = await loadCurrent(id);
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: vrow } = await getSupabase()
    .from("item_versions")
    .select("*")
    .eq("id", body.version_id)
    .eq("item_id", id)
    .maybeSingle();
  if (!vrow) {
    return NextResponse.json({ error: "version not found" }, { status: 404 });
  }
  const snap = (vrow as { snapshot: ItemSnapshot }).snapshot;

  // The snapshot's area may have been deleted since; restore as unfiled then.
  const category_id =
    snap.category_id &&
    (await categoryInProject(getSupabase(), current.project_id, snap.category_id))
      ? snap.category_id
      : null;

  const patch: Record<string, unknown> = {
    body: snap.body,
    tags: snap.tags ?? [],
    assignees: snap.assignees ?? [],
    category_id,
    type: snap.type,
    status: snap.status,
  };
  // Keep the Done-ordering timestamp coherent with a restored status.
  if (snap.status !== current.status) {
    patch.done_at = snap.status === "done" ? new Date().toISOString() : null;
  }

  const w = await snapshotThenWrite(getSupabase(), gate.email, current, patch, "recovery");
  if (!w.ok) return NextResponse.json({ error: w.error }, { status: w.status });
  return NextResponse.json(w.data);
}
