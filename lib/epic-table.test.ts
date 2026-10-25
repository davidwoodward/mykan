// The epic_table rendering. Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatEpicTable, orderEpicChildren, type EpicTableRow } from "./epic-table.ts";

const row = (ref: string, type: string, status: string, name: string): EpicTableRow => ({
  ref,
  type,
  status,
  name,
});

test("epic row first with a blank #, children numbered in the order given", () => {
  const out = formatEpicTable(row("PS-147", "epic", "new", "Chat first text <2 s"), [
    row("PS-150", "task", "done", "Baseline of 100+ QA turns"),
    row("PS-148", "bug", "in_progress", "Log per-turn timings"),
  ]);
  assert.equal(
    out,
    [
      "```",
      "#   Card    Type  Status       Note",
      "--  ------  ----  -----------  -------------------------",
      "    PS-147  epic  new          Chat first text <2 s",
      "1   PS-150  task  done         Baseline of 100+ QA turns",
      "2   PS-148  bug   in_progress  Log per-turn timings",
      "```",
    ].join("\n"),
  );
});

test("an epic with no children is just the epic row", () => {
  const lines = formatEpicTable(row("K-1", "epic", "new", "Solo"), []).split("\n");
  assert.equal(lines.length, 5);
  assert.match(lines[3], /^ {4}K-1/);
});

test("no line carries trailing spaces, and a title with stray whitespace stays on one line", () => {
  const out = formatEpicTable(row("K-1", "epic", "new", "  A\ttitle  "), [
    row("K-2", "task", "new", ""),
  ]);
  for (const l of out.split("\n")) assert.equal(l, l.trimEnd());
  assert.match(out, /K-1 {3}epic {2}new {5}A title\n/);
});

test("children order: done by completion time, then testing, in progress, blocked, new", () => {
  const c = (ref: string, status: string, done_at: string | null = null) => ({
    ...row(ref, "task", status, ref),
    done_at,
  });
  const ordered = orderEpicChildren([
    c("K-1", "new"),
    c("K-2", "done", "2026-10-20T10:00:00Z"),
    c("K-3", "in_progress"),
    c("K-4", "done", null),
    c("K-5", "blocked"),
    c("K-6", "done", "2026-10-18T10:00:00Z"),
    c("K-7", "testing"),
    c("K-8", "new"),
    c("K-9", "in_progress"),
  ]);
  assert.deepEqual(
    ordered.map((r) => r.ref),
    ["K-6", "K-2", "K-4", "K-7", "K-3", "K-9", "K-5", "K-1", "K-8"],
  );
});

test("done_at orders rows but never appears in the table", () => {
  const out = formatEpicTable(row("K-1", "epic", "new", "E"), [
    { ...row("K-2", "task", "done", "Shipped"), done_at: "2026-10-18T10:00:00Z" },
  ]);
  assert.doesNotMatch(out, /2026/);
});
