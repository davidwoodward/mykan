// The card page's entry panels (KANBAN-38): Progress, and Decisions &
// Questions. Pure (no DB, no React, no "@/" imports) so `node --test` loads it:
// how entries are grouped and ordered, where each editor keeps its browser
// draft, what a version's change reads as, the editor keys, and the board's
// open-question counts.

import {
  draftKey,
  readFieldDraft,
  restoreDecision,
  type DraftStore,
  type RestoreDecision,
} from "./abandon.ts";
import type {
  EntryKind,
  EntrySnapshot,
  EntryTrackedField,
  ItemEntry,
} from "./item-entries-rules.ts";

// ── Draft keys ─────────────────────────────────────────────────────────────

/**
 * Which editor a draft belongs to. The card page can have several entry
 * editors open at once, so each gets its own draft scope and id; the storage
 * key is draftKey(scope, id, "body") from lib/abandon.ts:
 *
 *  - editing an existing entry     mykan:draft:v1:entry:<entryId>:body
 *  - a new entry composer          mykan:draft:v1:entry-new:<itemId>:<kind>:body
 *  - answering a question          mykan:draft:v1:entry-answer:<questionId>:body
 *  - superseding a decision        mykan:draft:v1:entry-supersede:<decisionId>:body
 *
 * The card's own description keeps `item:<itemId>:body`, so no entry draft can
 * ever collide with it or with another entry's.
 */
export type EntryDraftTarget =
  | { kind: "edit"; entryId: string }
  | { kind: "new"; itemId: string; entryKind: EntryKind }
  | { kind: "answer"; questionId: string }
  | { kind: "supersede"; entryId: string };

/** The single field an entry editor drafts. */
export type EntryDraftFields = { body: string };
export const ENTRY_DRAFT_FIELD = "body" as const;

/** The useAbandonable scope and id for an entry editor. */
export function entryDraftScope(t: EntryDraftTarget): { scope: string; id: string } {
  switch (t.kind) {
    case "edit":
      return { scope: "entry", id: t.entryId };
    case "new":
      return { scope: "entry-new", id: `${t.itemId}:${t.entryKind}` };
    case "answer":
      return { scope: "entry-answer", id: t.questionId };
    case "supersede":
      return { scope: "entry-supersede", id: t.entryId };
  }
}

/** The browser-storage key of an entry editor's draft. */
export function entryDraftKey(t: EntryDraftTarget): string {
  const { scope, id } = entryDraftScope(t);
  return draftKey(scope, id, ENTRY_DRAFT_FIELD);
}

/**
 * A leftover draft for one entry editor, checked WITHOUT opening the editor
 * (so an entry can show Restore / Discard in its row). `stored` is the entry's
 * current text, or "" for a composer (no stored value).
 */
export function leftoverEntryDraft(
  store: DraftStore,
  t: EntryDraftTarget,
  stored: string,
): RestoreDecision<EntryDraftFields> {
  return restoreDecision<EntryDraftFields>(
    { body: readFieldDraft(store, entryDraftKey(t)) },
    { body: stored },
  );
}

// ── Grouping and order ─────────────────────────────────────────────────────

/** Newest first; ties broken by id (descending), matching the list query. */
export function newestFirst<T extends Pick<ItemEntry, "created_at" | "id">>(a: T, b: T): number {
  return b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
}

const sorted = (rows: ItemEntry[]) => [...rows].sort(newestFirst);

export type ProgressGroups = {
  /** Live progress notes (state current), newest first. */
  current: ItemEntry[];
  /** Superseded notes, newest first (collapsed in the panel). */
  superseded: ItemEntry[];
  /** Soft-deleted notes, newest first (collapsed; restorable). */
  deleted: ItemEntry[];
};

/** The Progress panel's timeline. Entries of other kinds are ignored. */
export function groupProgress(entries: ItemEntry[]): ProgressGroups {
  const rows = sorted(entries.filter((e) => e.kind === "progress"));
  return {
    current: rows.filter((e) => !e.deleted_at && e.state !== "superseded"),
    superseded: rows.filter((e) => !e.deleted_at && e.state === "superseded"),
    deleted: rows.filter((e) => !!e.deleted_at),
  };
}

export type DecisionGroups = {
  /** Open questions, newest first: what's waiting on David, on top. */
  openQuestions: ItemEntry[];
  /** Active decisions, newest first. */
  activeDecisions: ItemEntry[];
  /** Answered questions, newest first (collapsed). */
  answeredQuestions: ItemEntry[];
  /** Superseded decisions, newest first (collapsed). */
  supersededDecisions: ItemEntry[];
  /** Soft-deleted questions and decisions, newest first (collapsed; restorable). */
  deleted: ItemEntry[];
};

/** The Decisions & Questions panel. Progress entries are ignored. */
export function groupDecisions(entries: ItemEntry[]): DecisionGroups {
  const rows = sorted(entries.filter((e) => e.kind === "decision" || e.kind === "question"));
  const live = rows.filter((e) => !e.deleted_at);
  return {
    openQuestions: live.filter((e) => e.kind === "question" && e.state === "open"),
    activeDecisions: live.filter((e) => e.kind === "decision" && e.state === "active"),
    answeredQuestions: live.filter((e) => e.kind === "question" && e.state === "answered"),
    supersededDecisions: live.filter((e) => e.kind === "decision" && e.state === "superseded"),
    deleted: rows.filter((e) => !!e.deleted_at),
  };
}

/** The live entry that supersedes each entry, by the superseded entry's id. */
export function successorsById(entries: ItemEntry[]): Map<string, ItemEntry> {
  const m = new Map<string, ItemEntry>();
  for (const e of entries) {
    if (e.supersedes_id && !e.deleted_at) m.set(e.supersedes_id, e);
  }
  return m;
}

/** "1 open question" / "3 open questions". */
export function openQuestionsLabel(n: number): string {
  return `${n} open question${n === 1 ? "" : "s"}`;
}

// ── Board counts ───────────────────────────────────────────────────────────

/**
 * Open questions per item, from ONE query's rows (kind question, state open,
 * not deleted, for the project's items). Rows that don't fit are skipped when
 * the query returns those columns, so a broader query can't inflate a count.
 * Items with none are absent (the badge hides at 0).
 */
export function countOpenQuestions(
  rows: { item_id: string; kind?: string; state?: string; deleted_at?: string | null }[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.kind !== undefined && r.kind !== "question") continue;
    if (r.state !== undefined && r.state !== "open") continue;
    if (r.deleted_at) continue;
    out[r.item_id] = (out[r.item_id] ?? 0) + 1;
  }
  return out;
}

// ── Version history ────────────────────────────────────────────────────────

const STATE_WORD: Record<string, string> = {
  current: "current",
  superseded: "superseded",
  open: "reopened",
  answered: "answered",
  active: "active",
};

/**
 * What the write following `snap` changed, as short phrases, using the state it
 * produced (`after`: the next-newer snapshot, or the entry now for the newest
 * version). The same idea as the card's history summaries.
 */
export function entryChangeSummary(
  fields: EntryTrackedField[],
  snap: Pick<EntrySnapshot, "state" | "deleted_at">,
  after: Pick<EntrySnapshot, "state" | "deleted_at">,
): string[] {
  const out: string[] = [];
  for (const f of fields) {
    if (f === "body") out.push("text edited");
    else if (f === "state") {
      out.push(after.state === snap.state ? "state changed" : `marked ${STATE_WORD[after.state] ?? after.state}`);
    } else if (f === "answered_by_id") {
      if (!fields.includes("state")) out.push("answer link changed");
    } else if (f === "deleted_at") out.push(after.deleted_at ? "deleted" : "restored");
  }
  return out;
}

// ── Keys in an entry editor ────────────────────────────────────────────────

/**
 * An entry editor's textarea keys (DESIGN.md's Enter exception): Cmd/Ctrl+Enter
 * is the primary action (save / add), plain Enter is a newline, Esc finishes.
 * Keys pressed while an IME is composing are the IME's.
 */
export function entryEditorKey(e: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  isComposing?: boolean;
}): "submit" | "escape" | null {
  if (e.isComposing) return null;
  if (e.key === "Escape") return "escape";
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) return "submit";
  return null;
}
