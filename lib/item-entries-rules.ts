// Pure item-entry rules (KANBAN-36): kinds and states, edit/supersede/answer
// validation, snapshots and the coalescing decision, restore, list filters and
// the create-then-mark flow. No DB, no "server-only", so `node --test` can load
// it. lib/item-entries.ts owns the database side and mirrors these rules in the
// same order the migration (2026-09-16-3-item-entries.sql) enforces them.

/**
 * Where a write came from. The same union as HistorySource in
 * lib/item-history.ts (declared here so this module imports nothing
 * server-only); 'recovery' marks restores.
 */
export type HistorySource = "web" | "mcp" | "telegram" | "recovery";

export const ENTRY_KINDS = ["progress", "question", "decision"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** Each kind's states; the first is the state a new entry starts in. */
export const ENTRY_STATES = {
  progress: ["current", "superseded"],
  question: ["open", "answered"],
  decision: ["active", "superseded"],
} as const satisfies Record<EntryKind, readonly string[]>;
export type EntryState = (typeof ENTRY_STATES)[EntryKind][number];

export type ItemEntry = {
  id: string;
  item_id: string;
  kind: EntryKind;
  state: EntryState;
  /** Plain text. */
  body: string;
  /** The older entry (same item, same kind) this one replaces. Immutable. */
  supersedes_id: string | null;
  /** Questions only: the decision (same item) that answered it. */
  answered_by_id: string | null;
  /** Where the entry was created. */
  source: HistorySource;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  /** Soft delete: set = removed from lists by default, recoverable. */
  deleted_at: string | null;
  deleted_by: string | null;
};

/** Mutable fields history tracks. kind/item_id/supersedes_id never change. */
export const ENTRY_TRACKED_FIELDS = ["body", "state", "answered_by_id", "deleted_at"] as const;
export type EntryTrackedField = (typeof ENTRY_TRACKED_FIELDS)[number];

/** An entry's mutable state at one moment (kind rides along for context). */
export type EntrySnapshot = {
  kind: EntryKind;
  body: string;
  state: EntryState;
  answered_by_id: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
};

export type ItemEntryVersion = {
  id: string;
  entry_id: string;
  /** The entry's state BEFORE the write this row records. */
  snapshot: EntrySnapshot;
  /** Which tracked fields the write FOLLOWING this snapshot changed. */
  fields_changed: EntryTrackedField[];
  source: HistorySource;
  edit_session: string | null;
  created_at: string;
  created_by: string | null;
};

/** A refused action: the message to show and the HTTP-ish status. */
export type RuleError = { error: string; status: number };
const err = (error: string, status = 400): RuleError => ({ error, status });

export function isEntryKind(v: unknown): v is EntryKind {
  return typeof v === "string" && (ENTRY_KINDS as readonly string[]).includes(v);
}

export function isStateForKind(kind: EntryKind, state: unknown): state is EntryState {
  return typeof state === "string" && (ENTRY_STATES[kind] as readonly string[]).includes(state);
}

export function initialState(kind: EntryKind): EntryState {
  return ENTRY_STATES[kind][0];
}

/** Can this kind be superseded (and supersede)? Questions are answered instead. */
export function isSupersedable(kind: EntryKind): boolean {
  return kind === "progress" || kind === "decision";
}

/**
 * The most characters an entry (progress, question or decision) may hold,
 * counted on the trimmed, LF-normalised text. One number for every kind and
 * every writer: MCP refuses over it (lib/mcp-entry-guards.ts re-exports it as
 * MCP_ENTRY_MAX_CHARS, with its own guidance), and so do the web routes
 * (KANBAN-38), whose editors show a count against it. Over the cap nothing is
 * saved; text is never truncated.
 */
export const ENTRY_MAX_CHARS = 2000;

/** The length the cap is measured on: CRLF → LF, trimmed. Non-text → 0. */
export function entryTextLength(raw: unknown): number {
  return typeof raw === "string" ? raw.replace(/\r\n/g, "\n").trim().length : 0;
}

/** Why this entry text is refused (not text, blank, over the cap), or null. */
export function entryLengthError(raw: unknown): string | null {
  if (typeof raw !== "string") return "Entry text must be a string";
  const length = entryTextLength(raw);
  if (length === 0) return "Entry text required";
  if (length <= ENTRY_MAX_CHARS) return null;
  const fmt = (n: number) => n.toLocaleString("en-US");
  return `This entry is ${fmt(length)} characters; the cap is ${fmt(ENTRY_MAX_CHARS)}. Nothing was saved.`;
}

/**
 * Normalise body text for a NEW entry: CRLF → LF, trimmed. Blank → null.
 * Plain text. The size cap is the caller's check (entryLengthError).
 */
export function normalizeEntryBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\r\n/g, "\n").trim();
  return text ? text : null;
}

/**
 * Normalise body text for an EDIT: CRLF → LF but not trimmed, so an editor
 * autosaving mid-typing doesn't have its trailing space or newline eaten.
 * Blank → null.
 */
export function normalizeEditedBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\r\n/g, "\n");
  return text.trim() ? text : null;
}

function describeKinds(): string {
  return ENTRY_KINDS.join(", ");
}

function describeStates(kind: EntryKind): string {
  return ENTRY_STATES[kind].join(" or ");
}

/** Validate a new entry. Returns the row fields to insert, or an error. */
export function newEntryFields(input: {
  kind: unknown;
  body: unknown;
}): { kind: EntryKind; state: EntryState; body: string } | RuleError {
  if (!isEntryKind(input.kind)) return err(`kind must be one of: ${describeKinds()}`);
  const body = normalizeEntryBody(input.body);
  if (!body) return err("body text required");
  return { kind: input.kind, state: initialState(input.kind), body };
}

// ── Snapshots and coalescing ──────────────────────────────────────────────

export function entrySnapshotOf(e: ItemEntry): EntrySnapshot {
  return {
    kind: e.kind,
    body: e.body,
    state: e.state,
    answered_by_id: e.answered_by_id,
    deleted_at: e.deleted_at,
    deleted_by: e.deleted_by,
  };
}

/** The tracked fields a patch would actually change on the current row. */
export function changedEntryFields(
  current: ItemEntry,
  patch: Record<string, unknown>,
): EntryTrackedField[] {
  return ENTRY_TRACKED_FIELDS.filter(
    (f) => f in patch && (patch[f] ?? null) !== (current[f] ?? null),
  );
}

/**
 * The same rule as item history: a body-only change folds into the latest
 * version when that version is a body-only edit from the SAME editor session,
 * actor and source. No session (MCP, Telegram, recovery, flows) never coalesces,
 * so dismissing the editor seals the entry and every tool call is its own record.
 */
export function coalescesIntoLatest(
  latest: Pick<ItemEntryVersion, "fields_changed" | "source" | "edit_session" | "created_by"> | null,
  write: {
    actor: string;
    source: HistorySource;
    changed: EntryTrackedField[];
    editSession: string | null;
  },
): boolean {
  if (!write.editSession || !latest) return false;
  if (!(write.changed.length === 1 && write.changed[0] === "body")) return false;
  return (
    latest.edit_session === write.editSession &&
    latest.created_by === write.actor &&
    latest.source === write.source &&
    latest.fields_changed.length === 1 &&
    latest.fields_changed[0] === "body"
  );
}

// ── Edit, supersede, answer, delete ───────────────────────────────────────

/**
 * The patch for an edit of body and/or state. Superseding is its own action
 * (supersedeError), so an edit can't move an entry INTO 'superseded'; it can
 * reinstate a superseded entry once no live entry supersedes it. Reopening a
 * question clears its answering decision; marking it answered by edit leaves
 * it answered without a linked decision.
 */
export function editPatch(
  entry: ItemEntry,
  input: { body?: unknown; state?: unknown },
  ctx: { hasLiveSuccessor: boolean },
): { patch: Record<string, unknown> } | RuleError {
  if (input.body === undefined && input.state === undefined) {
    return err("nothing to change: pass body and/or state");
  }
  if (entry.deleted_at) return err("This entry is deleted; restore it before editing", 409);
  const patch: Record<string, unknown> = {};

  if (input.body !== undefined) {
    const body = normalizeEditedBody(input.body);
    if (!body) return err("body text required");
    patch.body = body;
  }

  if (input.state !== undefined && input.state !== entry.state) {
    const to = input.state;
    if (!isStateForKind(entry.kind, to)) {
      return err(`A ${entry.kind} entry's state must be ${describeStates(entry.kind)}`);
    }
    if (to === "superseded") {
      return err("Use supersede to replace an entry with a newer one");
    }
    if (entry.state === "superseded" && ctx.hasLiveSuccessor) {
      return err(
        "A newer entry supersedes this one; delete that entry before reinstating this one",
        409,
      );
    }
    patch.state = to;
    if (entry.kind === "question" && to === "open") patch.answered_by_id = null;
  }

  return { patch };
}

/** Why `older` can't be superseded now, or null. */
export function supersedeError(
  older: ItemEntry,
  ctx: { hasLiveSuccessor: boolean },
): RuleError | null {
  if (!isSupersedable(older.kind)) {
    return err("Only progress and decision entries can be superseded; answer a question instead");
  }
  if (older.deleted_at) return err("A deleted entry cannot be superseded", 409);
  if (older.state === "superseded" || ctx.hasLiveSuccessor) {
    return err("That entry is already superseded", 409);
  }
  return null;
}

/** Why `question` can't be answered by `decision` now, or null. */
export function answerError(
  question: ItemEntry,
  decision: ItemEntry | null,
): RuleError | null {
  if (question.kind !== "question") return err("Only a question can be answered");
  if (question.deleted_at) return err("A deleted question cannot be answered", 409);
  if (question.state === "answered") {
    return err("That question is already answered; reopen it first to answer it again", 409);
  }
  if (decision) {
    if (decision.id === question.id) return err("A question cannot answer itself");
    if (decision.item_id !== question.item_id) {
      return err("A question can only be answered by a decision on the same item");
    }
    if (decision.kind !== "decision") return err("A question can only be answered by a decision");
    if (decision.deleted_at) return err("That decision is deleted", 409);
    if (decision.state !== "active") return err("That decision is superseded", 409);
  }
  return null;
}

export function deletePatch(
  entry: ItemEntry,
  actor: string,
  now: Date = new Date(),
): { patch: Record<string, unknown> } | RuleError {
  if (entry.deleted_at) return err("This entry is already deleted", 409);
  return { patch: { deleted_at: now.toISOString(), deleted_by: actor } };
}

/**
 * Why a deleted entry can't come back now, or null. A successor may only
 * return while the entry it superseded is still superseded and no other live
 * entry has superseded it since (the database allows one live successor).
 */
export function undeleteError(
  entry: ItemEntry,
  ctx: { target: Pick<ItemEntry, "state"> | null; targetHasOtherLiveSuccessor: boolean },
): RuleError | null {
  if (!entry.deleted_at) return err("This entry is not deleted", 409);
  if (entry.supersedes_id) {
    if (ctx.targetHasOtherLiveSuccessor) {
      return err("Another entry has superseded the same entry since; it can't be restored", 409);
    }
    if (ctx.target && ctx.target.state !== "superseded") {
      return err(
        "The entry this one superseded has been reinstated; it can't be restored",
        409,
      );
    }
  }
  return null;
}

// ── Restore a version ─────────────────────────────────────────────────────

/**
 * The patch that restores `snap` onto `current`. The caller resolves what may
 * have changed since the snapshot:
 *  - `answeredByValid`: the snapshot's decision still exists on the same item
 *    as a decision (else the question is restored without a link).
 *  - `hasLiveSuccessor`: a live entry supersedes `current` now (a restore can't
 *    reinstate it then).
 *  - `target` / `targetHasOtherLiveSuccessor`: for an entry that supersedes
 *    another, the undelete checks when the restore brings it back.
 * Restoring is just another write through the chokepoint, so it is reversible.
 */
export function restoreEntryPatch(
  snap: EntrySnapshot,
  current: ItemEntry,
  ctx: {
    answeredByValid: boolean;
    hasLiveSuccessor: boolean;
    target: Pick<ItemEntry, "state"> | null;
    targetHasOtherLiveSuccessor: boolean;
  },
): { patch: Record<string, unknown> } | RuleError {
  if (!isStateForKind(current.kind, snap.state) || !normalizeEditedBody(snap.body)) {
    return err("That version can't be restored onto this entry");
  }
  const patch: Record<string, unknown> = {
    body: snap.body,
    state: snap.state,
    deleted_at: snap.deleted_at ?? null,
    deleted_by: snap.deleted_at ? (snap.deleted_by ?? null) : null,
  };
  if (current.kind === "question") {
    patch.answered_by_id =
      snap.state === "answered" && snap.answered_by_id && ctx.answeredByValid
        ? snap.answered_by_id
        : null;
  }
  const reinstating = current.state === "superseded" && snap.state !== "superseded";
  if (reinstating && ctx.hasLiveSuccessor) {
    return err(
      "A newer entry supersedes this one; delete that entry before restoring this version",
      409,
    );
  }
  if (current.deleted_at && !snap.deleted_at) {
    const e = undeleteError(current, {
      target: ctx.target,
      targetHasOtherLiveSuccessor: ctx.targetHasOtherLiveSuccessor,
    });
    if (e) return e;
  }
  return { patch };
}

// ── Lists ─────────────────────────────────────────────────────────────────

export const ENTRY_LIST_DEFAULT_LIMIT = 50;
export const ENTRY_LIST_MAX_LIMIT = 200;

export type EntryListInput = {
  kind?: unknown;
  state?: unknown;
  /** ISO timestamp: only entries created after it. */
  since?: unknown;
  limit?: unknown;
  includeDeleted?: unknown;
};

export type EntryListFilter = {
  kinds: EntryKind[] | null;
  states: EntryState[] | null;
  since: string | null;
  limit: number;
  includeDeleted: boolean;
};

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);

/** Validate list options into a filter the query applies (newest first). */
export function buildEntryListFilter(input: EntryListInput = {}): EntryListFilter | RuleError {
  let kinds: EntryKind[] | null = null;
  if (input.kind !== undefined && input.kind !== null) {
    const raw = asList(input.kind);
    if (!raw.length || !raw.every(isEntryKind)) {
      return err(`kind must be one of: ${describeKinds()}`);
    }
    kinds = [...new Set(raw as EntryKind[])];
  }

  let states: EntryState[] | null = null;
  if (input.state !== undefined && input.state !== null) {
    const raw = asList(input.state);
    const scope = kinds ?? [...ENTRY_KINDS];
    const valid = new Set<string>(scope.flatMap((k) => ENTRY_STATES[k]));
    if (!raw.length || !raw.every((s) => typeof s === "string" && valid.has(s))) {
      return err(`state must be one of: ${[...valid].join(", ")}`);
    }
    states = [...new Set(raw as EntryState[])];
  }

  let since: string | null = null;
  if (input.since !== undefined && input.since !== null && input.since !== "") {
    const t = typeof input.since === "string" ? Date.parse(input.since) : NaN;
    if (Number.isNaN(t)) return err("since must be an ISO date/time");
    since = new Date(t).toISOString();
  }

  let limit = ENTRY_LIST_DEFAULT_LIMIT;
  if (input.limit !== undefined && input.limit !== null) {
    const n = Number(input.limit);
    if (!Number.isInteger(n) || n < 1 || n > ENTRY_LIST_MAX_LIMIT) {
      return err(`limit must be a whole number from 1 to ${ENTRY_LIST_MAX_LIMIT}`);
    }
    limit = n;
  }

  return { kinds, states, since, limit, includeDeleted: input.includeDeleted === true };
}

export function isRuleError(v: unknown): v is RuleError {
  return typeof v === "object" && v !== null && "error" in v && "status" in v;
}

// ── Visibility ────────────────────────────────────────────────────────────

/**
 * An entry is visible exactly when its parent item is: fetch the row, then ask
 * the item loader (loadVisibleItem, which applies project privacy). An entry
 * on an item the actor can't see is reported as not found, like the item is.
 */
export async function resolveVisibleEntry<T>(
  entryId: string,
  steps: {
    fetchEntry: (id: string) => Promise<ItemEntry | null | RuleError>;
    loadItem: (itemId: string) => Promise<T | RuleError>;
  },
): Promise<{ entry: ItemEntry; item: T } | RuleError> {
  const notFound = err(`Entry not found: ${entryId}`, 404);
  const entry = await steps.fetchEntry(entryId);
  if (isRuleError(entry)) return entry;
  if (!entry) return notFound;
  const item = await steps.loadItem(entry.item_id);
  if (isRuleError(item)) return item.status === 404 ? notFound : item;
  return { entry, item };
}

// ── Create-then-mark flow ─────────────────────────────────────────────────

/**
 * Supersede (create the newer entry, then mark the older superseded) and answer
 * (create the decision, then mark the question answered) are two writes with
 * no shared transaction. Create goes FIRST: the database refuses a second live
 * successor, so a concurrent duplicate fails before anything else changes.
 * Mark is guarded on the older state. If mark fails, the just-created row
 * (which has no history yet) is removed so nothing half-done is left behind.
 * `create` may be absent (answering with an existing decision): mark only.
 */
export async function createThenMark<C, M>(steps: {
  create?: () => Promise<C | RuleError>;
  mark: (created: C | null) => Promise<M | RuleError>;
  undoCreate: (created: C) => Promise<string | null>;
}): Promise<{ created: C | null; marked: M } | RuleError> {
  let created: C | null = null;
  if (steps.create) {
    const c = await steps.create();
    if (isRuleError(c)) return c;
    created = c;
  }
  const m = await steps.mark(created);
  if (isRuleError(m)) {
    if (created !== null) {
      const undo = await steps.undoCreate(created);
      if (undo) {
        return err(`${m.error}; and removing the new entry failed (${undo})`, 500);
      }
    }
    return m;
  }
  return { created, marked: m };
}
