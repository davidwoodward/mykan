// The app-wide tooltip layer's pure decisions (KANBAN-47): placement (below,
// flip above, clamp to the viewport) and what a moved `title` becomes for
// assistive tech.
import { test } from "node:test";
import assert from "node:assert/strict";
import { placeTip, tipText, titleA11yRole, type Rect } from "./tooltip.ts";

const VW = 1000;
const VH = 800;
const rect = (left: number, top: number, w = 24, h = 24): Rect => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
});

test("placeTip: below the anchor, centred, gap away", () => {
  const p = placeTip({ anchor: rect(488, 100), width: 60, height: 20, viewportWidth: VW, viewportHeight: VH });
  assert.deepEqual(p, { left: 470, top: 130, side: "below" });
});

test("placeTip: flips above when it doesn't fit below", () => {
  const p = placeTip({ anchor: rect(488, 770), width: 60, height: 20, viewportWidth: VW, viewportHeight: VH });
  assert.equal(p.side, "above");
  assert.equal(p.top, 770 - 6 - 20);
});

test("placeTip: stays below when it fits, even right at the edge", () => {
  // bottom 764 + gap 6 + height 20 = 790 <= 800 - 4.
  const p = placeTip({ anchor: rect(488, 740), width: 60, height: 20, viewportWidth: VW, viewportHeight: VH });
  assert.equal(p.side, "below");
  assert.equal(p.top, 770);
});

test("placeTip: fits neither side: the roomier side, clamped inside", () => {
  const p = placeTip({ anchor: rect(0, 60, 24, 24), width: 100, height: 500, viewportWidth: VW, viewportHeight: 300 });
  assert.equal(p.side, "below");
  assert.equal(p.top, 4); // clamped to the top margin: never off-screen at the top
  const q = placeTip({ anchor: rect(0, 250, 24, 24), width: 100, height: 500, viewportWidth: VW, viewportHeight: 300 });
  assert.equal(q.side, "above");
  assert.equal(q.top, 4);
});

test("placeTip: clamps at the right and left viewport edges", () => {
  const right = placeTip({ anchor: rect(980, 10, 16, 16), width: 200, height: 20, viewportWidth: VW, viewportHeight: VH });
  assert.equal(right.left, VW - 4 - 200);
  const left = placeTip({ anchor: rect(2, 10, 16, 16), width: 200, height: 20, viewportWidth: VW, viewportHeight: VH });
  assert.equal(left.left, 4);
});

test("placeTip: a tip wider than the viewport pins to the left margin", () => {
  const p = placeTip({ anchor: rect(100, 10), width: 400, height: 20, viewportWidth: 300, viewportHeight: VH });
  assert.equal(p.left, 4);
});

test("placeTip: rounds to whole pixels", () => {
  const p = placeTip({ anchor: { left: 10.3, top: 10.2, right: 33.7, bottom: 30.4 }, width: 41, height: 17, viewportWidth: VW, viewportHeight: VH });
  assert.ok(Number.isInteger(p.left) && Number.isInteger(p.top));
});

test("tipText: whitespace-only is no tip; runs of whitespace collapse", () => {
  assert.equal(tipText(null), null);
  assert.equal(tipText(undefined), null);
  assert.equal(tipText(""), null);
  assert.equal(tipText("  \n "), null);
  assert.equal(tipText("  Connect   GitHub\naccount "), "Connect GitHub account");
});

const base = { ariaLabel: null, hasLabelledBy: false, hasLabels: false, text: "", hasDescription: false };

test("titleA11yRole: a title-only icon button gets the title as its name", () => {
  assert.equal(titleA11yRole({ ...base, tip: "Connect GitHub account" }), "label");
  assert.equal(titleA11yRole({ ...base, tip: "Refresh", ariaLabel: "  " }), "label");
});

test("titleA11yRole: an element named otherwise keeps it", () => {
  // Same words as the name: nothing to add.
  assert.equal(titleA11yRole({ ...base, tip: "Toggle dark mode", ariaLabel: "Toggle dark mode" }), "none");
  assert.equal(titleA11yRole({ ...base, tip: "restore", text: "Restore" }), "none");
  assert.equal(titleA11yRole({ ...base, tip: "Delete", ariaLabel: "Delete Fix the board" }), "none");
  assert.equal(titleA11yRole({ ...base, tip: "History", ariaLabel: "History for Fix the board" }), "none");
  // Different words: the title was the description.
  assert.equal(titleA11yRole({ ...base, tip: "Open card", ariaLabel: "Open Fix the board" }), "description");
  assert.equal(titleA11yRole({ ...base, tip: "9/17/2026, 10:02:11 AM", text: "3h ago" }), "description");
  assert.equal(titleA11yRole({ ...base, tip: "Filter by area (includes sub-areas)", hasLabels: true }), "description");
  assert.equal(titleA11yRole({ ...base, tip: "Help", hasLabelledBy: true }), "description");
});

test("titleA11yRole: an existing description is left alone", () => {
  assert.equal(titleA11yRole({ ...base, tip: "More", text: "3h ago", hasDescription: true }), "none");
  // ...but a nameless element still needs its name.
  assert.equal(titleA11yRole({ ...base, tip: "More", hasDescription: true }), "label");
});
