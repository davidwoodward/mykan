// Clean project/card URLs (KANBAN-44): key rules, ref parsing, the root
// route's redirect and not-found decisions, and Esc on the card page. Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESERVED_KEYS,
  SITE_URL,
  canonicalPath,
  cardEscAction,
  cardPath,
  cardUrl,
  keyError,
  keyMatchDecision,
  legacyProjectRedirect,
  lookupDecision,
  normalizeKeyInput,
  parseRootSegment,
  projectUrl,
  routeDecision,
  withQuery,
} from "./card-url.ts";

test("keyError: every existing project key is valid", () => {
  for (const k of ["KANBAN", "BRAIN", "ASSET", "FPOON", "FIN", "AMOS", "PERP", "PS", "HELM", "PUR", "GANDY", "DUG", "STD"]) {
    assert.equal(keyError(k), null, k);
  }
});

test("keyError: required, length, format", () => {
  assert.match(keyError("")!, /required/);
  assert.match(keyError("A")!, /2 to 10/);
  assert.match(keyError("ABCDEFGHIJK")!, /2 to 10/);
  assert.equal(keyError("ABCDEFGHIJ"), null);
  assert.match(keyError("1ABC")!, /starting with a letter/);
  assert.match(keyError("AB-C")!, /letters and digits/);
  assert.match(keyError("AB C")!, /letters and digits/);
  assert.match(keyError("fpoon")!, /uppercase/);
  assert.equal(keyError("A1"), null);
  assert.equal(keyError("V2API"), null);
});

test("keyError: reserved words are refused, including every top-level app route", () => {
  for (const k of ["API", "MCP", "PROJECTS", "SIGNIN", "ICON", "SETTINGS", "LOGIN", "AUTH"]) {
    assert.ok(RESERVED_KEYS.includes(k), k);
    assert.match(keyError(k)!, /reserved/, k);
  }
  // Reserved words are whole-key only.
  assert.equal(keyError("APIX"), null);
});

test("normalizeKeyInput trims and uppercases; non-strings are empty", () => {
  assert.equal(normalizeKeyInput("  fpoon "), "FPOON");
  assert.equal(normalizeKeyInput(null), "");
  assert.equal(normalizeKeyInput(42), "");
});

test("parseRootSegment: projects and cards, case-insensitive", () => {
  assert.deepEqual(parseRootSegment("FPOON"), { kind: "project", key: "FPOON" });
  assert.deepEqual(parseRootSegment("fpoon"), { kind: "project", key: "FPOON" });
  assert.deepEqual(parseRootSegment("FPOON-42"), { kind: "card", key: "FPOON", number: 42 });
  assert.deepEqual(parseRootSegment("kanban-42"), { kind: "card", key: "KANBAN", number: 42 });
  assert.deepEqual(parseRootSegment("Brain-8"), { kind: "card", key: "BRAIN", number: 8 });
});

test("parseRootSegment: edge cases", () => {
  assert.equal(parseRootSegment("KEY-0"), null, "numbers start at 1");
  assert.deepEqual(parseRootSegment("KEY-007"), { kind: "card", key: "KEY", number: 7 });
  assert.equal(parseRootSegment("KEY-"), null);
  assert.equal(parseRootSegment("-7"), null);
  assert.equal(parseRootSegment("KEY-1-2"), null);
  assert.equal(parseRootSegment("KEY--2"), null);
  assert.equal(parseRootSegment("KEY-1.5"), null);
  assert.equal(parseRootSegment("KEY-1234567890"), null, "too large to be real");
  assert.equal(parseRootSegment("K-1"), null, "one-letter key");
  assert.equal(parseRootSegment("API-3"), null, "reserved key");
  assert.equal(parseRootSegment("api"), null);
  assert.equal(parseRootSegment("835cba63-8e3f-4c86-98c8-ca0ca4a2c1b6"), null, "a GUID");
  assert.equal(parseRootSegment("%E0%A4%A"), null, "bad encoding");
  assert.equal(parseRootSegment(""), null);
});

test("routeDecision: canonical forms look up; others redirect or 404", () => {
  assert.deepEqual(routeDecision("FPOON"), {
    action: "lookup",
    segment: { kind: "project", key: "FPOON" },
  });
  assert.deepEqual(routeDecision("FPOON-42"), {
    action: "lookup",
    segment: { kind: "card", key: "FPOON", number: 42 },
  });
  assert.deepEqual(routeDecision("fpoon"), { action: "redirect", to: "/FPOON" });
  assert.deepEqual(routeDecision("Fpoon-42"), { action: "redirect", to: "/FPOON-42" });
  assert.deepEqual(routeDecision("FPOON-007"), { action: "redirect", to: "/FPOON-7" });
  assert.deepEqual(routeDecision("fpoon-007"), { action: "redirect", to: "/FPOON-7" });
  assert.deepEqual(routeDecision("FPOON-0"), { action: "notFound" });
  assert.deepEqual(routeDecision("settings"), { action: "notFound" });
  assert.deepEqual(routeDecision("nope!"), { action: "notFound" });
  // An unknown but well-formed key is a lookup (the DB decides, then 404).
  assert.deepEqual(routeDecision("ZZZZ-1"), {
    action: "lookup",
    segment: { kind: "card", key: "ZZZZ", number: 1 },
  });
});

test("lookupDecision: every miss is the same not-found", () => {
  assert.equal(lookupDecision({ projectVisible: true, wantsCard: false, cardFound: false }), "render");
  assert.equal(lookupDecision({ projectVisible: true, wantsCard: true, cardFound: true }), "render");
  assert.equal(lookupDecision({ projectVisible: true, wantsCard: true, cardFound: false }), "notFound");
  // A private project's card is not found, whether or not the card exists.
  assert.equal(lookupDecision({ projectVisible: false, wantsCard: true, cardFound: true }), "notFound");
  assert.equal(lookupDecision({ projectVisible: false, wantsCard: true, cardFound: false }), "notFound");
  assert.equal(lookupDecision({ projectVisible: false, wantsCard: false, cardFound: false }), "notFound");
});

test("legacy /projects/<id> redirects to the key, else not found", () => {
  assert.equal(legacyProjectRedirect({ key: "FPOON" }), "/FPOON");
  assert.equal(legacyProjectRedirect({ key: null }), null);
  assert.equal(legacyProjectRedirect(null), null);
});

test("paths and full URLs", () => {
  assert.equal(cardPath("FPOON", 42), "/FPOON-42");
  assert.equal(canonicalPath({ kind: "project", key: "STD" }), "/STD");
  assert.equal(cardUrl("KANBAN", 42), `${SITE_URL}/KANBAN-42`);
  assert.equal(SITE_URL.startsWith("https://"), true);
  assert.equal(cardUrl("KANBAN", 42, "http://localhost:3005/"), "http://localhost:3005/KANBAN-42");
  assert.equal(projectUrl("BRAIN"), `${SITE_URL}/BRAIN`);
});

test("cardEscAction: Esc in the description saves and leaves in one press (KANBAN-46)", () => {
  const base = { handled: false, saving: false, restorePrompt: false, field: null } as const;
  // The description: ProseMirror marks EVERY Esc handled (preventDefault), so
  // `handled` means nothing there. This was the KANBAN-46 bug: it read as
  // "a picker handled it" and Esc did nothing.
  assert.equal(cardEscAction({ ...base, field: "description", handled: true }), "leave");
  assert.equal(cardEscAction({ ...base, field: "description" }), "leave");
  // Nothing being edited: leave (saving anything still unsaved first).
  assert.equal(cardEscAction(base), "leave");
});

test("cardEscAction: handled, saving, the restore prompt and other fields", () => {
  const base = { handled: false, saving: false, restorePrompt: false, field: null } as const;
  // Any other text field (the tag input, a field that doesn't own Esc):
  // finish that edit and stay, as before.
  assert.equal(cardEscAction({ ...base, field: "other" }), "finishField");
  // Handled inside (an entry editor, a picker, a confirm): nothing more,
  // including in the tag input.
  assert.equal(cardEscAction({ ...base, handled: true, field: "other" }), "ignore");
  assert.equal(cardEscAction({ ...base, handled: true }), "ignore");
  // A save in flight: never a second save or a second navigation.
  assert.equal(cardEscAction({ ...base, saving: true }), "ignore");
  assert.equal(cardEscAction({ ...base, saving: true, field: "description", handled: true }), "ignore");
  // The restore prompt: Esc is Discard; a picker that handled its own Esc wins.
  assert.equal(cardEscAction({ ...base, restorePrompt: true, field: "other" }), "discardRestore");
  assert.equal(cardEscAction({ ...base, handled: true, restorePrompt: true }), "ignore");
});

test("keyMatchDecision: current key resolves; an old key redirects; misses 404 (KANBAN-45)", () => {
  const board = { kind: "project", key: "FPOON" } as const;
  const card = { kind: "card", key: "FPOON", number: 42 } as const;
  // Current key of a visible project: go on to the normal lookup.
  assert.deepEqual(keyMatchDecision(card, { via: "key", currentKey: "FPOON", visible: true }), {
    action: "resolve",
  });
  // Old key of a visible project: the same board or card under the current key.
  assert.deepEqual(keyMatchDecision(board, { via: "alias", currentKey: "FP", visible: true }), {
    action: "redirect",
    to: "/FP",
  });
  assert.deepEqual(keyMatchDecision(card, { via: "alias", currentKey: "FP", visible: true }), {
    action: "redirect",
    to: "/FP-42",
  });
  // Unknown key.
  assert.deepEqual(keyMatchDecision(card, null), { action: "notFound" });
  // A project the viewer can't see: the same 404, by its key or an old key.
  assert.deepEqual(keyMatchDecision(card, { via: "alias", currentKey: "FP", visible: false }), {
    action: "notFound",
  });
  assert.deepEqual(keyMatchDecision(board, { via: "key", currentKey: "FPOON", visible: false }), {
    action: "notFound",
  });
});

test("withQuery keeps the query, repeated values included", () => {
  assert.equal(withQuery("/FP", {}), "/FP");
  assert.equal(
    withQuery("/FP", { view: "board", tag: ["a", "b"], x: undefined }),
    "/FP?view=board&tag=a&tag=b",
  );
});
