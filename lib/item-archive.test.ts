// archive_item / unarchive_item planning (KANBAN-72). Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planArchive } from "./item-archive.ts";

const NOW = new Date("2026-11-14T20:00:00.000Z");

test("archiving a live card stamps archived_at", () => {
  assert.deepEqual(planArchive(null, true, "KANBAN-1", NOW), {
    change: true,
    patch: { archived_at: "2026-11-14T20:00:00.000Z" },
  });
});

test("unarchiving an archived card clears archived_at", () => {
  assert.deepEqual(planArchive("2026-11-01T00:00:00Z", false, "KANBAN-1", NOW), {
    change: true,
    patch: { archived_at: null },
  });
});

test("archiving an already-archived card is a no-op that keeps the original stamp", () => {
  assert.deepEqual(planArchive("2026-11-01T00:00:00Z", true, "KANBAN-1", NOW), {
    change: false,
    message: "KANBAN-1 is already archived",
  });
});

test("unarchiving a live card is a no-op", () => {
  for (const live of [null, undefined, ""]) {
    assert.deepEqual(planArchive(live, false, "KANBAN-1", NOW), {
      change: false,
      message: "KANBAN-1 is not archived",
    });
  }
});
