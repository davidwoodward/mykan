// Pure item-history shapes and rules (no DB, no "server-only"), so they can be
// unit-tested with `node --test`. lib/item-history.ts re-exports these and owns
// the database writes. Imports are type-only: Node strips them at runtime.
import type { Item, ItemStatus, ItemType, RichDoc } from "@/lib/types";

/** The mutable fields history tracks. Position/archived/done_at are noise. */
export const TRACKED_FIELDS = [
  "body",
  "tags",
  "assignees",
  "category_id",
  "parent_id",
  "type",
  "status",
] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

/**
 * The tracked slice of an item at one moment. `parent_id` is optional because
 * snapshots written before KANBAN-41 (epics) don't carry it; a missing key
 * means "unknown", which is different from null ("no parent").
 */
export type ItemSnapshot = {
  body: RichDoc | null;
  tags: string[];
  assignees: string[];
  category_id: string | null;
  parent_id?: string | null;
  type: ItemType;
  status: ItemStatus;
  /**
   * Annotation, not item state: the ref of `parent_id` (e.g. "KANBAN-34"),
   * recorded when the write that follows removes the parent for a reason the
   * history must still name after the epic row is gone.
   */
  parent_ref?: string;
  /** Annotation: why the following write cleared the parent. */
  parent_cleared_reason?: "epic_deleted";
};

/** Extra annotation fields a writer may attach to the snapshot it records. */
export type SnapshotAnnotations = Pick<ItemSnapshot, "parent_ref" | "parent_cleared_reason">;

/**
 * The history-panel line for a write that changed the parent: from `before`
 * (the snapshot) to `after` (the next state). `refOf` names an epic by id; a
 * deleted epic can't be looked up, so the snapshot's `parent_ref` wins then.
 */
export function parentChangeSummary(
  before: ItemSnapshot,
  after: { parent_id?: string | null },
  refOf: (id: string) => string,
): string {
  const prev = before.parent_id ?? null;
  const next = after.parent_id ?? null;
  if (next) {
    return prev && prev !== next
      ? `parent ${before.parent_ref ?? refOf(prev)} → ${refOf(next)}`
      : `parent → ${refOf(next)}`;
  }
  const name = before.parent_ref ?? (prev ? refOf(prev) : "");
  const why = before.parent_cleared_reason === "epic_deleted" ? " (epic deleted)" : "";
  return name ? `parent ${name} removed${why}` : `parent removed${why}`;
}

export function snapshotOf(item: Item): ItemSnapshot {
  return {
    body: item.body,
    tags: item.tags,
    assignees: item.assignees,
    category_id: item.category_id,
    parent_id: item.parent_id ?? null,
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
 * The parent a snapshot records: a string/null when the snapshot knows it, or
 * undefined when the snapshot predates parent links (no `parent_id` key).
 */
export function snapshotParentId(snap: ItemSnapshot): string | null | undefined {
  return "parent_id" in snap ? (snap.parent_id ?? null) : undefined;
}

/**
 * The patch that restores `snap` onto `current`. The caller resolves the
 * references that may have gone stale since the snapshot (the area and the
 * parent epic) and passes the values to write:
 *  - `category_id`: the snapshot's area if it still exists, else null.
 *  - `parent_id`: the snapshot's parent if still valid, else null; or
 *    undefined when the snapshot predates parent links — the current parent is
 *    then left untouched rather than guessed.
 * Restoring an epic always clears the parent (epics are one level only).
 */
export function restorePatch(
  snap: ItemSnapshot,
  current: Item,
  resolved: { category_id: string | null; parent_id: string | null | undefined },
  now: Date = new Date(),
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    body: snap.body,
    tags: snap.tags ?? [],
    assignees: snap.assignees ?? [],
    category_id: resolved.category_id,
    type: snap.type,
    status: snap.status,
  };
  if (resolved.parent_id !== undefined) patch.parent_id = resolved.parent_id;
  if (snap.type === "epic" && (patch.parent_id ?? current.parent_id ?? null) !== null) {
    patch.parent_id = null;
  }
  // Keep the Done-ordering timestamp coherent with a restored status.
  if (snap.status !== current.status) {
    patch.done_at = snap.status === "done" ? now.toISOString() : null;
  }
  return patch;
}
