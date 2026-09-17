// Clean URLs for projects and cards (KANBAN-44, David 2026-09-16).
//
//   /FPOON      a project's board   (the project key at the root)
//   /FPOON-42   a card's page       (the card ref at the root)
//
// Pure: no React, no database, so every rule here runs under `node --test` and
// can be imported by server pages, API routes, the MCP server and client
// components alike. The database mirrors the key rules (a CHECK constraint in
// supabase/migrations/2026-09-16-4-project-keys.sql); keep the two in step.
//
// Keys can be renamed (KANBAN-45); a project's old keys are kept as aliases, so
// /OLD and /OLD-N redirect to /NEW and /NEW-N (keyMatchDecision below).

/** The one site origin. The app already fixed this host for its MCP endpoint. */
export const SITE_URL = "https://kanban.dbwoodward.com";

/**
 * A project key: 2 to 10 characters, uppercase letters and digits, starting
 * with a letter. Existing keys (KANBAN, BRAIN, FPOON, FIN, PS, ...) all fit.
 * Mirrored by the projects_key_format CHECK in the database.
 */
export const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
export const KEY_MIN = 2;
export const KEY_MAX = 10;

/**
 * Words a key can never be, because /<key> must never shadow (or be shadowed
 * by) a real top-level route. The first group is every top-level entry under
 * app/ today (api, mcp, projects, signin, icon; apple-icon has a hyphen so the
 * format already rules it out) plus the auth routes Auth.js serves under /api.
 * The second group is routes the app is likely to grow, reserved now so a
 * future route never collides with a key (or an old key, which keeps
 * redirecting). Mirrored by projects_key_not_reserved.
 */
export const RESERVED_KEYS: readonly string[] = [
  // Routes that exist today.
  "API",
  "MCP",
  "PROJECTS",
  "SIGNIN",
  "ICON",
  // Likely future routes and well-known paths.
  "AUTH",
  "LOGIN",
  "LOGOUT",
  "SIGNOUT",
  "SETTINGS",
  "ADMIN",
  "NEW",
  "HOME",
  "STATIC",
  "PUBLIC",
  "FAVICON",
  "ROBOTS",
  "SITEMAP",
];

/** What a key input normalises to before validation: trimmed, uppercased. */
export function normalizeKeyInput(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toUpperCase() : "";
}

/**
 * Why `key` can't be a project key, or null when it can. Expects the
 * normalised (uppercase) form; a lowercase key is reported as a format error so
 * callers can't forget to normalise.
 */
export function keyError(key: string): string | null {
  if (!key) return "A project key is required (e.g. FPOON)";
  if (key.length < KEY_MIN || key.length > KEY_MAX) {
    return `A project key is ${KEY_MIN} to ${KEY_MAX} characters`;
  }
  if (!KEY_RE.test(key)) {
    return "A project key is uppercase letters and digits, starting with a letter";
  }
  if (RESERVED_KEYS.includes(key)) {
    return `${key} is reserved for the app's own pages; choose another key`;
  }
  return null;
}

/** Project board path: /FPOON. */
export function projectPath(key: string): string {
  return `/${key}`;
}

/** Card page path: /FPOON-42. */
export function cardPath(key: string, number: number): string {
  return `/${key}-${number}`;
}

/** Full https URL of a card, e.g. https://kanban.dbwoodward.com/FPOON-42. */
export function cardUrl(key: string, number: number, base: string = SITE_URL): string {
  return `${base.replace(/\/+$/, "")}${cardPath(key, number)}`;
}

/** Full https URL of a project board. */
export function projectUrl(key: string, base: string = SITE_URL): string {
  return `${base.replace(/\/+$/, "")}${projectPath(key)}`;
}

/** A root segment, parsed. */
export type RootSegment =
  | { kind: "project"; key: string }
  | { kind: "card"; key: string; number: number };

/**
 * Parse one root URL segment as a project key or a card ref, case-insensitively.
 * Returns null for anything that can't name a project or card: a bad format, a
 * reserved word, a number of 0, or a number too large to be real.
 *
 * Leading zeros are accepted (KEY-007 names KEY-7); the route redirects them to
 * the canonical form along with lower/mixed case.
 */
export function parseRootSegment(segment: string): RootSegment | null {
  let raw = segment;
  try {
    raw = decodeURIComponent(segment);
  } catch {
    return null;
  }
  const m = /^([A-Za-z][A-Za-z0-9]*)(?:-(\d+))?$/.exec(raw);
  if (!m) return null;
  const key = m[1].toUpperCase();
  if (keyError(key)) return null;
  if (m[2] === undefined) return { kind: "project", key };
  // Item numbers start at 1 (the DB trigger), and stay well inside int4.
  if (m[2].length > 9) return null;
  const number = Number(m[2]);
  if (!Number.isInteger(number) || number < 1) return null;
  return { kind: "card", key, number };
}

/** The canonical path for a parsed segment. */
export function canonicalPath(seg: RootSegment): string {
  return seg.kind === "project" ? projectPath(seg.key) : cardPath(seg.key, seg.number);
}

/**
 * What the root route does with a segment BEFORE touching the database:
 * - notFound: can't name anything (bad format, reserved, KEY-0).
 * - redirect: names something, but not in canonical form (/fpoon, /Fpoon-007):
 *   send it to /FPOON or /FPOON-7. Purely syntactic, so it reveals nothing
 *   about whether the project exists or is visible.
 * - lookup: canonical; resolve it (and 404 if missing or not visible).
 */
export type RouteDecision =
  | { action: "notFound" }
  | { action: "redirect"; to: string }
  | { action: "lookup"; segment: RootSegment };

export function routeDecision(segment: string): RouteDecision {
  const parsed = parseRootSegment(segment);
  if (!parsed) return { action: "notFound" };
  const canonical = canonicalPath(parsed);
  let raw = segment;
  try {
    raw = decodeURIComponent(segment);
  } catch {
    return { action: "notFound" };
  }
  if (`/${raw}` !== canonical) return { action: "redirect", to: canonical };
  return { action: "lookup", segment: parsed };
}

/**
 * After the lookup: render only when the project exists AND the viewer can see
 * it AND (for a card) the card exists in it. Every other case is the same
 * not-found, so a private project's cards are indistinguishable from cards that
 * don't exist.
 */
export function lookupDecision(input: {
  projectVisible: boolean;
  wantsCard: boolean;
  cardFound: boolean;
}): "render" | "notFound" {
  if (!input.projectVisible) return "notFound";
  if (input.wantsCard && !input.cardFound) return "notFound";
  return "render";
}

/**
 * How a canonical key matched a project, for the viewer: by its current key or
 * by one of its old keys (an alias, KANBAN-45), and whether the viewer can see
 * that project. null when the key names nothing.
 */
export type KeyMatch = {
  via: "key" | "alias";
  /** The project's current key. */
  currentKey: string;
  visible: boolean;
} | null;

/**
 * What the root route does once it knows what the key matched:
 * - resolve:  the current key of a visible project; go on to lookupDecision.
 * - redirect: an old key of a visible project; permanently to the same board or
 *             card under the current key (/OLD-7 -> /NEW-7). The card itself is
 *             not checked first: /NEW-7 404s on its own if there is no card 7,
 *             and the viewer can already see the project.
 * - notFound: unknown, or a project the viewer can't see. An old key of a
 *             hidden project is the same 404 as a key that never existed, so it
 *             reveals nothing (visibility is checked before any redirect).
 */
export type KeyMatchDecision =
  | { action: "resolve" }
  | { action: "redirect"; to: string }
  | { action: "notFound" };

export function keyMatchDecision(segment: RootSegment, match: KeyMatch): KeyMatchDecision {
  if (!match || !match.visible) return { action: "notFound" };
  if (match.via === "key") return { action: "resolve" };
  return { action: "redirect", to: canonicalPath({ ...segment, key: match.currentKey }) };
}

/** `path` with the query kept, e.g. withQuery("/FP", {view: "board"}) = "/FP?view=board". */
export function withQuery(
  path: string,
  query: Record<string, string | string[] | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) qs.append(k, one);
  }
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * Old /projects/<id> URLs: redirect permanently to /KEY when the viewer can see
 * a project with that id and it has a key, else not found.
 */
export function legacyProjectRedirect(project: { key: string | null } | null): string | null {
  if (!project?.key) return null;
  return projectPath(project.key);
}

// ---------------------------------------------------------------------------
// Esc on the card page
// ---------------------------------------------------------------------------

/**
 * What Esc does on a card page, in precedence order:
 * 1. ignore:          a save is in flight (never a second save or a second
 *                     navigation), or something inside already handled the
 *                     key (an entry editor finishing its own edit, a picker
 *                     closing, a confirmation).
 * 2. discardRestore:  the "unsaved changes from earlier" prompt is showing;
 *                     Esc answers it with Discard (as in the modal before).
 * 3. leave:           focus is in the description (KANBAN-46, David
 *                     2026-09-17): save once if anything changed, then return
 *                     to the board, in ONE press. A failed save stays on the
 *                     page with the error and the draft.
 * 4. finishField:     another text field is being edited (the tag input, any
 *                     text field that doesn't own Esc): finish that edit,
 *                     saving once if anything changed, and stay.
 * 5. leave:           nothing is being edited: save if anything is still
 *                     unsaved, then return to the board.
 *
 * `handled` means nothing in the description: ProseMirror calls
 * preventDefault on EVERY Esc inside its editor (prosemirror-view's
 * captureKeyDown), so reading it as "handled inside" swallowed Esc there
 * entirely (the KANBAN-46 bug, from KANBAN-44).
 */
export type CardEscAction = "ignore" | "discardRestore" | "finishField" | "leave";

/** Where focus is when Esc is pressed on a card page. */
export type CardEscField = "description" | "other" | null;

export function cardEscAction(state: {
  handled: boolean;
  saving: boolean;
  restorePrompt: boolean;
  field: CardEscField;
}): CardEscAction {
  if (state.saving) return "ignore";
  const handled = state.handled && state.field !== "description";
  if (handled) return "ignore";
  if (state.restorePrompt) return "discardRestore";
  if (state.field === "description") return "leave";
  if (state.field === "other") return "finishField";
  return "leave";
}
