// Epic picker / children ordering and sequential batch linking. Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareStatusThenNumber,
  linkSequentially,
  planEpicMove,
  planEpicOrder,
  sortByEpicPosition,
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

// The epic's own child order (KANBAN-68).
type Kid = { id: string; status: string; number: number; epic_position: number | null };
const kid = (id: string, status: string, epic_position: number | null, number = 0): Kid => ({
  id,
  status,
  number,
  epic_position,
});
const refOf = (c: { id: string }) => c.id.toUpperCase();
/** Apply a plan's writes and read the epic's sequence back. */
function after(kids: Kid[], writes: { id: string; epic_position: number }[]): string[] {
  const w = new Map(writes.map((x) => [x.id, x.epic_position]));
  return sortByEpicPosition(kids.map((k) => ({ ...k, epic_position: w.get(k.id) ?? k.epic_position }))).map(
    (k) => k.id,
  );
}

test("the epic sequence reads epic_position, unset last, then number", () => {
  const kids = [kid("c", "new", null, 1), kid("b", "new", 2048), kid("a", "new", 1024), kid("d", "new", null, 0)];
  assert.deepEqual(sortByEpicPosition(kids).map((k) => k.id), ["a", "b", "d", "c"]);
});

test("a move writes one midpoint position", () => {
  const kids = [kid("a", "new", 1024), kid("b", "new", 2048), kid("c", "new", 3072)];
  const p = planEpicMove(kids, "c", { before: "a" }, refOf);
  assert.ok(p.ok);
  assert.deepEqual(p.writes, [{ id: "c", epic_position: 0 }]);
  assert.deepEqual(after(kids, p.writes), ["c", "a", "b"]);
  const q = planEpicMove(kids, "a", { after: "b" }, refOf);
  assert.ok(q.ok);
  assert.deepEqual(q.writes, [{ id: "a", epic_position: 2560 }]);
});

test("top and bottom stay within the card's status group", () => {
  const kids = [
    kid("n1", "new", 1024),
    kid("t1", "testing", 2048),
    kid("n2", "new", 3072),
    kid("t2", "testing", 4096),
  ];
  const top = planEpicMove(kids, "t2", { to: "top" }, refOf);
  assert.ok(top.ok);
  assert.deepEqual(after(kids, top.writes), ["n1", "t2", "t1", "n2"]);
  const bottom = planEpicMove(kids, "n1", { to: "bottom" }, refOf);
  assert.ok(bottom.ok);
  assert.deepEqual(after(kids, bottom.writes), ["t1", "n2", "n1", "t2"]);
});

test("done cards don't move, and a move never crosses status groups", () => {
  const kids = [kid("d", "done", 1024), kid("n", "new", 2048), kid("b", "blocked", 3072)];
  const done = planEpicMove(kids, "d", { to: "bottom" }, refOf);
  assert.equal(done.ok, false);
  assert.match(!done.ok ? done.error : "", /D is done/);
  const cross = planEpicMove(kids, "n", { after: "b" }, refOf);
  assert.equal(cross.ok, false);
  assert.match(!cross.ok ? cross.error : "", /only within its own status group/);
});

test("a move to where the card already is writes nothing", () => {
  const kids = [kid("a", "new", 1024), kid("b", "new", 2048)];
  for (const t of [{ to: "top" as const }, { before: "b" }]) {
    const p = planEpicMove(kids, "a", t, refOf);
    assert.ok(p.ok);
    assert.deepEqual(p.writes, []);
  }
});

test("missing or shared positions renumber the epic", () => {
  const kids = [kid("a", "new", 1024), kid("b", "new", 1024, 2), kid("c", "new", null, 3)];
  const p = planEpicMove(kids, "c", { to: "top" }, refOf);
  assert.ok(p.ok);
  assert.deepEqual(after(kids, p.writes), ["c", "a", "b"]);
  assert.equal(new Set(p.writes.map((w) => w.epic_position)).size, p.writes.length);
});

test("an order list reorders the listed cards in their own places", () => {
  const kids = [
    kid("d", "done", 1024),
    kid("a", "new", 2048),
    kid("x", "blocked", 3072),
    kid("b", "new", 4096),
    kid("c", "new", 5120),
  ];
  const p = planEpicOrder(kids, ["c", "a", "b"]);
  assert.ok(p.ok);
  assert.deepEqual(after(kids, p.writes), ["d", "c", "x", "a", "b"]);
  assert.deepEqual(p.skipped, []);
});

test("an order list skips done cards and refuses strangers", () => {
  const kids = [kid("d", "done", 1024), kid("a", "new", 2048), kid("b", "new", 3072)];
  const p = planEpicOrder(kids, ["d", "b", "a", "b"]);
  assert.ok(p.ok);
  assert.deepEqual(p.skipped, ["d"]);
  assert.deepEqual(after(kids, p.writes), ["d", "b", "a"]);
  assert.equal(planEpicOrder(kids, ["zz"]).ok, false);
});
