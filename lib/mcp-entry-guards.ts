// MCP guardrails for item entries and the card body (KANBAN-37). Pure: no DB,
// no "server-only", no "@/" imports, so `node --test` can load it.
// lib/mcp-server.ts applies these on the way in (caps) and on the way out
// (body budget warning, the compact get_item entry summary).

import type { EntryKind, ItemEntry } from "./item-entries-rules.ts";

/**
 * The most characters an entry (progress, decision or question) may hold when
 * created or edited over MCP. One number for every kind keeps the contract
 * learnable: a decision or a question is a sentence or two, and a progress
 * note is a checkpoint, not a log. Detail belongs in the repo, linked.
 */
export const MCP_ENTRY_MAX_CHARS = 2000;

/**
 * The card description size past which set_item_body still writes but warns.
 * A spec that keeps growing usually means progress is leaking back into it.
 */
export const ITEM_BODY_BUDGET_CHARS = 8000;

/** The card / lobe / repo boundary, quoted in tool descriptions. */
export const CONTENT_BOUNDARY =
  "Boundary: the card holds the work (description = a clean living spec), decisions and status; lobe holds durable lessons; repo _continue/ docs hold handoffs, linked from the card and never copied into it.";

const fmt = (n: number) => n.toLocaleString("en-US");

/** Why this entry text is refused over MCP (blank, not text, too long), or null. */
export function entryCapError(kind: EntryKind, raw: unknown): string | null {
  if (typeof raw !== "string") return `${kind} text must be a string`;
  const length = raw.replace(/\r\n/g, "\n").trim().length;
  if (length === 0) return `${kind} text required`;
  if (length <= MCP_ENTRY_MAX_CHARS) return null;
  return (
    `This ${kind} entry is ${fmt(length)} characters; the cap is ${fmt(MCP_ENTRY_MAX_CHARS)}. ` +
    "Nothing was saved. Put the detail in the repo (e.g. a doc under docs/ or a _continue/ handoff, " +
    "or the PR description) and record a short entry that links to it (file path or PR URL)."
  );
}

/** The warning set_item_body adds when the new description passes the budget. */
export function bodyBudgetWarning(text: string): string | null {
  const length = text.replace(/\r\n/g, "\n").trim().length;
  if (length <= ITEM_BODY_BUDGET_CHARS) return null;
  return (
    `The description is now ${fmt(length)} characters (budget ${fmt(ITEM_BODY_BUDGET_CHARS)}). ` +
    "It was saved, but a growing spec usually means progress is leaking back in. Keep the body a clean " +
    "living spec: progress goes in append_item_note, decisions in record_decision, open questions in " +
    "ask_question, and long detail in a repo doc linked from the card."
  );
}

export type DecisionSummary = Pick<
  ItemEntry,
  "id" | "body" | "created_at" | "created_by" | "supersedes_id"
>;
export type QuestionSummary = Pick<ItemEntry, "id" | "body" | "created_at">;
export type ProgressSummary = { count: number; last_at: string | null };

export type ItemEntrySummary = {
  /** Active (not superseded, not deleted) decisions, oldest first. */
  decisions: DecisionSummary[];
  /** Open (unanswered, not deleted) questions, oldest first. */
  open_questions: QuestionSummary[];
  /** Non-deleted progress entries (superseded included): how many, and the newest's time. */
  progress: ProgressSummary;
};

type Row = Pick<
  ItemEntry,
  "id" | "kind" | "state" | "body" | "created_at" | "created_by" | "supersedes_id" | "deleted_at"
>;

/**
 * Assemble get_item's compact entry view from the decision/question rows and
 * the progress count. Rows of other kinds/states or deleted rows are ignored,
 * so the caller's query may be broader than needed without leaking into it.
 */
export function summarizeEntries(rows: Row[], progress: ProgressSummary): ItemEntrySummary {
  const live = rows
    .filter((r) => !r.deleted_at)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  return {
    decisions: live
      .filter((r) => r.kind === "decision" && r.state === "active")
      .map((r) => ({
        id: r.id,
        body: r.body,
        created_at: r.created_at,
        created_by: r.created_by,
        supersedes_id: r.supersedes_id,
      })),
    open_questions: live
      .filter((r) => r.kind === "question" && r.state === "open")
      .map((r) => ({ id: r.id, body: r.body, created_at: r.created_at })),
    progress: { count: progress.count, last_at: progress.last_at },
  };
}

/** answer_question takes exactly one of an existing decision id or new decision text. */
export function answerArgsError(args: { decision_id?: string; decision?: string }): string | null {
  const hasId = typeof args.decision_id === "string" && args.decision_id.trim() !== "";
  const hasText = typeof args.decision === "string" && args.decision.trim() !== "";
  if (hasId && hasText) {
    return "Pass either decision_id (an existing active decision on the same item) or decision (text for a new decision), not both";
  }
  if (!hasId && !hasText) {
    return "Pass decision_id (an existing active decision on the same item) or decision (text for a new decision)";
  }
  return null;
}

/** The plain sentence append_item_note returns with the created entry. */
export function progressRecordedMessage(itemRef: string): string {
  return `Recorded as a progress entry on ${itemRef} (not in the card body). Read it back with list_item_entries (item: ${itemRef}, kind: progress).`;
}
