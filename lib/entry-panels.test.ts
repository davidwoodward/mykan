// The card page's entry panels (KANBAN-38): draft-key scoping for several
// editors on one page, grouping and order, the board's open-question counts,
// version summaries, editor keys, and the shared 2,000-character cap. Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  countOpenQuestions,
  entryChangeSummary,
  entryDraftKey,
  entryDraftScope,
  entryEditorKey,
  groupDecisions,
  groupProgress,
  leftoverEntryDraft,
  newestFirst,
  openQuestionsLabel,
  successorsById,
  type EntryDraftFields,
  type EntryDraftTarget,
} from "./entry-panels.ts";
import { createDraftSession, draftKey, memoryDraftStore } from "./abandon.ts";
import {
  ENTRY_MAX_CHARS,
  entryLengthError,
  entryTextLength,
  type ItemEntry,
} from "./item-entries-rules.ts";
import { MCP_ENTRY_MAX_CHARS, entryCapError } from "./mcp-entry-guards.ts";

const entry = (over: Partial<ItemEntry> = {}): ItemEntry => ({
  id: "e1",
  item_id: "item-1",
  kind: "progress",
  state: "current",
  body: "Did the thing",
  supersedes_id: null,
  answered_by_id: null,
  source: "web",
  created_at: "2026-09-16T10:00:00.000Z",
  created_by: "david@example.com",
  updated_at: "2026-09-16T10:00:00.000Z",
  updated_by: "david@example.com",
  deleted_at: null,
  deleted_by: null,
  ...over,
});
const at = (h: number) => `2026-09-16T${String(h).padStart(2, "0")}:00:00.000Z`;
const ids = (rows: ItemEntry[]) => rows.map((e) => e.id);

// ── Draft keys ───────────────────────────────────────────────────────────────

test("draft keys: each entry editor and composer has its own key, apart from the card's", () => {
  const targets: EntryDraftTarget[] = [
    { kind: "edit", entryId: "e1" },
    { kind: "edit", entryId: "e2" },
    { kind: "new", itemId: "item-1", entryKind: "progress" },
    { kind: "new", itemId: "item-1", entryKind: "question" },
    { kind: "new", itemId: "item-1", entryKind: "decision" },
    { kind: "new", itemId: "item-2", entryKind: "progress" },
    { kind: "answer", questionId: "e1" },
    { kind: "supersede", entryId: "e1" },
  ];
  const keys = targets.map(entryDraftKey);
  assert.equal(new Set(keys).size, keys.length, "no two editors share a key");
  const cardKeys = [draftKey("item", "item-1", "body"), draftKey("item", "e1", "body")];
  for (const k of keys) assert.ok(!cardKeys.includes(k));
  assert.equal(entryDraftKey({ kind: "edit", entryId: "e1" }), "mykan:draft:v1:entry:e1:body");
  assert.equal(
    entryDraftKey({ kind: "new", itemId: "item-1", entryKind: "question" }),
    "mykan:draft:v1:entry-new:item-1:question:body",
  );
  assert.equal(entryDraftKey({ kind: "answer", questionId: "q1" }), "mykan:draft:v1:entry-answer:q1:body");
  assert.equal(
    entryDraftKey({ kind: "supersede", entryId: "d1" }),
    "mykan:draft:v1:entry-supersede:d1:body",
  );
});

/** An entry editor's wiring, as components/EntryPanels.tsx builds it through useAbandonable. */
function openEntryEditor(store: ReturnType<typeof memoryDraftStore>, t: EntryDraftTarget, body: string) {
  const { scope, id } = entryDraftScope(t);
  return createDraftSession<EntryDraftFields>({
    opened: { body },
    store,
    keyOf: (f) => draftKey(scope, id, f),
    now: () => at(9),
  });
}

test("several entry editors on one page keep separate drafts; one's save or abandon leaves the others", async () => {
  const store = memoryDraftStore();
  const a = openEntryEditor(store, { kind: "edit", entryId: "e1" }, "first");
  const b = openEntryEditor(store, { kind: "edit", entryId: "e2" }, "second");
  const n = openEntryEditor(store, { kind: "new", itemId: "item-1", entryKind: "question" }, "");
  a.set("body", "first, edited");
  b.set("body", "second, edited");
  n.set("body", "Which region?");
  assert.equal(Object.keys(store.dump()).length, 3);

  const sent: unknown[] = [];
  const out = await a.close(async (p) => void sent.push(p));
  assert.deepEqual(out, { kind: "saved", patch: { body: "first, edited" } });
  assert.deepEqual(sent, [{ body: "first, edited" }], "one save, only its own field");
  b.abandon();
  assert.deepEqual(Object.keys(store.dump()), [entryDraftKey({ kind: "new", itemId: "item-1", entryKind: "question" })]);
});

test("leftover drafts resolve per entry: offer, forget when saved, none when absent", () => {
  const store = memoryDraftStore();
  const e1 = { kind: "edit", entryId: "e1" } as const;
  const e2 = { kind: "edit", entryId: "e2" } as const;
  openEntryEditor(store, e1, "old text").set("body", "new text");
  openEntryEditor(store, e2, "same").set("body", "landed");

  const d1 = leftoverEntryDraft(store, e1, "old text");
  assert.equal(d1.kind, "offer");
  assert.equal(d1.kind === "offer" && d1.values.body, "new text");
  assert.equal(d1.kind === "offer" && d1.stale, false);
  // e2's keepalive save landed: the stored text already matches the draft.
  assert.equal(leftoverEntryDraft(store, e2, "landed").kind, "clear");
  // Stale: the entry changed since the draft began (e.g. an MCP edit).
  const stale = leftoverEntryDraft(store, e1, "edited over MCP");
  assert.equal(stale.kind === "offer" && stale.stale, true);
  assert.equal(leftoverEntryDraft(store, { kind: "answer", questionId: "e1" }, "").kind, "none");
});

test("a composer's draft is offered back against an empty stored value", () => {
  const store = memoryDraftStore();
  const t = { kind: "new", itemId: "item-1", entryKind: "progress" } as const;
  openEntryEditor(store, t, "").set("body", "PR #7 opened");
  const d = leftoverEntryDraft(store, t, "");
  assert.equal(d.kind === "offer" && d.values.body, "PR #7 opened");
  // Another item's composer, or another kind, sees nothing.
  assert.equal(leftoverEntryDraft(store, { ...t, itemId: "item-2" }, "").kind, "none");
  assert.equal(leftoverEntryDraft(store, { ...t, entryKind: "decision" }, "").kind, "none");
});

// ── Grouping ─────────────────────────────────────────────────────────────────

test("progress: current newest first; superseded and deleted apart; other kinds ignored", () => {
  const rows = [
    entry({ id: "p1", created_at: at(9) }),
    entry({ id: "p2", created_at: at(11) }),
    entry({ id: "p3", created_at: at(10), state: "superseded" }),
    entry({ id: "p4", created_at: at(12), deleted_at: at(13) }),
    entry({ id: "p5", created_at: at(8), state: "superseded", deleted_at: at(13) }),
    entry({ id: "q1", kind: "question", state: "open", created_at: at(14) }),
  ];
  const g = groupProgress(rows);
  assert.deepEqual(ids(g.current), ["p2", "p1"]);
  assert.deepEqual(ids(g.superseded), ["p3"]);
  assert.deepEqual(ids(g.deleted), ["p4", "p5"]);
});

test("decisions & questions: open and active on top; answered, superseded, deleted collapsed", () => {
  const rows = [
    entry({ id: "q1", kind: "question", state: "open", created_at: at(9) }),
    entry({ id: "q2", kind: "question", state: "open", created_at: at(12) }),
    entry({ id: "q3", kind: "question", state: "answered", answered_by_id: "d2", created_at: at(8) }),
    entry({ id: "d1", kind: "decision", state: "superseded", created_at: at(7) }),
    entry({ id: "d2", kind: "decision", state: "active", supersedes_id: "d1", created_at: at(10) }),
    entry({ id: "d3", kind: "decision", state: "active", created_at: at(11), deleted_at: at(12) }),
    entry({ id: "p1", created_at: at(13) }),
  ];
  const g = groupDecisions(rows);
  assert.deepEqual(ids(g.openQuestions), ["q2", "q1"]);
  assert.deepEqual(ids(g.activeDecisions), ["d2"]);
  assert.deepEqual(ids(g.answeredQuestions), ["q3"]);
  assert.deepEqual(ids(g.supersededDecisions), ["d1"]);
  assert.deepEqual(ids(g.deleted), ["d3"]);
});

test("newest first breaks created_at ties by id, like the list query", () => {
  const rows = [entry({ id: "a" }), entry({ id: "c" }), entry({ id: "b" })];
  assert.deepEqual(ids([...rows].sort(newestFirst)), ["c", "b", "a"]);
});

test("successors: only live superseding entries count", () => {
  const rows = [
    entry({ id: "d1", kind: "decision", state: "superseded" }),
    entry({ id: "d2", kind: "decision", supersedes_id: "d1", state: "active" }),
    entry({ id: "d4", kind: "decision", supersedes_id: "d3", deleted_at: at(9) }),
  ];
  const m = successorsById(rows);
  assert.equal(m.get("d1")?.id, "d2");
  assert.equal(m.has("d3"), false);
});

// ── Board counts ─────────────────────────────────────────────────────────────

test("open question counts aggregate one query's rows per item; zero items are absent", () => {
  assert.deepEqual(
    countOpenQuestions([{ item_id: "a" }, { item_id: "b" }, { item_id: "a" }, { item_id: "a" }]),
    { a: 3, b: 1 },
  );
  assert.deepEqual(countOpenQuestions([]), {});
  // Rows outside the filter (when the query returns those columns) don't count.
  assert.deepEqual(
    countOpenQuestions([
      { item_id: "a", kind: "question", state: "open", deleted_at: null },
      { item_id: "a", kind: "question", state: "answered", deleted_at: null },
      { item_id: "a", kind: "decision", state: "active", deleted_at: null },
      { item_id: "a", kind: "question", state: "open", deleted_at: at(9) },
    ]),
    { a: 1 },
  );
  assert.equal(openQuestionsLabel(1), "1 open question");
  assert.equal(openQuestionsLabel(4), "4 open questions");
});

// ── Version summaries ────────────────────────────────────────────────────────

test("entry change summaries read like the card's history", () => {
  const live = { state: "open" as const, deleted_at: null };
  assert.deepEqual(entryChangeSummary(["body"], live, live), ["text edited"]);
  assert.deepEqual(
    entryChangeSummary(["state", "answered_by_id"], live, { state: "answered", deleted_at: null }),
    ["marked answered"],
  );
  assert.deepEqual(entryChangeSummary(["deleted_at"], live, { ...live, deleted_at: at(9) }), ["deleted"]);
  assert.deepEqual(entryChangeSummary(["deleted_at"], { ...live, deleted_at: at(9) }, live), ["restored"]);
  assert.deepEqual(
    entryChangeSummary(["state"], { state: "active", deleted_at: null }, { state: "superseded", deleted_at: null }),
    ["marked superseded"],
  );
});

// ── Keys and the cap ─────────────────────────────────────────────────────────

test("editor keys: ⌘/Ctrl+Enter submits, Enter is a newline, Esc finishes, IME keys pass", () => {
  const k = (key: string, mod: Partial<{ metaKey: boolean; ctrlKey: boolean; isComposing: boolean }> = {}) =>
    entryEditorKey({ key, metaKey: false, ctrlKey: false, ...mod });
  assert.equal(k("Enter"), null);
  assert.equal(k("Enter", { metaKey: true }), "submit");
  assert.equal(k("Enter", { ctrlKey: true }), "submit");
  assert.equal(k("Escape"), "escape");
  assert.equal(k("Enter", { metaKey: true, isComposing: true }), null);
  assert.equal(k("j"), null, "typing never reaches a shortcut");
});

test("one 2,000-character cap for web and MCP, measured on trimmed text", () => {
  assert.equal(ENTRY_MAX_CHARS, 2000);
  assert.equal(MCP_ENTRY_MAX_CHARS, ENTRY_MAX_CHARS);
  assert.equal(entryTextLength("  hi\r\n "), 2);
  assert.equal(entryLengthError("x".repeat(ENTRY_MAX_CHARS)), null);
  assert.equal(entryLengthError(` ${"x".repeat(ENTRY_MAX_CHARS)}\n`), null);
  assert.match(entryLengthError("x".repeat(ENTRY_MAX_CHARS + 1)) ?? "", /2,001 characters; the cap is 2,000/);
  assert.ok(entryLengthError("   "));
  assert.ok(entryLengthError(42));
  // MCP's own message agrees on where the line is.
  assert.equal(entryCapError("decision", "x".repeat(ENTRY_MAX_CHARS)), null);
  assert.ok(entryCapError("decision", "x".repeat(ENTRY_MAX_CHARS + 1)));
});
