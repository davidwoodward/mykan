// Board filters/grouping/search in the URL (KANBAN-44). Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BOARD_STATE,
  boardSearch,
  boardStateFromParams,
  boardStateToParams,
  normAreaPath,
  type BoardState,
} from "./board-state.ts";

test("defaults serialise to nothing and parse back to defaults", () => {
  assert.equal(boardSearch(DEFAULT_BOARD_STATE), "");
  assert.deepEqual(boardStateFromParams(new URLSearchParams("")), DEFAULT_BOARD_STATE);
  assert.deepEqual(boardStateFromParams({}), DEFAULT_BOARD_STATE);
});

test("round trip of a fully set state", () => {
  const s: BoardState = {
    view: "board",
    group: "area",
    status: ["blocked", "new"],
    tags: ["ui", "mcp"],
    area: "coach/home",
    by: "dawoodward@gmail.com",
    q: "scroll & back, 100%",
    archived: true,
  };
  const qs = boardStateToParams(s).toString();
  const back = boardStateFromParams(new URLSearchParams(qs));
  // Status is written in board column order.
  assert.deepEqual(back, { ...s, status: ["new", "blocked"] });
  assert.match(qs, /status=new%2Cblocked/);
});

test("unknown and junk values fall back to defaults", () => {
  const s = boardStateFromParams(
    new URLSearchParams("view=grid&group=owner&status=done,bogus,done&archived=yes&area=%20%20"),
  );
  assert.equal(s.view, "list");
  assert.equal(s.group, "status");
  assert.deepEqual(s.status, ["done"]);
  assert.equal(s.archived, false);
  assert.equal(s.area, null);
});

test("Next searchParams objects (arrays take the first value)", () => {
  const s = boardStateFromParams({ view: ["board", "list"], tags: "UI,,ui , mcp", by: " Dawoodward@Gmail.com " });
  assert.equal(s.view, "board");
  assert.deepEqual(s.tags, ["ui", "mcp"]);
  assert.equal(s.by, "dawoodward@gmail.com");
});

test("area paths are compared slash- and case-insensitively, never as ids", () => {
  assert.equal(normAreaPath("Coach / Home"), "coach/home");
  const s = boardStateFromParams(new URLSearchParams("area=Coach%20/%20Home"));
  assert.equal(s.area, "coach/home");
  assert.equal(boardSearch({ ...DEFAULT_BOARD_STATE, area: "Coach / Home" }), "?area=coach%2Fhome");
});

test("search text survives as typed (not trimmed)", () => {
  const s = boardStateFromParams(boardStateToParams({ ...DEFAULT_BOARD_STATE, q: "  two words " }));
  assert.equal(s.q, "  two words ");
});
