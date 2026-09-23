// Run with `npm test` (Node's built-in test runner; Node strips the types).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalEmail,
  normalizeAssignees,
  richDocBlocks,
  richDocBodyAfterTitle,
  richDocText,
  richDocTitle,
  TITLE_MAX_CHARS,
  type RichDoc,
} from "./types.ts";

const p = (text?: string) =>
  text === undefined
    ? { type: "paragraph" }
    : { type: "paragraph", content: [{ type: "text", text }] };
const doc = (...content: unknown[]): RichDoc => ({ type: "doc", content });
const li = (t: string) => ({ type: "listItem", content: [p(t)] });

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

// canonicalEmail / normalizeAssignees: one identity, one spelling. mykan matches
// member emails as exact strings against projects.shared_with, so a Gmail
// account that can arrive spelled several ways has to fold to one form.

test("gmail ignores dots in the local part", () => {
  assert.equal(canonicalEmail("cherie.woodward.27@gmail.com"), "cheriewoodward27@gmail.com");
  assert.equal(canonicalEmail("cheriewoodward27@gmail.com"), "cheriewoodward27@gmail.com");
});

test("gmail ignores a +tag, and googlemail.com is the same mailbox", () => {
  assert.equal(canonicalEmail("cherie.woodward.27+kanban@gmail.com"), "cheriewoodward27@gmail.com");
  assert.equal(canonicalEmail("Cherie.Woodward.27@googlemail.com"), "cheriewoodward27@gmail.com");
});

test("every spelling of one gmail account folds to the same string", () => {
  const forms = [
    "cherie.woodward.27@gmail.com",
    "cheriewoodward27@gmail.com",
    "  Cherie.Woodward.27@Gmail.com  ",
    "c.h.e.r.i.e.woodward.27+mykan@googlemail.com",
  ];
  const canon = forms.map(canonicalEmail);
  assert.equal(new Set(canon).size, 1, `got ${JSON.stringify(canon)}`);
});

test("a dot is significant on every other domain", () => {
  // The rule is Gmail's alone — folding it everywhere would break this address.
  assert.equal(canonicalEmail("kenyon.congdon@permitsaige.com"), "kenyon.congdon@permitsaige.com");
  assert.equal(canonicalEmail("first.last+tag@example.org"), "first.last+tag@example.org");
});

test("the accounts that predate canonicalisation are untouched", () => {
  for (const e of [
    "dawoodward@gmail.com",
    "dwoody55@gmail.com",
    "matthewl@experiencealign.com",
    "kenyon.congdon@permitsaige.com",
  ]) {
    assert.equal(canonicalEmail(e), e, `${e} must canonicalise to itself`);
  }
});

test("junk and edge-case addresses are left alone rather than mangled", () => {
  assert.equal(canonicalEmail(null), "");
  assert.equal(canonicalEmail(undefined), "");
  assert.equal(canonicalEmail(""), "");
  assert.equal(canonicalEmail("  "), "");
  assert.equal(canonicalEmail("not-an-email"), "not-an-email");
  assert.equal(canonicalEmail("@gmail.com"), "@gmail.com");
  assert.equal(canonicalEmail("user@"), "user@");
  // A local part of nothing but dots/tags would canonicalise away entirely.
  assert.equal(canonicalEmail("...@gmail.com"), "...@gmail.com");
  assert.equal(canonicalEmail("+tag@gmail.com"), "+tag@gmail.com");
});

test("an assignee matches a whitelist entry written the other way", () => {
  const allowed = ["cheriewoodward27@gmail.com"];
  assert.deepEqual(normalizeAssignees(["cherie.woodward.27@gmail.com"], allowed), [
    "cheriewoodward27@gmail.com",
  ]);
  // ...and the reverse: whitelist dotted, input undotted.
  assert.deepEqual(
    normalizeAssignees(["cheriewoodward27@gmail.com"], ["cherie.woodward.27@gmail.com"]),
    ["cheriewoodward27@gmail.com"],
  );
});

test("assignees are still filtered to known members and deduped", () => {
  const allowed = ["dawoodward@gmail.com", "kenyon.congdon@permitsaige.com"];
  assert.deepEqual(
    normalizeAssignees(
      ["dawoodward@gmail.com", "DaWoodward@gmail.com", "stranger@gmail.com", 42, null],
      allowed,
    ),
    ["dawoodward@gmail.com"],
  );
  assert.deepEqual(normalizeAssignees("not an array", allowed), []);
  // A non-gmail near-miss must NOT be folded into a member.
  assert.deepEqual(normalizeAssignees(["kenyoncongdon@permitsaige.com"], allowed), []);
});

// richDocBodyAfterTitle (KANBAN-50): the body without the title line, so an
// MCP response can carry both without repeating a character.

test("the body after the title is everything past the first line", () => {
  assert.equal(
    richDocBodyAfterTitle(doc(p("Fix the login bug"), p("Steps to reproduce"), p("more"))),
    "Steps to reproduce\nmore",
  );
});

test("blank lines between the title and the body are dropped", () => {
  assert.equal(
    richDocBodyAfterTitle(doc(p("Title"), p(), p("   "), p("Objective"), p(), p("Scope"))),
    "Objective\n\nScope",
  );
});

test("leading blank lines before the title are skipped too", () => {
  assert.equal(richDocBodyAfterTitle(doc(p(), p("   "), p("Real title"), p("x"))), "x");
});

test("a title-only body has nothing after it", () => {
  assert.equal(richDocBodyAfterTitle(doc(p("Just a title"))), "");
  assert.equal(richDocBodyAfterTitle(doc(p("Just a title"), p(), p("  "))), "");
});

test("empty and missing bodies give an empty string", () => {
  assert.equal(richDocBodyAfterTitle(null), "");
  assert.equal(richDocBodyAfterTitle(undefined), "");
  assert.equal(richDocBodyAfterTitle(doc()), "");
  assert.equal(richDocBodyAfterTitle(doc(p())), "");
});

test("an over-cap first line returns the whole body, so nothing is lost", () => {
  // richDocTitle truncates past the cap, so the full first line lives nowhere
  // else; the body field carries it instead.
  const long = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ");
  const body = doc(p(long), p("rest"));
  assert.notEqual(richDocTitle(body), long);
  assert.equal(richDocBodyAfterTitle(body), richDocText(body));
});

test("a first line at the cap is still treated as the title", () => {
  const exact = "y".repeat(TITLE_MAX_CHARS);
  assert.equal(richDocBodyAfterTitle(doc(p(exact), p("rest"))), "rest");
});

test("title and body-after-title never share text, and together hold it all", () => {
  const bodies = [
    doc(p("Title"), p("One"), p("Two")),
    doc(p(), p("  Title  "), p(), p("Body")),
    doc(p("Only a title")),
    doc(p("Title"), { type: "bulletList", content: [li("a"), li("b")] }),
  ];
  // The pair reassembles the body's content, not its whitespace: the title is
  // trimmed and the blank lines that separated it from the body are dropped.
  const content = (text: string) =>
    text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  for (const body of bodies) {
    const title = richDocTitle(body);
    const after = richDocBodyAfterTitle(body);
    assert.ok(!after.includes(title), `"${after}" repeats "${title}"`);
    assert.deepEqual(content([title, after].filter(Boolean).join("\n")), content(richDocText(body)));
  }
});

// richDocBlocks (KANBAN-15): top-level blocks, so cards can space paragraphs.

test("blocks are one entry per top-level paragraph", () => {
  assert.deepEqual(richDocBlocks(doc(p("Title"), p("Second"), p("Third"))), [
    "Title",
    "Second",
    "Third",
  ]);
});

test("a hard break stays inside its paragraph block", () => {
  const body = doc(
    {
      type: "paragraph",
      content: [
        { type: "text", text: "line one" },
        { type: "hardBreak" },
        { type: "text", text: "line two" },
      ],
    },
    p("next para"),
  );
  assert.deepEqual(richDocBlocks(body), ["line one\nline two", "next para"]);
});

test("a list is one block with its items on consecutive lines", () => {
  const body = doc(
    p("Intro"),
    { type: "bulletList", content: [li("a"), li("b"), li("c")] },
    p("Outro"),
  );
  assert.deepEqual(richDocBlocks(body), ["Intro", "a\nb\nc", "Outro"]);
});

test("blank paragraphs between text are kept as empty blocks", () => {
  const body = doc(
    p(),
    p("   "),
    p("  Title"),
    p(),
    p(),
    { type: "image", attrs: { src: "x" } },
    p("Body"),
    p(),
  );
  assert.deepEqual(richDocBlocks(body), ["Title", "", "", "", "Body"]);
});

test("indentation inside later blocks is kept", () => {
  const body = doc(p("Title"), {
    type: "codeBlock",
    content: [{ type: "text", text: "  indented\n    more" }],
  });
  assert.deepEqual(richDocBlocks(body), ["Title", "  indented\n    more"]);
});

test("blocks joined by newlines always equal richDocText", () => {
  const img = { type: "image", attrs: { src: "x" } };
  const bodies = [
    doc(
      p("Title"),
      { type: "heading", content: [{ type: "text", text: "Heading" }] },
      { type: "orderedList", content: [li("one"), li("two")] },
      p("End"),
    ),
    doc(p(), p("  Objective  "), p(), p("Scope"), p("   "), p(), p("Acceptance"), p()),
    doc(p("a"), img, img, p("b"), img),
    doc({ type: "bulletList", content: [li(""), li("x")] }, p("  y  ")),
    doc(img),
  ];
  for (const body of bodies) {
    assert.equal(richDocBlocks(body).join("\n"), richDocText(body));
  }
});

test("empty and missing bodies give no blocks", () => {
  assert.deepEqual(richDocBlocks(null), []);
  assert.deepEqual(richDocBlocks(undefined), []);
  assert.deepEqual(richDocBlocks(doc()), []);
  assert.deepEqual(richDocBlocks(doc(p())), []);
});
