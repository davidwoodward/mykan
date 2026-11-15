// The three-state tag filter (KANBAN-73). Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cycleTag,
  parseTagQuery,
  passesTagFilter,
  setTagState,
  tagStateOf,
  type TagFilter,
} from "./tag-filter.ts";

const none: TagFilter = { include: [], exclude: [] };

test("the cycle goes off → include → exclude → off", () => {
  const a = cycleTag("ui", none);
  assert.deepEqual(a, { include: ["ui"], exclude: [] });
  assert.equal(tagStateOf("ui", a), "include");
  const b = cycleTag("ui", a);
  assert.deepEqual(b, { include: [], exclude: ["ui"] });
  assert.equal(tagStateOf("ui", b), "exclude");
  const c = cycleTag("ui", b);
  assert.deepEqual(c, none);
  assert.equal(tagStateOf("ui", c), "off");
});

test("cycling one tag leaves the others alone", () => {
  const f = { include: ["a"], exclude: ["b"] };
  assert.deepEqual(cycleTag("c", f), { include: ["a", "c"], exclude: ["b"] });
  assert.deepEqual(cycleTag("a", f), { include: [], exclude: ["b", "a"] });
});

test("setTagState moves a tag between lists without duplicating it", () => {
  const f = { include: ["a"], exclude: [] };
  assert.deepEqual(setTagState("a", "exclude", f), { include: [], exclude: ["a"] });
  assert.deepEqual(setTagState("a", "off", f), none);
  assert.deepEqual(setTagState("a", "include", f), f);
});

test("a card needs every included tag and none of the excluded ones", () => {
  const f = { include: ["ui"], exclude: ["post-launch"] };
  assert.equal(passesTagFilter(["ui"], f), true);
  assert.equal(passesTagFilter(["ui", "pre-launch"], f), true);
  assert.equal(passesTagFilter(["ui", "post-launch"], f), false);
  assert.equal(passesTagFilter(["pre-launch"], f), false);
});

test("an untagged card passes an exclude-only filter", () => {
  const f = { include: [], exclude: ["post-launch"] };
  assert.equal(passesTagFilter([], f), true);
  assert.equal(passesTagFilter(null, f), true);
  assert.equal(passesTagFilter(undefined, f), true);
});

test("an empty filter passes everything", () => {
  assert.equal(passesTagFilter(["x"], none), true);
  assert.equal(passesTagFilter([], none), true);
});

test("a leading dash in the typeahead asks for an exclude", () => {
  assert.deepEqual(parseTagQuery("-Post"), { text: "post", exclude: true });
  assert.deepEqual(parseTagQuery(" - post "), { text: "post", exclude: true });
  assert.deepEqual(parseTagQuery("post"), { text: "post", exclude: false });
  assert.deepEqual(parseTagQuery("-"), { text: "", exclude: true });
});
