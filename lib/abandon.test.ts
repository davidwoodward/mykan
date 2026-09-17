// Save on finish, abandon for free (KANBAN-42): what an editor writes, when,
// what it keeps in browser storage, and what it offers back. Pure — no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDraftSession,
  dirtyPatch,
  draftKey,
  jsonEqual,
  memoryDraftStore,
  readFieldDraft,
  restoreDecision,
  sameMembers,
  type DraftStore,
} from "./abandon.ts";
import {
  changedTrackedFields,
  coalescesWith,
  fieldEqual,
  type TrackedField,
} from "./item-snapshot.ts";
import type { Item, RichDoc } from "./types.ts";

const doc = (text: string): RichDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const itemEqual = (key: string, a: unknown, b: unknown) =>
  fieldEqual(key as TrackedField, a, b);

type ItemFields = { body: RichDoc | null; tags: string[] };

/** The card page's wiring (the item modal before KANBAN-44): a draft session over the fields it edits. */
function openItemEditor(
  stored: ItemFields,
  store: DraftStore = memoryDraftStore(),
  id = "item-1",
) {
  return createDraftSession<ItemFields>({
    opened: stored,
    store,
    keyOf: (f) => draftKey("item", id, f),
    equal: itemEqual,
    baseUpdatedAt: "2026-09-16T00:00:00Z",
    now: () => "2026-09-16T12:00:00Z",
  });
}

/** Records every save sent. */
function saver(fail = false) {
  const sent: Partial<ItemFields>[] = [];
  return {
    sent,
    save: async (patch: Partial<ItemFields>) => {
      sent.push(patch);
      if (fail) throw new Error("HTTP 500");
    },
  };
}

// --- Dirty detection --------------------------------------------------------

test("dirty detection: only fields that differ from the as-opened values", () => {
  const opened = { body: doc("a"), tags: ["ui"], name: "x" };
  assert.equal(dirtyPatch(opened, { ...opened }, jsonEqual), null);
  assert.deepEqual(dirtyPatch(opened, { ...opened, tags: ["ui", "new"] }, jsonEqual), {
    tags: ["ui", "new"],
  });
  // Typed then deleted back to the original: not dirty.
  assert.equal(dirtyPatch(opened, { ...opened, body: doc("a") }, jsonEqual), null);
  // null and undefined are the same empty.
  assert.equal(dirtyPatch({ v: null }, { v: undefined }, jsonEqual), null);
});

test("a session is clean on open and dirty after an edit, clean again when edited back", () => {
  const s = openItemEditor({ body: doc("a"), tags: [] });
  assert.equal(s.dirty, false);
  s.set("body", doc("ab"));
  assert.equal(s.dirty, true);
  s.set("body", doc("a"));
  assert.equal(s.dirty, false);
});

// --- Close ------------------------------------------------------------------

test("typing writes nothing: many edits, then close sends exactly one save", async () => {
  const s = openItemEditor({ body: doc(""), tags: ["ui"] });
  const net = saver();
  for (const t of ["h", "he", "hel", "hell", "hello"]) s.set("body", doc(t));
  s.set("tags", ["ui", "new"]);
  assert.equal(net.sent.length, 0, "nothing is sent while editing");

  const outcome = await s.close(net.save);
  assert.equal(outcome.kind, "saved");
  assert.equal(net.sent.length, 1);
  assert.deepEqual(net.sent[0], { body: doc("hello"), tags: ["ui", "new"] });
});

test("close sends only the changed fields", async () => {
  const s = openItemEditor({ body: doc("keep"), tags: ["ui"] });
  const net = saver();
  s.set("tags", []);
  await s.close(net.save);
  assert.deepEqual(net.sent, [{ tags: [] }]);
});

test("close with no changes sends nothing", async () => {
  const s = openItemEditor({ body: doc("a"), tags: ["ui"] });
  const net = saver();
  assert.deepEqual(await s.close(net.save), { kind: "unchanged" });
  s.set("body", doc("changed"));
  s.set("body", doc("a"));
  assert.deepEqual(await s.close(net.save), { kind: "unchanged" });
  assert.equal(net.sent.length, 0);
});

test("Esc and click-off racing share one save", async () => {
  const s = openItemEditor({ body: doc("a"), tags: [] });
  let resolve!: () => void;
  let calls = 0;
  const save = () => {
    calls++;
    return new Promise<void>((r) => (resolve = r));
  };
  s.set("body", doc("b"));
  const first = s.close(save);
  const second = s.close(save);
  resolve();
  assert.equal((await first).kind, "saved");
  assert.equal((await second).kind, "saved");
  assert.equal(calls, 1);
});

test("a successful close clears the stored draft", async () => {
  const store = memoryDraftStore();
  const s = openItemEditor({ body: doc("a"), tags: [] }, store);
  s.set("body", doc("b"));
  assert.ok(readFieldDraft(store, draftKey("item", "item-1", "body")));
  await s.close(saver().save);
  assert.deepEqual(store.dump(), {});
  assert.equal(s.dirty, false, "the saved values become the new baseline");
});

test("save failure on close keeps the draft (memory and storage) so the editor can stay open", async () => {
  const store = memoryDraftStore();
  const s = openItemEditor({ body: doc("a"), tags: [] }, store);
  s.set("body", doc("long text I must not lose"));
  const outcome = await s.close(saver(true).save);
  assert.deepEqual(outcome, { kind: "failed", error: "HTTP 500" });
  assert.equal(s.dirty, true);
  assert.deepEqual(s.values.body, doc("long text I must not lose"));
  assert.deepEqual(
    readFieldDraft(store, draftKey("item", "item-1", "body"))?.value,
    doc("long text I must not lose"),
  );
  // Retrying (Esc again) sends the same one save.
  const net = saver();
  assert.equal((await s.close(net.save)).kind, "saved");
  assert.deepEqual(net.sent, [{ body: doc("long text I must not lose") }]);
});

// --- Abandon ----------------------------------------------------------------

test("abandon sends nothing and clears the draft", async () => {
  const store = memoryDraftStore();
  const s = openItemEditor({ body: doc("a"), tags: ["ui"] }, store);
  const net = saver();
  s.set("body", doc("abandon me"));
  s.set("tags", ["ui", "x"]);
  s.abandon();
  assert.equal(net.sent.length, 0);
  assert.deepEqual(store.dump(), {});
  assert.equal(s.dirty, false);
  // A stray close afterwards (the editor unmounting) has nothing to send.
  assert.deepEqual(await s.close(net.save), { kind: "unchanged" });
  assert.equal(net.sent.length, 0);
});

// --- Persistence and restore ------------------------------------------------

test("the draft is persisted per item and per field as it changes", () => {
  const store = memoryDraftStore();
  const s = openItemEditor({ body: doc("a"), tags: ["ui"] }, store, "item-7");
  s.set("body", doc("draft"));
  const body = readFieldDraft(store, "mykan:draft:v1:item:item-7:body");
  assert.deepEqual(body, {
    value: doc("draft"),
    base: doc("a"),
    baseUpdatedAt: "2026-09-16T00:00:00Z",
    startedAt: "2026-09-16T12:00:00Z",
  });
  assert.equal(store.get("mykan:draft:v1:item:item-7:tags"), null, "unchanged field not stored");
  // Editing back to the stored value drops that field's draft.
  s.set("body", doc("a"));
  assert.deepEqual(store.dump(), {});
});

test("restore: nothing stored → none; malformed storage → none", () => {
  const stored = { body: doc("a"), tags: [] as string[] };
  assert.deepEqual(restoreDecision({}, stored, itemEqual), { kind: "none" });
  const store = memoryDraftStore();
  store.set(draftKey("item", "i", "body"), "{not json");
  store.set(draftKey("item", "i", "tags"), JSON.stringify({ nope: 1 }));
  const drafts = {
    body: readFieldDraft(store, draftKey("item", "i", "body")),
    tags: readFieldDraft(store, draftKey("item", "i", "tags")),
  };
  assert.deepEqual(restoreDecision(drafts, stored, itemEqual), { kind: "none" });
});

test("restore: a leftover draft that differs from the stored value is offered (not stale)", () => {
  const store = memoryDraftStore();
  openItemEditor({ body: doc("a"), tags: [] }, store).set("body", doc("crashed mid-edit"));
  const drafts = { body: readFieldDraft(store, draftKey("item", "item-1", "body")) };
  const d = restoreDecision(drafts, { body: doc("a"), tags: [] }, itemEqual);
  assert.equal(d.kind, "offer");
  if (d.kind !== "offer") return;
  assert.deepEqual(d.values, { body: doc("crashed mid-edit") });
  assert.equal(d.stale, false);
  assert.equal(d.startedAt, "2026-09-16T12:00:00Z");
});

test("restore: a draft whose save landed (tab-close save) matches the stored value → clear", () => {
  const store = memoryDraftStore();
  openItemEditor({ body: doc("a"), tags: [] }, store).set("body", doc("saved on pagehide"));
  const drafts = { body: readFieldDraft(store, draftKey("item", "item-1", "body")) };
  assert.deepEqual(
    restoreDecision(drafts, { body: doc("saved on pagehide"), tags: [] }, itemEqual),
    { kind: "clear" },
  );
});

test("restore: the card changed on the server since the draft began → offered as stale", () => {
  const store = memoryDraftStore();
  const s = openItemEditor({ body: doc("a"), tags: ["ui"] }, store);
  s.set("body", doc("my draft"));
  s.set("tags", ["ui", "mine"]);
  const drafts = {
    body: readFieldDraft(store, draftKey("item", "item-1", "body")),
    tags: readFieldDraft(store, draftKey("item", "item-1", "tags")),
  };
  // Meanwhile another session rewrote the body; tags are untouched.
  const d = restoreDecision(drafts, { body: doc("written over MCP"), tags: ["ui"] }, itemEqual);
  assert.equal(d.kind, "offer");
  if (d.kind !== "offer") return;
  assert.equal(d.stale, true);
  assert.deepEqual(d.staleFields, ["body"]);
  assert.deepEqual(d.values, { body: doc("my draft"), tags: ["ui", "mine"] });
});

test("Restore puts the draft back as unsaved changes; the close then saves it once", async () => {
  const store = memoryDraftStore();
  openItemEditor({ body: doc("a"), tags: [] }, store).set("body", doc("recovered"));
  const reopened = openItemEditor({ body: doc("a"), tags: [] }, store);
  const drafts = { body: readFieldDraft(store, draftKey("item", "item-1", "body")) };
  const d = restoreDecision(drafts, reopened.opened as ItemFields, itemEqual);
  assert.equal(d.kind, "offer");
  if (d.kind !== "offer") return;
  reopened.restore(d.values);
  assert.equal(reopened.dirty, true);
  const net = saver();
  await reopened.close(net.save);
  assert.deepEqual(net.sent, [{ body: doc("recovered") }]);
  assert.deepEqual(store.dump(), {});
});

test("Discard forgets the leftover draft without writing", () => {
  const store = memoryDraftStore();
  openItemEditor({ body: doc("a"), tags: [] }, store).set("body", doc("unwanted"));
  const reopened = openItemEditor({ body: doc("a"), tags: [] }, store);
  reopened.clearStored();
  assert.deepEqual(store.dump(), {});
  assert.equal(reopened.dirty, false);
});

// --- History ----------------------------------------------------------------

test("one kept edit is one history entry; a tab-close save then a close save still coalesce", () => {
  const opened: Item["body"] = doc("a");
  const current = { body: opened, tags: ["ui"] } as unknown as Item;
  // The close save: body + tags change in ONE write → one snapshot.
  assert.deepEqual(changedTrackedFields(current, { body: doc("b"), tags: [] }), ["body", "tags"]);
  // A best-effort pagehide save (bfcache: the page came back) followed by the
  // close save of the same open: body-only writes in one session fold together.
  const latest = {
    fields_changed: ["body"],
    source: "web",
    edit_session: "open-1",
    created_by: "david",
  };
  assert.equal(
    coalescesWith(latest, { actor: "david", source: "web", changed: ["body"], editSession: "open-1" }),
    true,
  );
  assert.equal(
    coalescesWith(latest, { actor: "david", source: "web", changed: ["body"], editSession: "open-2" }),
    false,
    "the next open gets its own entry",
  );
});

test("sameMembers is order- and case-insensitive", () => {
  assert.ok(sameMembers(["a@x.com", "B@x.com"], ["b@x.com", "a@x.com"]));
  assert.ok(!sameMembers(["a@x.com"], ["a@x.com", "b@x.com"]));
});
