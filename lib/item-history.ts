import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Item, ItemStatus, ItemType, RichDoc } from "@/lib/types";
import { coreErr, coreOk, type CoreResult } from "@/lib/projects-core";

/**
 * Item history (KANBAN-10). Every field mutation — web PATCH, MCP tools,
 * Telegram — routes through snapshotThenWrite, the single write chokepoint:
 * it records a snapshot of the item's PREVIOUS state, then applies the patch.
 * History is only as reliable as the sloppiest writer, so no mutator may
 * update tracked fields on `items` directly.
 */

/** The mutable fields history tracks. Position/archived/done_at are noise. */
export const TRACKED_FIELDS = [
  "body",
  "tags",
  "assignees",
  "category_id",
  "type",
  "status",
] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

export type HistorySource = "web" | "mcp" | "telegram" | "recovery";

/** The tracked slice of an item at one moment. */
export type ItemSnapshot = {
  body: RichDoc | null;
  tags: string[];
  assignees: string[];
  category_id: string | null;
  type: ItemType;
  status: ItemStatus;
};

export type ItemVersion = {
  id: string;
  item_id: string;
  snapshot: ItemSnapshot;
  /** Which tracked fields the write FOLLOWING this snapshot changed. */
  fields_changed: TrackedField[];
  source: HistorySource;
  created_at: string;
  created_by: string | null;
};

/**
 * A body edit is continuous typing saved in ~700ms debounced bursts; one
 * history entry per editing session is the useful granularity. A body-only
 * write coalesces into the latest entry when that entry is also a body-only
 * edit by the same actor + source and younger than this window.
 */
const BODY_BURST_WINDOW_MS = 15 * 60 * 1000;

export function snapshotOf(item: Item): ItemSnapshot {
  return {
    body: item.body,
    tags: item.tags,
    assignees: item.assignees,
    category_id: item.category_id,
    type: item.type,
    status: item.status,
  };
}

/** Value equality per tracked field (arrays/docs compared structurally). */
function fieldEqual(field: TrackedField, a: unknown, b: unknown): boolean {
  if (field === "body") return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (field === "tags" || field === "assignees") {
    return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  }
  return (a ?? null) === (b ?? null);
}

/** The tracked fields a patch would actually change on the current row. */
export function changedTrackedFields(
  current: Item,
  patch: Record<string, unknown>,
): TrackedField[] {
  return TRACKED_FIELDS.filter(
    (f) => f in patch && !fieldEqual(f, current[f], patch[f]),
  );
}

/**
 * The write chokepoint: snapshot the item's previous state (when a tracked
 * field changes), then apply the patch. Callers pass the freshly loaded
 * `current` row — no second fetch. Stamps updated_at/updated_by itself.
 *
 * Snapshot rules:
 *  - no tracked field changes → write only (dedupe; covers no-op body flushes
 *    and untracked writes like position/archived).
 *  - body-only change coalescing into a recent body-only entry by the same
 *    actor + source → write only (one entry per editing session).
 *  - otherwise insert a snapshot of the PREVIOUS state, then write.
 */
export async function snapshotThenWrite(
  sb: SupabaseClient,
  actor: string,
  current: Item,
  patch: Record<string, unknown>,
  source: HistorySource,
): Promise<CoreResult<Item>> {
  const changed = changedTrackedFields(current, patch);

  if (changed.length > 0 && !(await coalescesIntoLatest(sb, current.id, actor, source, changed))) {
    const { error: verr } = await sb.from("item_versions").insert({
      item_id: current.id,
      snapshot: snapshotOf(current),
      fields_changed: changed,
      source,
      created_by: actor,
    });
    if (verr) return coreErr(verr.message, 500);
  }

  const { data, error } = await sb
    .from("items")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
      updated_by: actor,
    })
    .eq("id", current.id)
    .select()
    .single();
  if (error) return coreErr(error.message, 500);
  return coreOk(data as Item);
}

/** True when a body-only change should fold into the latest history entry. */
async function coalescesIntoLatest(
  sb: SupabaseClient,
  itemId: string,
  actor: string,
  source: HistorySource,
  changed: TrackedField[],
): Promise<boolean> {
  if (!(changed.length === 1 && changed[0] === "body")) return false;
  const { data } = await sb
    .from("item_versions")
    .select("fields_changed, source, created_at, created_by")
    .eq("item_id", itemId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  const latest = data as Pick<
    ItemVersion,
    "fields_changed" | "source" | "created_at" | "created_by"
  >;
  return (
    latest.created_by === actor &&
    latest.source === source &&
    latest.fields_changed.length === 1 &&
    latest.fields_changed[0] === "body" &&
    Date.now() - new Date(latest.created_at).getTime() < BODY_BURST_WINDOW_MS
  );
}

/** All history entries for an item, newest first. */
export async function listItemVersions(
  sb: SupabaseClient,
  itemId: string,
): Promise<CoreResult<ItemVersion[]>> {
  const { data, error } = await sb
    .from("item_versions")
    .select("*")
    .eq("item_id", itemId)
    .order("created_at", { ascending: false });
  if (error) return coreErr(error.message, 500);
  return coreOk((data ?? []) as ItemVersion[]);
}
