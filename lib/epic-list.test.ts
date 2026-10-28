// The list_epics rendering (KANBAN-67). Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatEpicList, type EpicListSource } from "./epic-list.ts";

const item = (
  number: number,
  type: string,
  status: EpicListSource["status"],
  name: string,
  parent: string | null = null,
): EpicListSource => ({ ref: `PS-${number}`, number, type, status, name, parent });

test("epics only, in board column order then number, with child progress", () => {
  const out = formatEpicList([
    item(9, "epic", "done", "Old launch"),
    item(12, "epic", "in_progress", "Chat first text <2 s"),
    item(3, "epic", "in_progress", "Onboarding"),
    item(20, "epic", "new", "Billing"),
    item(13, "task", "done", "Baseline", "PS-12"),
    item(14, "bug", "in_progress", "Timings", "PS-12"),
    item(15, "task", "done", "Ship it", "PS-9"),
    item(16, "feature", "new", "Loose card"),
  ]);
  assert.equal(
    out,
    [
      "```",
      "#   Epic   Status       Done  Note",
      "--  -----  -----------  ----  --------------------",
      "1   PS-20  new          0/0   Billing",
      "2   PS-3   in_progress  0/0   Onboarding",
      "3   PS-12  in_progress  1/2   Chat first text <2 s",
      "4   PS-9   done         1/1   Old launch",
      "```",
    ].join("\n"),
  );
});

test("a project with no epics says so", () => {
  assert.equal(formatEpicList([item(1, "task", "new", "Just a task")]), "No epics in this project.");
});

test("a multi-line or spaced title stays on one line", () => {
  const out = formatEpicList([item(1, "epic", "new", "  Two\n  lines  ")]);
  assert.match(out, /1   PS-1  new     0\/0   Two lines\n/);
});
