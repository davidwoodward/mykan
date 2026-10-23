// Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extendCount } from "./count-prefix.ts";

test("digits build up a count", () => {
  assert.equal(extendCount("", "1"), "1");
  assert.equal(extendCount("1", "2"), "12");
  assert.equal(extendCount("12", "5"), "125");
});

test("a bare 0 is not a count, so it still means top", () => {
  assert.equal(extendCount("", "0"), null);
});

test("0 extends a count already started", () => {
  assert.equal(extendCount("1", "0"), "10");
  assert.equal(extendCount("10", "0"), "100");
});

test("any other key is not a count digit", () => {
  assert.equal(extendCount("12", "G"), null);
  assert.equal(extendCount("", "j"), null);
  assert.equal(extendCount("3", "Enter"), null);
});

test("the count is capped in length", () => {
  assert.equal(extendCount("123456789", "1"), "123456789");
});
