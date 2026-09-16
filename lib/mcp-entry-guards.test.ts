// MCP guardrails for item entries (KANBAN-37): size cap, body budget warning,
// the compact get_item entry summary and argument checks. Pure — no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ITEM_BODY_BUDGET_CHARS,
  MCP_ENTRY_MAX_CHARS,
  answerArgsError,
  bodyBudgetWarning,
  entryCapError,
  progressRecordedMessage,
  summarizeEntries,
} from "./mcp-entry-guards.ts";
import type { ItemEntry } from "./item-entries-rules.ts";

const entry = (over: Partial<ItemEntry> = {}): ItemEntry => ({
  id: "e1",
  item_id: "item-1",
  kind: "progress",
  state: "current",
  body: "Did the thing",
  supersedes_id: null,
  answered_by_id: null,
  source: "mcp",
  created_at: "2026-09-16T10:00:00.000Z",
  created_by: "david@example.com",
  updated_at: "2026-09-16T10:00:00.000Z",
  updated_by: "david@example.com",
  deleted_at: null,
  deleted_by: null,
  ...over,
});

test("the entry cap sits in the 1,500-2,000 range", () => {
  assert.ok(MCP_ENTRY_MAX_CHARS >= 1500 && MCP_ENTRY_MAX_CHARS <= 2000);
});

test("an entry at the cap is accepted; one character over is refused", () => {
  assert.equal(entryCapError("progress", "x".repeat(MCP_ENTRY_MAX_CHARS)), null);
  const e = entryCapError("progress", "x".repeat(MCP_ENTRY_MAX_CHARS + 1));
  assert.ok(e);
  assert.match(e, /progress entry is 2,001 characters; the cap is 2,000/);
  assert.match(e, /Nothing was saved/);
  assert.match(e, /repo/);
  assert.match(e, /link/);
});

test("the cap applies to decisions and questions too, named by kind", () => {
  const long = "y".repeat(MCP_ENTRY_MAX_CHARS + 10);
  assert.match(entryCapError("decision", long) ?? "", /^This decision entry/);
  assert.match(entryCapError("question", long) ?? "", /^This question entry/);
});

test("the cap measures trimmed text with CRLF folded, like the stored body", () => {
  const padded = `  ${"z".repeat(MCP_ENTRY_MAX_CHARS)}\n\n  `;
  assert.equal(entryCapError("progress", padded), null);
  const crlf = "a\r\n".repeat(MCP_ENTRY_MAX_CHARS / 2) + "a";
  // (N/2) "a\n" pairs plus one "a" = N+1 after folding → over.
  assert.ok(entryCapError("progress", crlf));
  assert.equal(entryCapError("progress", "a\r\n".repeat(MCP_ENTRY_MAX_CHARS / 2 - 1) + "a"), null);
});

test("blank or non-string entry text is refused", () => {
  assert.equal(entryCapError("progress", "   \n "), "progress text required");
  assert.equal(entryCapError("decision", 42), "decision text must be a string");
});

test("set_item_body warns only past the budget", () => {
  assert.ok(ITEM_BODY_BUDGET_CHARS >= 4000);
  assert.equal(bodyBudgetWarning("Title\nshort spec"), null);
  assert.equal(bodyBudgetWarning("b".repeat(ITEM_BODY_BUDGET_CHARS)), null);
  const w = bodyBudgetWarning("b".repeat(ITEM_BODY_BUDGET_CHARS + 1));
  assert.ok(w);
  assert.match(w, /8,001 characters \(budget 8,000\)/);
  assert.match(w, /saved/);
  assert.match(w, /progress is leaking/);
  assert.match(w, /append_item_note/);
});

test("summarizeEntries keeps active decisions and open questions, oldest first", () => {
  const rows = [
    entry({ id: "d2", kind: "decision", state: "active", body: "Use Postgres", created_at: "2026-09-16T12:00:00.000Z", supersedes_id: "d1" }),
    entry({ id: "d1", kind: "decision", state: "superseded", body: "Use SQLite", created_at: "2026-09-16T09:00:00.000Z" }),
    entry({ id: "q1", kind: "question", state: "open", body: "Which region?", created_at: "2026-09-16T11:00:00.000Z" }),
    entry({ id: "q2", kind: "question", state: "answered", body: "Which DB?" }),
    entry({ id: "d3", kind: "decision", state: "active", body: "Ship Friday", created_at: "2026-09-16T08:00:00.000Z" }),
    entry({ id: "d4", kind: "decision", state: "active", body: "deleted one", deleted_at: "2026-09-16T13:00:00.000Z" }),
    entry({ id: "q3", kind: "question", state: "open", body: "deleted q", deleted_at: "2026-09-16T13:00:00.000Z" }),
    entry({ id: "p1", kind: "progress", state: "current", body: "not listed" }),
  ];
  const s = summarizeEntries(rows, { count: 7, last_at: "2026-09-16T14:00:00.000Z" });
  assert.deepEqual(s, {
    decisions: [
      { id: "d3", body: "Ship Friday", created_at: "2026-09-16T08:00:00.000Z", created_by: "david@example.com", supersedes_id: null },
      { id: "d2", body: "Use Postgres", created_at: "2026-09-16T12:00:00.000Z", created_by: "david@example.com", supersedes_id: "d1" },
    ],
    open_questions: [{ id: "q1", body: "Which region?", created_at: "2026-09-16T11:00:00.000Z" }],
    progress: { count: 7, last_at: "2026-09-16T14:00:00.000Z" },
  });
});

test("summarizeEntries on an item with no entries", () => {
  assert.deepEqual(summarizeEntries([], { count: 0, last_at: null }), {
    decisions: [],
    open_questions: [],
    progress: { count: 0, last_at: null },
  });
});

test("answer_question needs exactly one of decision_id or decision", () => {
  assert.equal(answerArgsError({ decision_id: "d1" }), null);
  assert.equal(answerArgsError({ decision: "Use Postgres" }), null);
  assert.match(answerArgsError({ decision_id: "d1", decision: "x" }) ?? "", /not both/);
  assert.match(answerArgsError({}) ?? "", /^Pass decision_id/);
  assert.match(answerArgsError({ decision_id: " ", decision: "" }) ?? "", /^Pass decision_id/);
});

test("append_item_note says where the note went and how to read it back", () => {
  const m = progressRecordedMessage("KANBAN-37");
  assert.match(m, /^Recorded as a progress entry on KANBAN-37 \(not in the card body\)\./);
  assert.match(m, /list_item_entries/);
});
