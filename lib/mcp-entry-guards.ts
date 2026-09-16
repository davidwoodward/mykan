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

/**
 * Server-level usage guidance sent to every MCP client on connect (the MCP
 * `instructions` field). The one place a session learns the whole card model
 * before calling any tool; tool descriptions repeat the parts they need.
 */
export const MCP_SERVER_INSTRUCTIONS = [
  "mykan is David's kanban and the system of record for his work across projects. Cards are referenced as KEY-N (e.g. KANBAN-37).",
  "",
  "How a card is organised:",
  "- The description (card body) is a clean, living spec: objective, scope, current plan, acceptance. Edit it in place with set_item_body when the plan changes; item history keeps old versions. Never append progress, corrections or session logs to it.",
  "- Progress goes in progress entries (append_item_note). One short checkpoint per meaningful step: what changed, where (PR, commit, file), what's next.",
  "- Questions for David go in question entries (ask_question). When David answers, record the answer with answer_question.",
  "- Decisions are David's. record_decision records what David decided; never record your own judgement as a decision. When a decision changes, record the new one with supersedes rather than editing history away.",
  "- Entries are editable and versioned: fix a wrong entry with update_item_entry, don't add a correction on top.",
  `- Every entry is capped at ${MCP_ENTRY_MAX_CHARS} characters. Over the cap nothing is saved: put the detail in the repo (a doc, a _continue/ handoff, the PR description) and record a short entry that links to it.`,
  "",
  "Where things belong:",
  "- The card: the work, what was decided, where it stands.",
  "- lobe: durable lessons and traps worth remembering beyond this card.",
  "- Repo _continue/ docs: session handoffs. Link them from the card; never copy them into it.",
  "",
  "Reading: list_items returns titles only. get_item returns the description plus active decisions, open questions and a progress summary; call list_item_entries when you need the progress log or older entries.",
  "",
  "Epics: an epic groups child cards in the same project (set_item_parent, one level only). Status changes, type changes and card rewrites are real writes to David's live board: re-read a card with get_item immediately before rewriting it.",
].join("\n");

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
