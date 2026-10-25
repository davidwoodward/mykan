// The epic_table rendering. Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatEpicTable, type EpicTableRow } from "./epic-table.ts";

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
