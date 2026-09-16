// Abandon changes (KANBAN-42): what an editor writes back, when, and how the
// revert lands in item history. Pure — no database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAbandonSession, itemRevertBody, jsonEqual } from "./abandon.ts";
import {
  changedTrackedFields,
  coalescesWith,
  fieldEqual,
  snapshotOf,
  type ItemSnapshot,
  type TrackedField,
} from "./item-snapshot.ts";
import type { Item, RichDoc } from "./types.ts";

const doc = (text: string): RichDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const itemEqual = (key: string, a: unknown, b: unknown) =>
  fieldEqual(key as TrackedField, a, b);

/** A deferred promise, to hold a save "in flight". */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * An in-memory item row plus its history, applying writes with the same rules
 * as snapshotThenWrite (lib/item-history.ts): dedupe unchanged writes, coalesce
 * a body-only write into the latest entry from the same edit session,
 * otherwise snapshot the previous state first.
 */
function fakeItemStore(initial: Item) {
  let row = initial;
  const versions: {
    snapshot: ItemSnapshot;
    fields_changed: TrackedField[];
    source: string;
    edit_session: string | null;
    created_by: string | null;
  }[] = [];
  return {
    get row() {
      return row;
    },
    versions,
    patch(body: Record<string, unknown>) {
      const { edit_session, abandon, ...patch } = body;
      const editSession = typeof edit_session === "string" ? edit_session : null;
      const changed = changedTrackedFields(row, patch);
      const latest = versions[versions.length - 1] ?? null;
      if (
        changed.length > 0 &&
        !coalescesWith(latest, { actor: "david", source: "web", changed, editSession })
      ) {
        versions.push({
          snapshot: {
            ...snapshotOf(row),
            ...(abandon === true ? { revert_reason: "abandoned" as const } : {}),
          },
          fields_changed: changed,
          source: "web",
          edit_session: editSession,
          created_by: "david",
        });
      }
      row = { ...row, ...patch } as Item;
    },
  };
}

const baseItem = (over: Partial<Item> = {}): Item => ({
  id: "item-1",
  project_id: "project-1",
  number: 42,
  type: "feature",
  status: "in_progress",
  position: 1024,
  body: doc("as opened"),
  tags: ["ui"],
  assignees: [],
  category_id: null,
  parent_id: null,
  attachments: [],
  archived_at: null,
  github_issue: null,
  github_issue_created_at: null,
  github_imported_at: null,
  github_sync: null,
  done_at: null,
  created_at: "2026-09-16T00:00:00Z",
  updated_at: "2026-09-16T00:00:00Z",
  created_by: "david",
  updated_by: "david",
  ...over,
});

/** The item modal's wiring: an abandon session over the fields it edits. */
function openItemEditor(store: ReturnType<typeof fakeItemStore>, editSession = "session-S") {
  const it = store.row;
  const session = createAbandonSession(
    { body: it.body, tags: it.tags, parent_id: it.parent_id ?? null },
    { equal: itemEqual },
  );
  let n = 0;
  const mint = () => `revert-${++n}`;
  return {
    session,
    autosaveBody(body: RichDoc) {
      return session.save({ body }, async () => store.patch({ body, edit_session: editSession }));
    },
    abandon(cancelPending?: () => void) {
      return session.abandon({
        cancelPending,
        revert: async (patch) => store.patch(itemRevertBody(patch, editSession, mint)),
      });
    },
  };
}

test("abandon with no changes just closes: nothing written, no history", async () => {
  const store = fakeItemStore(baseItem());
  const editor = openItemEditor(store);
  const outcome = await editor.abandon();
  assert.deepEqual(outcome, { kind: "closed" });
  assert.equal(store.versions.length, 0);
  assert.deepEqual(store.row.body, doc("as opened"));
});

test("a change saved back equal to the as-opened value needs no revert", async () => {
  const store = fakeItemStore(baseItem());
  const editor = openItemEditor(store);
  await editor.autosaveBody(doc("as opened"));
  assert.equal(editor.session.revertPatch(), null);
  assert.deepEqual(await editor.abandon(), { kind: "closed" });
  assert.equal(store.versions.length, 0);
});

test("revert after autosave restores the as-opened body and keeps the abandoned text in history", async () => {
  const store = fakeItemStore(baseItem());
  const editor = openItemEditor(store);
  await editor.autosaveBody(doc("draft that will be abandoned"));
  assert.deepEqual(store.row.body, doc("draft that will be abandoned"));

  const outcome = await editor.abandon();
  assert.equal(outcome.kind, "reverted");
  assert.deepEqual(store.row.body, doc("as opened"));
  // Entry 1: the as-opened state (before the autosave). Entry 2: the abandoned
  // draft (before the revert), annotated, so Restore can bring it back.
  assert.equal(store.versions.length, 2);
  assert.deepEqual(store.versions[0].snapshot.body, doc("as opened"));
  assert.deepEqual(store.versions[1].snapshot.body, doc("draft that will be abandoned"));
  assert.equal(store.versions[1].snapshot.revert_reason, "abandoned");
  assert.notEqual(store.versions[1].edit_session, "session-S");
});

test("abandon after multiple autosaves reverts once and the last abandoned text survives coalescing", async () => {
  const store = fakeItemStore(baseItem());
  const editor = openItemEditor(store);
  await editor.autosaveBody(doc("one"));
  await editor.autosaveBody(doc("one two"));
  await editor.autosaveBody(doc("one two three"));
  // The three autosaves share the session, so they coalesce into one entry.
  assert.equal(store.versions.length, 1);

  await editor.abandon();
  assert.deepEqual(store.row.body, doc("as opened"));
  assert.equal(store.versions.length, 2);
  assert.deepEqual(store.versions[1].snapshot.body, doc("one two three"));
});

test("sending the revert under the editor's own session would lose the abandoned text (why the session is fresh)", async () => {
  const store = fakeItemStore(baseItem());
  store.patch({ body: doc("abandoned"), edit_session: "session-S" });
  store.patch({ body: doc("as opened"), edit_session: "session-S" });
  assert.equal(store.versions.length, 1);
  assert.ok(!store.versions.some((v) => fieldEqual("body", v.snapshot.body, doc("abandoned"))));
});

test("the revert body always carries a session different from the editor's", () => {
  const minted = ["session-S", "session-S", "fresh"];
  const body = itemRevertBody({ body: null }, "session-S", () => minted.shift() as string);
  assert.equal(body.edit_session, "fresh");
  assert.equal(body.abandon, true);
  assert.equal(body.body, null);
});

test("abandon while an autosave is pending cancels it and writes nothing", async () => {
  const store = fakeItemStore(baseItem());
  const editor = openItemEditor(store);
  // Typing scheduled a debounced save that hasn't fired yet.
  let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
    void editor.autosaveBody(doc("typed, not yet saved"));
  }, 5);
  const outcome = await editor.abandon(() => {
    if (timer) clearTimeout(timer);
    timer = null;
  });
  assert.deepEqual(outcome, { kind: "closed" });
  await new Promise((r) => setTimeout(r, 15));
  assert.deepEqual(store.row.body, doc("as opened"));
  assert.equal(store.versions.length, 0);
});

test("a save that fires after abandon started is dropped", async () => {
  const store = fakeItemStore(baseItem());
  const editor = openItemEditor(store);
  await editor.autosaveBody(doc("saved"));
  const abandoning = editor.abandon();
  // e.g. the editor's unmount flush, or a late debounce.
  let ran = false;
  const late = await editor.session.save({ body: doc("late") }, async () => {
    ran = true;
  });
  assert.equal(late, undefined);
  assert.equal(ran, false);
  await abandoning;
  assert.deepEqual(store.row.body, doc("as opened"));
});

test("an in-flight autosave lands before the revert, never after it", async () => {
  const store = fakeItemStore(baseItem());
  const session = createAbandonSession({ body: store.row.body }, { equal: itemEqual });
  const order: string[] = [];
  const network = deferred();
  const saving = session.save({ body: doc("in flight") }, async () => {
    await network.promise;
    order.push("autosave");
    store.patch({ body: doc("in flight"), edit_session: "session-S" });
  });
  const abandoning = session.abandon({
    revert: async (patch) => {
      order.push("revert");
      store.patch(itemRevertBody(patch, "session-S", () => "fresh"));
    },
  });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(order, [], "revert must wait for the in-flight save");
  network.resolve();
  await saving;
  await abandoning;
  assert.deepEqual(order, ["autosave", "revert"]);
  assert.deepEqual(store.row.body, doc("as opened"));
  assert.deepEqual(store.versions[1].snapshot.body, doc("in flight"));
});

test("a failed in-flight save still gets a revert (the server may hold it)", async () => {
  const session = createAbandonSession({ tags: ["ui"] });
  await session.save({ tags: ["ui", "x"] }, async () => {
    throw new Error("network");
  }).catch(() => {});
  const reverts: unknown[] = [];
  const outcome = await session.abandon({ revert: async (p) => void reverts.push(p) });
  assert.equal(outcome.kind, "reverted");
  assert.deepEqual(reverts, [{ tags: ["ui"] }]);
});

test("only the fields the editor changed are written back", async () => {
  const session = createAbandonSession({ body: doc("a"), tags: ["ui"], parent_id: null as string | null });
  await session.save({ tags: ["ui", "new"] }, async () => {});
  await session.save({ parent_id: "epic-1" }, async () => {});
  assert.deepEqual(session.revertPatch(), { tags: ["ui"], parent_id: null });
});

test("a failed revert reopens the session so autosave carries on", async () => {
  const session = createAbandonSession({ name: "A" });
  await session.save({ name: "B" }, async () => {});
  await assert.rejects(
    session.abandon({
      revert: async () => {
        throw new Error("refused");
      },
    }),
  );
  assert.equal(session.abandoning, false);
  let ran = false;
  await session.save({ name: "C" }, async () => {
    ran = true;
  });
  assert.equal(ran, true);
  assert.deepEqual(session.revertPatch(), { name: "A" });
});

test("the as-opened snapshot is a copy, unaffected by later mutation of the source", () => {
  const source = { name: "A" };
  const session = createAbandonSession(source);
  source.name = "B";
  assert.equal(session.opened.name, "A");
  assert.ok(jsonEqual("x", null, undefined));
});
