// Deleting an epic writes history on each child (KANBAN-41). Pure — the database
// steps are fakes that record the order of calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteWithChildHistory, type EpicDeleteSteps } from "./epic-delete.ts";
import { parentChangeSummary, type ItemSnapshot } from "./item-snapshot.ts";

function fake(
  childIds: string[],
  fail: { unlink?: string; relink?: string; delete?: boolean } = {},
) {
  const log: string[] = [];
  const steps: EpicDeleteSteps = {
    childIds,
    unlink: async (id) => {
      log.push(`unlink ${id}`);
      return fail.unlink === id ? "boom" : null;
    },
    relink: async (id) => {
      log.push(`relink ${id}`);
      return fail.relink === id ? "boom" : null;
    },
    deleteItem: async () => {
      log.push("delete");
      return fail.delete ? "db down" : null;
    },
  };
  return { steps, log };
}

test("every child (archived ones included) is unlinked before the epic is deleted", async () => {
  const { steps, log } = fake(["a", "b-archived", "c"]);
  const out = await deleteWithChildHistory(steps);
  assert.deepEqual(out, { ok: true, unlinked: ["a", "b-archived", "c"] });
  assert.deepEqual(log, ["unlink a", "unlink b-archived", "unlink c", "delete"]);
});

test("an item with no children is simply deleted", async () => {
  const { steps, log } = fake([]);
  assert.deepEqual(await deleteWithChildHistory(steps), { ok: true, unlinked: [] });
  assert.deepEqual(log, ["delete"]);
});

test("a failed unlink re-links the children already unlinked and deletes nothing", async () => {
  const { steps, log } = fake(["a", "b", "c"], { unlink: "b" });
  const out = await deleteWithChildHistory(steps);
  assert.equal(out.ok, false);
  assert.ok(!out.ok && out.deleted === false && out.relinkFailed.length === 0);
  assert.match(!out.ok ? out.error : "", /nothing was deleted/);
  assert.deepEqual(log, ["unlink a", "unlink b", "relink a"]);
});

test("a failed delete re-links every child", async () => {
  const { steps, log } = fake(["a", "b"], { delete: true });
  const out = await deleteWithChildHistory(steps);
  assert.equal(out.ok, false);
  assert.match(!out.ok ? out.error : "", /linked back/);
  assert.deepEqual(log, ["unlink a", "unlink b", "delete", "relink a", "relink b"]);
});

test("a re-link that also fails is reported, and the rest still re-link", async () => {
  const { steps, log } = fake(["a", "b"], { delete: true, relink: "a" });
  const out = await deleteWithChildHistory(steps);
  assert.ok(!out.ok);
  assert.deepEqual(!out.ok ? out.relinkFailed : null, ["a"]);
  assert.deepEqual(log.slice(-2), ["relink a", "relink b"]);
});

const snap = (over: Partial<ItemSnapshot> = {}): ItemSnapshot => ({
  body: null,
  tags: [],
  assignees: [],
  category_id: null,
  parent_id: null,
  type: "feature",
  status: "new",
  ...over,
});
const refOf = (id: string) => ({ e1: "KANBAN-34", e2: "KANBAN-40" })[id] ?? "a deleted epic";

test("history names the deleted epic even though its row is gone", () => {
  const before = snap({
    parent_id: "gone",
    parent_ref: "KANBAN-34",
    parent_cleared_reason: "epic_deleted",
  });
  assert.equal(
    parentChangeSummary(before, { parent_id: null }, refOf),
    "parent KANBAN-34 removed (epic deleted)",
  );
});

test("history lines for adding, moving and removing a parent", () => {
  assert.equal(parentChangeSummary(snap(), { parent_id: "e1" }, refOf), "parent → KANBAN-34");
  assert.equal(
    parentChangeSummary(snap({ parent_id: "e1" }), { parent_id: "e2" }, refOf),
    "parent KANBAN-34 → KANBAN-40",
  );
  assert.equal(
    parentChangeSummary(snap({ parent_id: "e1" }), { parent_id: null }, refOf),
    "parent KANBAN-34 removed",
  );
  // An old snapshot with no parent_id key.
  const old = snap();
  delete old.parent_id;
  assert.equal(parentChangeSummary(old, { parent_id: null }, refOf), "parent removed");
});
