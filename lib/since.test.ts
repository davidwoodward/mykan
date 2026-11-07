// The list_items date filters (KANBAN-70). Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSince } from "./since.ts";

test("absent or blank means no filter", () => {
  assert.deepEqual(parseSince("created_since", undefined), { ok: true, iso: null });
  assert.deepEqual(parseSince("created_since", "  "), { ok: true, iso: null });
});

test("a bare date is the start of that day, UTC", () => {
  assert.deepEqual(parseSince("created_since", "2026-10-07"), {
    ok: true,
    iso: "2026-10-07T00:00:00.000Z",
  });
});

test("a date/time with an offset is normalised to UTC", () => {
  assert.deepEqual(parseSince("updated_since", "2026-10-07T09:30:00-07:00"), {
    ok: true,
    iso: "2026-10-07T16:30:00.000Z",
  });
});

test("anything else is refused with the field name", () => {
  for (const bad of ["last month", "10/07/2026", "2026-13-45", "yesterday"]) {
    const r = parseSince("created_since", bad);
    assert.equal(r.ok, false, bad);
    if (!r.ok) assert.match(r.error, /^created_since must be an ISO date/);
  }
});
