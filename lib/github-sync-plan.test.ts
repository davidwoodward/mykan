// Sync with GitHub planning (KANBAN-65). Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cardsToClose, planRepoChecks, syncMessage, type SyncCandidate } from "./github-sync-plan.ts";
import type { ItemStatus } from "./types.ts";

const card = (
  number: number,
  github_issue: string | null,
  opts: {
    status?: ItemStatus;
    archived?: boolean;
    imported?: string | null;
    sync?: "no_pat" | "failed" | null;
  } = {},
): SyncCandidate => ({
  id: `id-${number}`,
  number,
  status: opts.status ?? "in_progress",
  archived_at: opts.archived ? "2026-10-01T00:00:00Z" : null,
  github_issue,
  github_imported_at: opts.imported === undefined ? "2026-10-10T00:00:00Z" : opts.imported,
  github_sync: opts.sync ?? null,
});

test("only open, non-archived, linked cards are checked", () => {
  const checks = planRepoChecks([
    card(1, "acme/web#10"),
    card(2, "acme/web#11", { status: "done" }),
    card(3, "acme/web#12", { archived: true }),
    card(4, null),
    card(5, "not a backlink"),
  ]);
  assert.equal(checks.length, 1);
  assert.deepEqual([...checks[0].cards.keys()], [10]);
});

test("cards group by repo, case-insensitively", () => {
  const checks = planRepoChecks([
    card(1, "acme/web#1"),
    card(2, "Acme/Web#2"),
    card(3, "acme/api#1"),
  ]);
  assert.equal(checks.length, 2);
  const web = checks.find((c) => c.repo.toLowerCase() === "web")!;
  assert.equal(web.owner, "acme");
  assert.deepEqual([...web.cards.keys()].sort(), [1, 2]);
});

test("since is the earliest import time, or null when any card lacks one", () => {
  const [a] = planRepoChecks([
    card(1, "acme/web#1", { imported: "2026-10-12T00:00:00Z" }),
    card(2, "acme/web#2", { imported: "2026-10-05T00:00:00Z" }),
  ]);
  assert.equal(a.since, "2026-10-05T00:00:00Z");
  const [b] = planRepoChecks([
    card(1, "acme/web#1", { imported: "2026-10-12T00:00:00Z" }),
    card(2, "acme/web#2", { imported: null }),
  ]);
  assert.equal(b.since, null);
});

test("cardsToClose picks the cards whose issue closed, in ref order", () => {
  const [check] = planRepoChecks([
    card(7, "acme/web#3"),
    card(4, "acme/web#1"),
    card(5, "acme/web#2"),
  ]);
  const { close } = cardsToClose(check, [3, 1, 99]);
  assert.deepEqual(close.map((c) => c.number), [4, 7]);
});

test("nothing closed means nothing to move", () => {
  const [check] = planRepoChecks([card(1, "acme/web#1")]);
  assert.deepEqual(cardsToClose(check, []), { close: [], notSynced: [] });
});

test("a card flagged not synced is left alone, not moved", () => {
  const [check] = planRepoChecks([
    card(1, "acme/web#1", { sync: "no_pat" }),
    card(2, "acme/web#2"),
  ]);
  const { close, notSynced } = cardsToClose(check, [1, 2]);
  assert.deepEqual(close.map((c) => c.number), [2]);
  assert.deepEqual(notSynced.map((c) => c.number), [1]);
});

const empty = { account: "acme", imported: [], moved: [], not_synced: [], errors: [] };

test("syncMessage: nothing changed reads as up to date", () => {
  assert.deepEqual(syncMessage(empty), { text: "Up to date with GitHub.", tone: "ok" });
});

test("syncMessage lists moved and imported refs", () => {
  const m = syncMessage({
    ...empty,
    moved: [{ ref: "KANBAN-3", issue: "acme/web#1" }],
    imported: ["KANBAN-9", "KANBAN-10"],
  });
  assert.equal(m.text, "Moved 1 to Done: KANBAN-3 · Imported 2: KANBAN-9, KANBAN-10.");
  assert.equal(m.tone, "ok");
});

test("syncMessage shows repo errors and the Connect prompt", () => {
  const e = syncMessage({ ...empty, errors: [{ repo: "acme/gone", error: "No repo" }] });
  assert.equal(e.text, "acme/gone: No repo.");
  assert.equal(e.tone, "err");
  const dotted = syncMessage({ ...empty, errors: [{ repo: "acme/web", error: "GitHub error (500)." }] });
  assert.equal(dotted.text, "acme/web: GitHub error (500).");
  const c = syncMessage({ ...empty, needs_connect: { account: "acme", reason: "invalid" } });
  assert.equal(c.text, "Reconnect GitHub for acme (top bar) to sync.");
  assert.equal(c.tone, "warn");
});

test("syncMessage reports cards left alone because they're not synced", () => {
  const m = syncMessage({ ...empty, not_synced: [{ ref: "KANBAN-4", issue: "acme/web#4" }] });
  assert.equal(m.text, "Left KANBAN-4 where it is (not synced; issue closed on GitHub).");
});
