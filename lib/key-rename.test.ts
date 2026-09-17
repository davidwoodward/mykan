// Project key renames (KANBAN-45): write validation messages, the warning
// shown before a rename, and where the browser goes afterwards. Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { keyRenameWarning, keyWriteError, pathAfterRename } from "./key-rename.ts";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

test("keyWriteError: format and reserved rules still apply to a rename", () => {
  const base = { projectId: A, keyOwnerId: null, aliasOwnerId: null };
  assert.deepEqual(keyWriteError({ ...base, next: "" }), {
    error: "A project key is required (e.g. FPOON)",
    status: 400,
  });
  assert.match(keyWriteError({ ...base, next: "F" })!.error, /2 to 10/);
  assert.match(keyWriteError({ ...base, next: "1FP" })!.error, /starting with a letter/);
  assert.match(keyWriteError({ ...base, next: "SETTINGS" })!.error, /reserved/);
  assert.equal(keyWriteError({ ...base, next: "FP" }), null);
});

test("keyWriteError: another project's current key is refused", () => {
  assert.deepEqual(keyWriteError({ next: "FP", projectId: A, keyOwnerId: B, aliasOwnerId: null }), {
    error: "The key FP is already used by another project",
    status: 409,
  });
  // A new project (no id yet) too.
  assert.equal(
    keyWriteError({ next: "FP", projectId: null, keyOwnerId: B, aliasOwnerId: null })?.status,
    409,
  );
});

test("keyWriteError: another project's old key is refused, with the reason", () => {
  const e = keyWriteError({ next: "FPOON", projectId: A, keyOwnerId: null, aliasOwnerId: B });
  assert.equal(e?.status, 409);
  assert.equal(
    e?.error,
    "The key FPOON is an old key of another project, and old links to it still go there. Choose another key.",
  );
  assert.equal(
    keyWriteError({ next: "FPOON", projectId: null, keyOwnerId: null, aliasOwnerId: B })?.status,
    409,
    "a new project can't take it either",
  );
});

test("keyWriteError: the project's own key and own old keys are fine", () => {
  assert.equal(keyWriteError({ next: "FP", projectId: A, keyOwnerId: A, aliasOwnerId: null }), null);
  assert.equal(keyWriteError({ next: "FPOON", projectId: A, keyOwnerId: null, aliasOwnerId: A }), null);
});

test("keyRenameWarning: says what changes and what keeps working", () => {
  const w = keyRenameWarning({ from: "FPOON", to: "FP", sample: 42 });
  assert.equal(w.title, "Rename key FPOON to FP?");
  assert.equal(
    w.lines[0],
    "Every card ref becomes FP-N (FPOON-42 becomes FP-42) and the board moves to /FP.",
  );
  assert.match(w.lines[1], /^Old links and refs keep working: \/FPOON and FPOON-42 lead to \/FP and FP-42/);
  assert.match(w.lines[1], /over MCP/);
  assert.equal(w.lines.some((l) => /becomes the current key again/.test(l)), false);
});

test("keyRenameWarning: renaming back to an own old key says so; sample defaults", () => {
  const w = keyRenameWarning({ from: "FP", to: "FPOON", ownOldKey: true });
  assert.match(w.lines[0], /FP-12 becomes FPOON-12/);
  assert.equal(w.lines.at(-1), "FPOON was this project's key before; it becomes the current key again.");
  assert.match(keyRenameWarning({ from: "A1", to: "B2", sample: 0 }).lines[0], /A1-12/);
});

test("pathAfterRename: the board and its cards follow the key", () => {
  assert.equal(pathAfterRename("/FPOON", "FPOON", "FP"), "/FP");
  assert.equal(pathAfterRename("/FPOON-42", "FPOON", "FP"), "/FP-42");
  assert.equal(pathAfterRename("/FPOONX-42", "FPOON", "FP"), null);
  assert.equal(pathAfterRename("/KANBAN-3", "FPOON", "FP"), null);
  assert.equal(pathAfterRename("/projects", "FPOON", "FP"), null);
});
