// Item entries (KANBAN-36): state transitions, versioning, restore, lists and
// visibility. Pure — the database steps are fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENTRY_STATES,
  answerError,
  buildEntryListFilter,
  changedEntryFields,
  coalescesIntoLatest,
  createThenMark,
  deletePatch,
  editPatch,
  entrySnapshotOf,
  initialState,
  isRuleError,
  isStateForKind,
  newEntryFields,
  resolveVisibleEntry,
  restoreEntryPatch,
  supersedeError,
  undeleteError,
  type EntryTrackedField,
  type ItemEntry,
  type ItemEntryVersion,
  type RuleError,
} from "./item-entries-rules.ts";

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
const question = (over: Partial<ItemEntry> = {}) =>
  entry({ id: "q1", kind: "question", state: "open", body: "Which DB?", ...over });
const decision = (over: Partial<ItemEntry> = {}) =>
  entry({ id: "d1", kind: "decision", state: "active", body: "Postgres", ...over });

const noSucc = { hasLiveSuccessor: false };
const patchOf = (r: { patch: Record<string, unknown> } | RuleError) => {
  assert.ok(!isRuleError(r), isRuleError(r) ? r.error : "");
  return (r as { patch: Record<string, unknown> }).patch;
};
const errorOf = (r: unknown): RuleError => {
  assert.ok(isRuleError(r), "expected a refusal");
  return r as RuleError;
};

// ── Kinds and states ──────────────────────────────────────────────────────

test("each kind pairs only with its own states and starts in the first", () => {
  assert.equal(initialState("progress"), "current");
  assert.equal(initialState("question"), "open");
  assert.equal(initialState("decision"), "active");
  assert.ok(isStateForKind("progress", "superseded"));
  assert.ok(isStateForKind("decision", "superseded"));
  assert.ok(!isStateForKind("progress", "open"));
  assert.ok(!isStateForKind("question", "superseded"));
  assert.ok(!isStateForKind("decision", "current"));
  assert.deepEqual(Object.keys(ENTRY_STATES), ["progress", "question", "decision"]);
});

test("a new entry needs a known kind and non-blank body, trimmed", () => {
  assert.deepEqual(newEntryFields({ kind: "question", body: "  Why?\r\n" }), {
    kind: "question",
    state: "open",
    body: "Why?",
  });
  assert.match(errorOf(newEntryFields({ kind: "note", body: "x" })).error, /kind must be/);
  assert.match(errorOf(newEntryFields({ kind: "progress", body: "   " })).error, /body/);
  assert.match(errorOf(newEntryFields({ kind: "progress", body: 42 })).error, /body/);
});

// ── Editing ───────────────────────────────────────────────────────────────

test("edit: body keeps trailing whitespace (autosave-safe) but refuses blank", () => {
  assert.deepEqual(patchOf(editPatch(entry(), { body: "a\r\nb " }, noSucc)), { body: "a\nb " });
  assert.equal(errorOf(editPatch(entry(), { body: " \n" }, noSucc)).status, 400);
  assert.match(errorOf(editPatch(entry(), {}, noSucc)).error, /nothing to change/);
});

test("edit: a state must belong to the kind", () => {
  const e = errorOf(editPatch(entry(), { state: "open" }, noSucc));
  assert.equal(e.status, 400);
  assert.match(e.error, /current or superseded/);
});

test("edit: can't supersede by editing; supersede is its own action", () => {
  assert.match(errorOf(editPatch(entry(), { state: "superseded" }, noSucc)).error, /supersede/);
  assert.match(
    errorOf(editPatch(decision(), { state: "superseded" }, noSucc)).error,
    /supersede/,
  );
});

test("edit: reinstating a superseded entry only once nothing live supersedes it", () => {
  const old = entry({ state: "superseded" });
  assert.equal(errorOf(editPatch(old, { state: "current" }, { hasLiveSuccessor: true })).status, 409);
  assert.deepEqual(patchOf(editPatch(old, { state: "current" }, noSucc)), { state: "current" });
});

test("edit: reopening a question clears its decision; answering by edit leaves no link", () => {
  const answered = question({ state: "answered", answered_by_id: "d1" });
  assert.deepEqual(patchOf(editPatch(answered, { state: "open" }, noSucc)), {
    state: "open",
    answered_by_id: null,
  });
  assert.deepEqual(patchOf(editPatch(question(), { state: "answered" }, noSucc)), {
    state: "answered",
  });
});

test("edit: unchanged state is not a state change", () => {
  assert.deepEqual(patchOf(editPatch(entry(), { state: "current", body: "x" }, noSucc)), {
    body: "x",
  });
});

test("edit: a deleted entry must be restored first", () => {
  const e = errorOf(editPatch(entry({ deleted_at: "2026-09-16T11:00:00Z" }), { body: "x" }, noSucc));
  assert.equal(e.status, 409);
});

// ── Supersede ─────────────────────────────────────────────────────────────

test("supersede: progress and decisions only, never a question", () => {
  assert.equal(supersedeError(entry(), noSucc), null);
  assert.equal(supersedeError(decision(), noSucc), null);
  assert.match(supersedeError(question(), noSucc)!.error, /answer a question/);
});

test("supersede: an already-superseded entry is refused", () => {
  assert.equal(supersedeError(entry({ state: "superseded" }), noSucc)!.status, 409);
  // Reinstated by hand but a live successor still points at it: still refused.
  assert.equal(supersedeError(entry(), { hasLiveSuccessor: true })!.status, 409);
});

test("supersede: a deleted entry is refused", () => {
  assert.equal(supersedeError(entry({ deleted_at: "2026-09-16T11:00:00Z" }), noSucc)!.status, 409);
});

// ── Answer ────────────────────────────────────────────────────────────────

test("answer: an open question with an active decision on the same item", () => {
  assert.equal(answerError(question(), decision()), null);
  assert.equal(answerError(question(), null), null); // a new decision will be created
});

test("answer: refusals", () => {
  assert.match(answerError(entry(), decision())!.error, /Only a question/);
  assert.equal(answerError(question({ state: "answered" }), decision())!.status, 409);
  assert.equal(answerError(question({ deleted_at: "x" }), decision())!.status, 409);
  assert.match(answerError(question(), decision({ item_id: "item-2" }))!.error, /same item/);
  assert.match(answerError(question(), entry({ id: "p9" }))!.error, /by a decision/);
  assert.match(answerError(question(), question())!.error, /answer itself/);
  assert.match(answerError(question(), decision({ state: "superseded" }))!.error, /superseded/);
  assert.match(answerError(question(), decision({ deleted_at: "x" }))!.error, /deleted/);
});

// ── Soft delete ───────────────────────────────────────────────────────────

test("delete stamps deleted_at/by; deleting twice is refused", () => {
  const now = new Date("2026-09-16T12:00:00.000Z");
  assert.deepEqual(patchOf(deletePatch(entry(), "d@x", now)), {
    deleted_at: "2026-09-16T12:00:00.000Z",
    deleted_by: "d@x",
  });
  assert.equal(errorOf(deletePatch(entry({ deleted_at: "x" }), "d@x")).status, 409);
});

test("undelete: a plain entry comes back; a successor only while it still holds", () => {
  const gone = entry({ deleted_at: "x" });
  const free = { target: null, targetHasOtherLiveSuccessor: false };
  assert.equal(undeleteError(gone, free), null);
  assert.equal(undeleteError(entry(), free)!.status, 409);

  const succ = entry({ id: "e2", supersedes_id: "e1", deleted_at: "x" });
  assert.equal(
    undeleteError(succ, { target: { state: "superseded" }, targetHasOtherLiveSuccessor: false }),
    null,
  );
  assert.match(
    undeleteError(succ, { target: { state: "superseded" }, targetHasOtherLiveSuccessor: true })!
      .error,
    /Another entry/,
  );
  assert.match(
    undeleteError(succ, { target: { state: "current" }, targetHasOtherLiveSuccessor: false })!.error,
    /reinstated/,
  );
});

// ── Versioning: snapshots and coalescing ──────────────────────────────────

test("a snapshot is the entry's mutable state (plus kind)", () => {
  assert.deepEqual(entrySnapshotOf(question({ state: "answered", answered_by_id: "d1" })), {
    kind: "question",
    body: "Which DB?",
    state: "answered",
    answered_by_id: "d1",
    deleted_at: null,
    deleted_by: null,
  });
});

test("only real changes to tracked fields count (one snapshot per edit, none for no-ops)", () => {
  const e = entry();
  assert.deepEqual(changedEntryFields(e, { body: "Did the thing" }), []);
  assert.deepEqual(changedEntryFields(e, { body: "Did more" }), ["body"]);
  assert.deepEqual(changedEntryFields(e, { state: "superseded", body: "x" }), ["body", "state"]);
  assert.deepEqual(changedEntryFields(e, { deleted_at: "x", deleted_by: "d" }), ["deleted_at"]);
  assert.deepEqual(
    changedEntryFields(question({ state: "answered", answered_by_id: "d1" }), {
      state: "open",
      answered_by_id: null,
    }),
    ["state", "answered_by_id"],
  );
  // Untracked / immutable fields never produce a version.
  assert.deepEqual(changedEntryFields(e, { kind: "decision", supersedes_id: "z" }), []);
});

const latest = (
  over: Partial<Pick<ItemEntryVersion, "fields_changed" | "source" | "edit_session" | "created_by">> = {},
) => ({
  fields_changed: ["body"] as EntryTrackedField[],
  source: "web" as const,
  edit_session: "s1",
  created_by: "d@x",
  ...over,
});
const write = (over: Partial<Parameters<typeof coalescesIntoLatest>[1]> = {}) => ({
  actor: "d@x",
  source: "web" as const,
  changed: ["body"] as EntryTrackedField[],
  editSession: "s1",
  ...over,
});

test("coalescing: body autosaves in one editor session fold into one version", () => {
  assert.equal(coalescesIntoLatest(latest(), write()), true);
});

test("coalescing: a new session, actor or source seals the previous version", () => {
  assert.equal(coalescesIntoLatest(latest(), write({ editSession: "s2" })), false);
  assert.equal(coalescesIntoLatest(latest(), write({ actor: "other@x" })), false);
  assert.equal(coalescesIntoLatest(latest({ source: "mcp" }), write()), false);
});

test("coalescing: never without a session, never for non-body changes, never onto a mixed version", () => {
  assert.equal(coalescesIntoLatest(latest(), write({ editSession: null })), false);
  assert.equal(coalescesIntoLatest(latest({ edit_session: null }), write({ editSession: null })), false);
  assert.equal(coalescesIntoLatest(latest(), write({ changed: ["state"] })), false);
  assert.equal(coalescesIntoLatest(latest(), write({ changed: ["body", "state"] })), false);
  assert.equal(coalescesIntoLatest(latest({ fields_changed: ["body", "state"] }), write()), false);
  assert.equal(coalescesIntoLatest(null, write()), false); // first edit always versions
});

// ── Restore ───────────────────────────────────────────────────────────────

const ctx = {
  answeredByValid: true,
  hasLiveSuccessor: false,
  target: null,
  targetHasOtherLiveSuccessor: false,
};

test("restore brings back body, state, link and deletion state", () => {
  const snap = entrySnapshotOf(question({ body: "Old q", state: "answered", answered_by_id: "d1" }));
  const current = question({ body: "New q", state: "open" });
  assert.deepEqual(patchOf(restoreEntryPatch(snap, current, ctx)), {
    body: "Old q",
    state: "answered",
    deleted_at: null,
    deleted_by: null,
    answered_by_id: "d1",
  });
});

test("restore: a decision that is no longer valid restores the question unlinked", () => {
  const snap = entrySnapshotOf(question({ state: "answered", answered_by_id: "d1" }));
  const p = patchOf(restoreEntryPatch(snap, question(), { ...ctx, answeredByValid: false }));
  assert.equal(p.state, "answered");
  assert.equal(p.answered_by_id, null);
});

test("restore: an open snapshot never carries a decision link", () => {
  const snap = { ...entrySnapshotOf(question()), answered_by_id: "d1" };
  assert.equal(patchOf(restoreEntryPatch(snap, question({ state: "answered" }), ctx)).answered_by_id, null);
});

test("restore: non-questions don't touch answered_by_id", () => {
  const snap = entrySnapshotOf(entry({ body: "v1" }));
  assert.ok(!("answered_by_id" in patchOf(restoreEntryPatch(snap, entry(), ctx))));
});

test("restore: a pre-delete version undeletes; a deleted version deletes", () => {
  const live = entrySnapshotOf(entry());
  const gone = entry({ deleted_at: "2026-09-16T12:00:00Z", deleted_by: "d@x" });
  assert.deepEqual(patchOf(restoreEntryPatch(live, gone, ctx)).deleted_at, null);
  const p = patchOf(restoreEntryPatch(entrySnapshotOf(gone), entry(), ctx));
  assert.equal(p.deleted_at, "2026-09-16T12:00:00Z");
  assert.equal(p.deleted_by, "d@x");
});

test("restore: can't reinstate a superseded entry that a live entry supersedes", () => {
  const snap = entrySnapshotOf(entry());
  const current = entry({ state: "superseded" });
  assert.equal(errorOf(restoreEntryPatch(snap, current, { ...ctx, hasLiveSuccessor: true })).status, 409);
  assert.equal(patchOf(restoreEntryPatch(snap, current, ctx)).state, "current");
});

test("restore: undeleting a successor follows the undelete rules", () => {
  const current = entry({ id: "e2", supersedes_id: "e1", deleted_at: "x" });
  const snap = entrySnapshotOf(entry({ id: "e2", supersedes_id: "e1" }));
  assert.match(
    errorOf(
      restoreEntryPatch(snap, current, {
        ...ctx,
        target: { state: "superseded" },
        targetHasOtherLiveSuccessor: true,
      }),
    ).error,
    /Another entry/,
  );
});

test("restore: a snapshot whose state doesn't fit the kind is refused", () => {
  const snap = { ...entrySnapshotOf(entry()), state: "open" as const };
  assert.equal(errorOf(restoreEntryPatch(snap, entry(), ctx)).status, 400);
});

// ── Lists ─────────────────────────────────────────────────────────────────

test("list filter defaults: all kinds and states, 50, deleted excluded", () => {
  assert.deepEqual(buildEntryListFilter(), {
    kinds: null,
    states: null,
    since: null,
    limit: 50,
    includeDeleted: false,
  });
});

test("list filter: kinds/states single or many, since normalised, limit bounds", () => {
  assert.deepEqual(
    buildEntryListFilter({
      kind: ["question", "question", "decision"],
      state: "open",
      since: "2026-09-16T10:00:00+02:00",
      limit: "10",
      includeDeleted: true,
    }),
    {
      kinds: ["question", "decision"],
      states: ["open"],
      since: "2026-09-16T08:00:00.000Z",
      limit: 10,
      includeDeleted: true,
    },
  );
  assert.equal(errorOf(buildEntryListFilter({ limit: 0 })).status, 400);
  assert.equal(errorOf(buildEntryListFilter({ limit: 201 })).status, 400);
  assert.equal(errorOf(buildEntryListFilter({ limit: 2.5 })).status, 400);
  assert.match(errorOf(buildEntryListFilter({ since: "yesterday-ish" })).error, /since/);
  assert.match(errorOf(buildEntryListFilter({ kind: "note" })).error, /kind/);
  assert.match(errorOf(buildEntryListFilter({ kind: [] })).error, /kind/);
});

test("list filter: a state must fit one of the requested kinds", () => {
  assert.ok(!isRuleError(buildEntryListFilter({ state: "superseded" })));
  assert.match(
    errorOf(buildEntryListFilter({ kind: "question", state: "superseded" })).error,
    /open, answered/,
  );
  assert.ok(!isRuleError(buildEntryListFilter({ kind: ["question", "decision"], state: ["open", "active"] })));
});

// ── Visibility ────────────────────────────────────────────────────────────

/** Fake world: item-1 is in a private project only owner@x can see. */
function world(actor: string) {
  const rows = new Map([["e1", entry()]]);
  const calls: string[] = [];
  return {
    calls,
    steps: {
      fetchEntry: async (id: string) => {
        calls.push(`fetch ${id}`);
        return rows.get(id) ?? null;
      },
      loadItem: async (itemId: string) => {
        calls.push(`item ${itemId}`);
        return actor === "owner@x"
          ? { id: itemId }
          : ({ error: `Item not found: ${itemId}`, status: 404 } as RuleError);
      },
    },
  };
}

test("visibility: the owner of the item's project sees the entry", async () => {
  const w = world("owner@x");
  const r = await resolveVisibleEntry("e1", w.steps);
  assert.ok(!isRuleError(r));
  assert.equal((r as { entry: ItemEntry }).entry.id, "e1");
  assert.deepEqual(w.calls, ["fetch e1", "item item-1"]);
});

test("visibility: an entry on an item the actor can't see is 'not found', naming the entry", async () => {
  const r = await resolveVisibleEntry("e1", world("stranger@x").steps);
  assert.deepEqual(r, { error: "Entry not found: e1", status: 404 });
});

test("visibility: a missing entry is not found without consulting the item", async () => {
  const w = world("owner@x");
  assert.deepEqual(await resolveVisibleEntry("nope", w.steps), {
    error: "Entry not found: nope",
    status: 404,
  });
  assert.deepEqual(w.calls, ["fetch nope"]);
});

test("visibility: a database failure is passed through, not masked as not found", async () => {
  const r = await resolveVisibleEntry("e1", {
    fetchEntry: async () => ({ error: "db down", status: 500 }),
    loadItem: async () => ({ id: "item-1" }),
  });
  assert.deepEqual(r, { error: "db down", status: 500 });
});

// ── Create-then-mark (supersede / answer) ─────────────────────────────────

function flow(fail: { create?: boolean; mark?: boolean; undo?: boolean } = {}) {
  const log: string[] = [];
  return {
    log,
    steps: {
      create: async () => {
        log.push("create");
        return fail.create ? ({ error: "already superseded", status: 409 } as RuleError) : "new";
      },
      mark: async (created: string | null) => {
        log.push(`mark ${created}`);
        return fail.mark ? ({ error: "changed since loaded", status: 409 } as RuleError) : "older";
      },
      undoCreate: async (created: string) => {
        log.push(`undo ${created}`);
        return fail.undo ? "undo failed" : null;
      },
    },
  };
}

test("flow: creates the new entry, then marks the older one", async () => {
  const f = flow();
  assert.deepEqual(await createThenMark(f.steps), { created: "new", marked: "older" });
  assert.deepEqual(f.log, ["create", "mark new"]);
});

test("flow: a refused create (e.g. concurrent supersede) changes nothing else", async () => {
  const f = flow({ create: true });
  assert.deepEqual(await createThenMark(f.steps), { error: "already superseded", status: 409 });
  assert.deepEqual(f.log, ["create"]);
});

test("flow: a failed mark removes the entry it just created", async () => {
  const f = flow({ mark: true });
  assert.deepEqual(await createThenMark(f.steps), { error: "changed since loaded", status: 409 });
  assert.deepEqual(f.log, ["create", "mark new", "undo new"]);
});

test("flow: a failed undo is reported, not swallowed", async () => {
  const r = errorOf(await createThenMark(flow({ mark: true, undo: true }).steps));
  assert.equal(r.status, 500);
  assert.match(r.error, /removing the new entry failed/);
});

test("flow: answering with an existing decision only marks", async () => {
  const f = flow({ mark: true });
  const { create: _create, ...noCreate } = f.steps;
  void _create;
  assert.equal(errorOf(await createThenMark(noCreate)).status, 409);
  assert.deepEqual(f.log, ["mark null"]);
});
