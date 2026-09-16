// Item history snapshots with epic parent links (KANBAN-41). Pure — no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRACKED_FIELDS,
  changedTrackedFields,
  restorePatch,
  snapshotOf,
  snapshotParentId,
  type ItemSnapshot,
} from "./item-snapshot.ts";
import type { Item } from "./types.ts";

const item = (over: Partial<Item> = {}): Item => ({
  id: "item-1",
  project_id: "project-1",
  number: 12,
  type: "feature",
  status: "new",
  position: 1024,
  body: { type: "doc", content: [] },
  tags: [],
  assignees: [],
  category_id: null,
  parent_id: null,
  attachments: [],
  archived_at: null,
  github_issue: null,
  github_issue_created_at: null,
  github_imported_at: null,
  github_sync: null,
  done_at: null,
  created_at: "2026-09-16T00:00:00Z",
  updated_at: "2026-09-16T00:00:00Z",
  created_by: null,
  updated_by: null,
  ...over,
});

test("parent_id is a tracked field and part of the snapshot", () => {
  assert.ok((TRACKED_FIELDS as readonly string[]).includes("parent_id"));
  assert.equal(snapshotOf(item({ parent_id: "epic-1" })).parent_id, "epic-1");
  assert.equal(snapshotOf(item()).parent_id, null);
});

test("a snapshot of a row read before the column existed records null, not undefined", () => {
  const legacyRow = item();
  delete (legacyRow as Partial<Item>).parent_id;
  const snap = snapshotOf(legacyRow);
  assert.ok("parent_id" in snap);
  assert.equal(snap.parent_id, null);
});

test("changing the parent is reported in fields_changed", () => {
  assert.deepEqual(changedTrackedFields(item(), { parent_id: "epic-1" }), ["parent_id"]);
  assert.deepEqual(
    changedTrackedFields(item({ parent_id: "epic-1" }), { parent_id: null }),
    ["parent_id"],
  );
  assert.deepEqual(changedTrackedFields(item({ parent_id: "epic-1" }), { parent_id: "epic-1" }), []);
  // null and a missing value are the same "no parent".
  const legacyRow = item();
  delete (legacyRow as Partial<Item>).parent_id;
  assert.deepEqual(changedTrackedFields(legacyRow, { parent_id: null }), []);
});

// A snapshot stored before KANBAN-41: no parent_id key at all.
const oldSnapshot = {
  body: { type: "doc", content: [] },
  tags: ["old"],
  assignees: [],
  category_id: null,
  type: "bug",
  status: "in_progress",
} as ItemSnapshot;

test("an old snapshot's parent is unknown (undefined), not 'no parent'", () => {
  assert.equal(snapshotParentId(oldSnapshot), undefined);
  assert.equal(snapshotParentId({ ...oldSnapshot, parent_id: null }), null);
  assert.equal(snapshotParentId({ ...oldSnapshot, parent_id: "epic-1" }), "epic-1");
});

test("restoring an old snapshot leaves the current parent link untouched", () => {
  const current = item({ parent_id: "epic-1", tags: ["new"] });
  const patch = restorePatch(oldSnapshot, current, {
    category_id: null,
    parent_id: snapshotParentId(oldSnapshot),
  });
  assert.ok(!("parent_id" in patch));
  assert.deepEqual(patch.tags, ["old"]);
  assert.equal(patch.type, "bug");
  // …so history doesn't record a parent change either.
  assert.ok(!changedTrackedFields(current, patch).includes("parent_id"));
});

test("restoring a snapshot that recorded a parent writes the resolved parent", () => {
  const snap: ItemSnapshot = { ...oldSnapshot, parent_id: "epic-1" };
  const current = item({ parent_id: null });
  assert.equal(
    restorePatch(snap, current, { category_id: null, parent_id: "epic-1" }).parent_id,
    "epic-1",
  );
  // A parent that's gone stale since is resolved to null by the caller.
  assert.equal(
    restorePatch(snap, current, { category_id: null, parent_id: null }).parent_id,
    null,
  );
});

test("restoring an epic clears any parent, even from an old snapshot", () => {
  const snap = { ...oldSnapshot, type: "epic" } as ItemSnapshot;
  const current = item({ type: "feature", parent_id: "epic-9" });
  const patch = restorePatch(snap, current, { category_id: null, parent_id: undefined });
  assert.equal(patch.parent_id, null);
});

test("restore keeps done_at coherent with the restored status", () => {
  const now = new Date("2026-09-16T12:00:00Z");
  const toDone = restorePatch(
    { ...oldSnapshot, status: "done" },
    item({ status: "new" }),
    { category_id: null, parent_id: undefined },
    now,
  );
  assert.equal(toDone.done_at, now.toISOString());
  const same = restorePatch(
    { ...oldSnapshot, status: "new" },
    item({ status: "new" }),
    { category_id: null, parent_id: undefined },
    now,
  );
  assert.ok(!("done_at" in same));
});
