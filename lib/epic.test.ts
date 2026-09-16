// Epic parent/child rules (KANBAN-41). Pure — no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  epicProgress,
  parentLinkError,
  typeChangeError,
  type ParentLinkNode,
} from "./types.ts";

const P1 = "project-1";
const P2 = "project-2";
const epic = (over: Partial<ParentLinkNode> = {}): ParentLinkNode => ({
  id: "epic-1",
  type: "epic",
  project_id: P1,
  parent_id: null,
  archived_at: null,
  ...over,
});
const child = { id: "child-1", project_id: P1 };

test("a non-epic may link to a live epic in the same project", () => {
  assert.equal(parentLinkError(child, "feature", epic()), null);
  assert.equal(parentLinkError({ id: null, project_id: P1 }, "bug", epic()), null);
});

test("clearing the parent is always allowed", () => {
  assert.equal(parentLinkError(child, "feature", null), null);
  assert.equal(parentLinkError(child, "epic", null), null);
});

test("no self-parent", () => {
  assert.match(
    parentLinkError({ id: "epic-1", project_id: P1 }, "feature", epic()) ?? "",
    /own parent/,
  );
});

test("one level only: an epic cannot have a parent", () => {
  assert.match(parentLinkError(child, "epic", epic()) ?? "", /epic cannot have a parent/);
});

test("the parent must be an epic", () => {
  const msg = parentLinkError(child, "feature", epic({ type: "task" }), {
    parentRef: "KANBAN-7",
  });
  assert.equal(msg, "The parent must be an epic; KANBAN-7 is not an epic");
});

test("same project only", () => {
  assert.match(
    parentLinkError(child, "feature", epic({ project_id: P2 })) ?? "",
    /same project/,
  );
});

test("a parent that itself has a parent is refused", () => {
  assert.match(
    parentLinkError(child, "feature", epic({ parent_id: "other" })) ?? "",
    /cannot itself have a parent/,
  );
});

test("an archived epic is refused as a new parent, but allowed when asked", () => {
  const archived = epic({ archived_at: "2026-09-16T00:00:00Z" });
  assert.match(parentLinkError(child, "feature", archived) ?? "", /archived/);
  assert.equal(parentLinkError(child, "feature", archived, { allowArchived: true }), null);
});

test("an epic with children cannot change type; one without can", () => {
  assert.match(typeChangeError("epic", "feature", 2, false) ?? "", /has 2 child items/);
  assert.match(typeChangeError("epic", "bug", 1, false) ?? "", /has 1 child item;/);
  assert.equal(typeChangeError("epic", "feature", 0, false), null);
  assert.equal(typeChangeError("epic", "epic", 5, false), null);
});

test("an item with a parent cannot become an epic", () => {
  assert.match(typeChangeError("feature", "epic", 0, true) ?? "", /clear its parent/);
  assert.equal(typeChangeError("feature", "epic", 0, false), null);
  assert.equal(typeChangeError("feature", "bug", 0, true), null);
});

test("epic progress counts non-archived children only", () => {
  assert.deepEqual(epicProgress([]), { done: 0, total: 0 });
  assert.deepEqual(
    epicProgress([
      { status: "done" },
      { status: "in_progress" },
      { status: "done", archived_at: "2026-09-01T00:00:00Z" },
      { status: "new", archived_at: null },
    ]),
    { done: 1, total: 3 },
  );
});
