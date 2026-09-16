// Run with `npm test` (Node's built-in test runner; Node strips the types).
import { test } from "node:test";
import assert from "node:assert/strict";
import { richDocTitle, TITLE_MAX_CHARS, type RichDoc } from "./types.ts";

const p = (text?: string) =>
  text === undefined
    ? { type: "paragraph" }
    : { type: "paragraph", content: [{ type: "text", text }] };
const doc = (...content: unknown[]): RichDoc => ({ type: "doc", content });

test("title is the first line of a multi-paragraph body", () => {
  assert.equal(
    richDocTitle(doc(p("Fix the login bug"), p("Steps to reproduce"), p("more"))),
    "Fix the login bug",
  );
});

test("title stops at a hard break inside the first paragraph", () => {
  const body = doc({
    type: "paragraph",
    content: [
      { type: "text", text: "Title here" },
      { type: "hardBreak" },
      { type: "text", text: "second line" },
    ],
  });
  assert.equal(richDocTitle(body), "Title here");
});

test("title skips leading blank lines and trims", () => {
  assert.equal(richDocTitle(doc(p(), p("   "), p("  Real title  "), p("x"))), "Real title");
});

test("empty and missing bodies give an empty title", () => {
  assert.equal(richDocTitle(null), "");
  assert.equal(richDocTitle(undefined), "");
  assert.equal(richDocTitle(doc()), "");
  assert.equal(richDocTitle(doc(p())), "");
  assert.equal(richDocTitle(doc({ type: "image", attrs: { src: "x" } })), "");
});

test("a very long first line is capped at a word boundary with an ellipsis", () => {
  const long = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
  const t = richDocTitle(doc(p(long), p("body")));
  assert.ok(t.length <= TITLE_MAX_CHARS, `length ${t.length}`);
  assert.ok(t.endsWith("…"));
  const words = t.slice(0, -1).split(" ");
  // Every kept word is whole (no mid-word cut).
  words.forEach((w, i) => assert.equal(w, `word${i}`));
});

test("a long first line with no spaces is hard-cut with an ellipsis", () => {
  const t = richDocTitle(doc(p("x".repeat(1000))));
  assert.equal(t.length, TITLE_MAX_CHARS);
  assert.ok(t.endsWith("…"));
});

test("a first line at the cap is returned unchanged", () => {
  const exact = "y".repeat(TITLE_MAX_CHARS);
  assert.equal(richDocTitle(doc(p(exact))), exact);
});
