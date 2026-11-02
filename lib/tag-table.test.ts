// The tag_table rendering (KANBAN-69). Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTagTable } from "./tag-table.ts";

const card = (ref: string, status: string, name: string, done_at: string | null = null) => ({
  ref,
  type: "task",
  status,
  name,
  done_at,
});

test("cards numbered by status group, done by completion first, given order within a group", () => {
  const out = formatTagTable("wt-2026-10-30", [
    card("AMOS-3", "new", "Third"),
    card("KANBAN-9", "done", "Later done", "2026-10-31T10:00:00Z"),
    card("KANBAN-2", "in_progress", "Doing"),
    card("AMOS-1", "done", "Earlier done", "2026-10-30T10:00:00Z"),
    card("KANBAN-5", "new", "Fourth"),
  ]);
  assert.equal(
    out,
    [
      "```",
      "#   Card      Type  Status       Note",
      "--  --------  ----  -----------  ------------",
      "1   AMOS-1    task  done         Earlier done",
      "2   KANBAN-9  task  done         Later done",
      "3   KANBAN-2  task  in_progress  Doing",
      "4   AMOS-3    task  new          Third",
      "5   KANBAN-5  task  new          Fourth",
      "```",
    ].join("\n"),
  );
});

test("no cards says so", () => {
  assert.equal(formatTagTable("nope", []), "No cards tagged nope.");
});

test("width cuts titles so every line fits", () => {
  const out = formatTagTable("t", [card("K-1", "new", "x".repeat(100))], 40);
  for (const l of out.split("\n")) assert.ok(l.length <= 40);
  assert.match(out, /x…\n/);
});
