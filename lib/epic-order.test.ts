// Epic picker / children ordering and sequential batch linking. Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareStatusThenNumber,
  linkSequentially,
  sortByStatusThenNumber,
  statusRank,
} from "./epic-order.ts";
import type { ItemStatus } from "./types.ts";

type Row = { id: string; status: ItemStatus; number: number; position: number };
const row = (id: string, status: ItemStatus, number: number, position: number): Row => ({
  id,
  status,
  number,
  position,
});
const ids = (rows: Row[]) => rows.map((r) => r.id);

test("status ranks follow board column order", () => {
  assert.deepEqual(
    ["new", "in_progress", "blocked", "testing", "done"].map(statusRank),
    [0, 1, 2, 3, 4],
  );
});

test("sorts by status first, then number — never by board position", () => {
  const rows = [
    row("d9", "done", 9, 1),
    row("n7", "new", 7, 2),
    row("t3", "testing", 3, 3),
    row("p5", "in_progress", 5, 4),
    row("n2", "new", 2, 9000), // dragged to the bottom of the board
    row("b8", "blocked", 8, 5),
    row("p1", "in_progress", 1, 6000),
    row("d4", "done", 4, 0),
  ];
  assert.deepEqual(ids(sortByStatusThenNumber(rows)), [
    "n2",
    "n7",
    "p1",
    "p5",
    "b8",
    "t3",
    "d4",
    "d9",
  ]);
});

test("number wins within a status even when position disagrees", () => {
  const rows = [row("a", "new", 30, 1), row("b", "new", 4, 2), row("c", "new", 12, 3)];
  assert.deepEqual(ids(sortByStatusThenNumber(rows)), ["b", "c", "a"]);
});

test("does not mutate the input; empty is fine", () => {
  const rows = [row("x", "done", 2, 0), row("y", "new", 1, 1)];
  const copy = [...rows];
  sortByStatusThenNumber(rows);
  assert.deepEqual(rows, copy);
  assert.deepEqual(sortByStatusThenNumber([]), []);
});

test("an unknown status sorts after Done, not before Not started", () => {
  const odd = { status: "archived" as ItemStatus, number: 1 };
  assert.ok(compareStatusThenNumber(odd, { status: "done", number: 99 }) > 0);
  assert.ok(compareStatusThenNumber({ status: "new", number: 99 }, odd) < 0);
});

test("linkSequentially runs one at a time, in order, and reports failures", async () => {
  const log: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const progress: string[] = [];
  const failures = await linkSequentially(
    ["a", "b", "c", "d"],
    async (id) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      log.push(`start ${id}`);
      await new Promise((r) => setTimeout(r, 1));
      log.push(`end ${id}`);
      inFlight -= 1;
      if (id === "b") return "An epic cannot have a parent";
      if (id === "d") throw new Error("HTTP 500");
      return null;
    },
    (done, total) => progress.push(`${done}/${total}`),
  );
  assert.equal(maxInFlight, 1);
  assert.deepEqual(log, [
    "start a",
    "end a",
    "start b",
    "end b",
    "start c",
    "end c",
    "start d",
    "end d",
  ]);
  assert.deepEqual(failures, [
    { id: "b", error: "An epic cannot have a parent" },
    { id: "d", error: "HTTP 500" },
  ]);
  assert.deepEqual(progress, ["1/4", "2/4", "3/4", "4/4"]);
});

test("linkSequentially with no ids does nothing", async () => {
  let calls = 0;
  const failures = await linkSequentially([], async () => {
    calls += 1;
    return null;
  });
  assert.deepEqual(failures, []);
  assert.equal(calls, 0);
});
