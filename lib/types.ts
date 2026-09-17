export type ItemType = "feature" | "bug" | "task" | "idea" | "epic";
export type ItemStatus = "new" | "in_progress" | "blocked" | "testing" | "done";

/**
 * How many body lines a card/row shows before the Show more/less toggle, by
 * status. Roomier for active work (incl. Testing, where you read to verify);
 * tighter for Blocked/Done which pile up.
 */
export const CLAMP_LINES: Record<ItemStatus, number> = {
  new: 10,
  in_progress: 10,
  blocked: 5,
  testing: 10,
  done: 5,
};

/**
 * A Tiptap/ProseMirror document. We only ever read it back into the editor or
 * render it read-only, so the loose shape is enough — the editor owns the schema.
 */
export interface RichDoc {
  type: "doc";
  content?: unknown[];
}

export function isRichDoc(v: unknown): v is RichDoc {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { type?: unknown }).type === "doc"
  );
}

/** True when a body holds real content (not an empty doc / empty paragraph). */
export function richDocHasContent(body: RichDoc | null | undefined): boolean {
  if (!body || !Array.isArray(body.content) || body.content.length === 0) {
    return false;
  }
  // An "empty" editor serialises to a single empty paragraph node.
  if (body.content.length === 1) {
    const only = body.content[0] as { type?: string; content?: unknown[] };
    if (only.type === "paragraph" && !only.content?.length) return false;
  }
  return true;
}

// Block-level node types whose siblings should be separated by a newline when
// flattening to text. Inline nodes (text, hardBreak) are not block-level.
const BLOCK_NODE_TYPES = new Set([
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "codeBlock",
  "horizontalRule",
]);

type FlatNode = { type?: string; text?: string; content?: unknown[] };

/** Flattens one node to text: block siblings → "\n", hard breaks → "\n". */
function flattenNode(node: FlatNode): string {
  if (node.type === "text") return typeof node.text === "string" ? node.text : "";
  if (node.type === "hardBreak") return "\n";
  if (!Array.isArray(node.content)) return "";
  const kids = node.content as FlatNode[];
  let out = "";
  for (let i = 0; i < kids.length; i++) {
    // Separate consecutive block-level siblings with a newline; inline runs
    // (text, marks, hard breaks) stay on the same line.
    if (
      i > 0 &&
      (BLOCK_NODE_TYPES.has(kids[i - 1].type ?? "") ||
        BLOCK_NODE_TYPES.has(kids[i].type ?? ""))
    ) {
      out += "\n";
    }
    out += flattenNode(kids[i]);
  }
  return out;
}

/**
 * Flattens the plain text out of a rich-text body, preserving the line
 * structure: block siblings (paragraphs, list items, code lines, headings) are
 * joined by newlines and hard line breaks become newlines, so the label shown
 * for an item keeps the line feeds and indentation the user typed. Images and
 * other non-text nodes contribute nothing.
 */
export function richDocText(body: RichDoc | null | undefined): string {
  if (!body || !Array.isArray(body.content)) return "";
  // Trim only outer blank lines/space — interior newlines and indentation stay.
  return flattenNode(body as FlatNode).replace(/^\s+|\s+$/g, "");
}

/**
 * The body split into its **top-level blocks** (paragraphs, headings, a whole
 * list, a code block…), each flattened like `richDocText`, so list rows and
 * board cards can put a small gap between paragraphs (KANBAN-15). Hard breaks
 * stay "\n" inside their block and a list stays one block (its items on
 * consecutive lines), so only real paragraph boundaries get spaced. A blank
 * paragraph is kept as an empty block, so blank lines typed to separate
 * sections still show. Joining the result with "\n" gives exactly
 * `richDocText(body)` (same outer trim, same blank lines).
 */
export function richDocBlocks(body: RichDoc | null | undefined): string[] {
  if (!body || !Array.isArray(body.content)) return [];
  const nodes = body.content as FlatNode[];
  const out: string[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const text = flattenNode(nodes[i]);
    // Mirror flattenNode's separator rule: two adjacent non-block nodes (e.g.
    // stray top-level images) share a line, so they share a block.
    if (
      i > 0 &&
      !BLOCK_NODE_TYPES.has(nodes[i - 1].type ?? "") &&
      !BLOCK_NODE_TYPES.has(nodes[i].type ?? "")
    ) {
      out[out.length - 1] += text;
    } else {
      out.push(text);
    }
  }
  // Same outer trim as richDocText: drop leading/trailing blank blocks, then
  // the outer whitespace of the first and last blocks.
  while (out.length > 0 && out[0].trim() === "") out.shift();
  while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
  if (out.length > 0) {
    out[0] = out[0].replace(/^\s+/, "");
    out[out.length - 1] = out[out.length - 1].replace(/\s+$/, "");
  }
  return out;
}

/** Longest title `richDocTitle` returns, ellipsis included. */
export const TITLE_MAX_CHARS = 200;

/**
 * An item's title: the first non-empty line of its flattened body, trimmed.
 * Items have no stored title column, so this is the one derived title used by
 * the MCP/Telegram list and detail shapes. An empty (or image-only) body gives
 * "". A first line longer than TITLE_MAX_CHARS is cut back to the last whole
 * word and ends with "…" (hard-cut only when there is no space to break at).
 */
export function richDocTitle(body: RichDoc | null | undefined): string {
  const line =
    richDocText(body)
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  if (line.length <= TITLE_MAX_CHARS) return line;
  const room = line.slice(0, TITLE_MAX_CHARS - 1);
  const space = room.lastIndexOf(" ");
  const cut = space > 0 ? room.slice(0, space) : room;
  return `${cut.trimEnd()}…`;
}

/**
 * Collects the `src` of every image node in a rich-text body, in document
 * order. These are the inline screenshots pasted into an item; `richDocText`
 * drops them, so this is the only way to recover them from a body. Duplicates
 * are preserved (the same image can legitimately appear twice).
 */
export function richDocImageSrcs(body: RichDoc | null | undefined): string[] {
  if (!body || !Array.isArray(body.content)) return [];
  const out: string[] = [];
  const walk = (node: { type?: string; attrs?: unknown; content?: unknown[] }) => {
    if (node.type === "image") {
      const src = (node.attrs as { src?: unknown } | undefined)?.src;
      if (typeof src === "string" && src) out.push(src);
    }
    if (Array.isArray(node.content)) {
      for (const kid of node.content) {
        walk(kid as { type?: string; attrs?: unknown; content?: unknown[] });
      }
    }
  };
  walk(body as { content?: unknown[] });
  return out;
}

/** Builds a minimal document holding a single paragraph of text (empty → empty doc). */
export function paragraphDoc(text: string): RichDoc {
  const t = text.trim();
  return {
    type: "doc",
    content: t
      ? [{ type: "paragraph", content: [{ type: "text", text: t }] }]
      : [],
  };
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  /** Short uppercase key prefixing item references, e.g. "AMOS" → AMOS-12. */
  key: string | null;
  /**
   * True when the project is shared with no one — visible only to its creator.
   * Mirrors `shared_with` being empty; kept for the "Private" label and lock.
   */
  is_private: boolean;
  /**
   * Member emails this project is shared with, beyond the owner. The owner
   * always sees it; these members also see it. Empty = private (owner only).
   */
  shared_with: string[];
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  /**
   * Computed server-side in `listProjects`: the most recent `items.updated_at`
   * across the project's items (falls back to the project's own timestamp when
   * it has none). Drives the activity ordering and the "last touched" label.
   * Not a stored column.
   */
  last_activity?: string | null;
  /** The GitHub account this project pulls from (github_accounts.id), if bound. */
  github_account_id: string | null;
  /**
   * Computed in `listProjects`: the bound GitHub account's login (from
   * github_accounts), or null. Not a stored column.
   */
  github_account?: string | null;
  /**
   * The project's old keys (KANBAN-45), which still redirect here. Returned by
   * PATCH /api/projects/[id]; not a stored column (project_key_aliases).
   */
  key_aliases?: string[];
}

/** A node in a project's Area tree. Items reference one by id. */
export interface Category {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  position: number;
  /**
   * GitHub repo bound to this Area — just the repo NAME; the owner is implied by
   * the project's single bound account (project.github_account_id). The
   * import-routing target: issues from this repo land as items under this Area.
   * Import composes the full ref as `<account.login>/<github_repo>`. Null unbound.
   */
  github_repo: string | null;
}

/** Max nesting depth for the category tree (root = depth 1). */
export const MAX_CATEGORY_DEPTH = 5;

export interface Attachment {
  id: string;
  name: string;
  content_type: string;
  size: number;
  path: string;
}

/**
 * A GitHub account/org, registered once and shared system-wide (KANBAN-19/20).
 * Identified by its canonical `login`, captured from GitHub on connect.
 */
export interface GithubAccount {
  id: string;
  login: string;
  created_at: string;
  created_by: string | null;
}

export type GithubCredentialStatus = "active" | "invalid";

/**
 * Write-back sync state for an item's linked GitHub issue (`items.github_sync`).
 * `null` = in sync (nothing owed, or the last write-back succeeded); `'no_pat'` =
 * the acting user has no usable PAT for the account so the write was skipped;
 * `'failed'` = GitHub rejected/was unreachable — retry-able. A status change is
 * never blocked or rolled back when this is set. See docs/github-integration.md.
 */
export type GithubSync = "no_pat" | "failed" | null;

/**
 * One user's PAT for one account — a server-only row. `encrypted_pat` holds
 * AES-256-GCM ciphertext (see lib/github-crypto.ts) and MUST never be sent to the
 * client. Use {@link GithubConnection} for anything the browser sees.
 */
export interface GithubCredential {
  id: string;
  account_id: string;
  user_email: string;
  encrypted_pat: string;
  status: GithubCredentialStatus;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Client-safe view of the current user's connection to an account. Deliberately
 * omits `encrypted_pat` — the PAT is write-only and never leaves the server.
 */
export interface GithubConnection {
  /** The GitHub account id (github_accounts.id). */
  id: string;
  login: string;
  status: GithubCredentialStatus;
  expires_at: string | null;
}

/**
 * A per-user MCP token row (KANBAN-30) — server-only. `token_hash` is the
 * SHA-256 of the plaintext `mk_…` value; the plaintext is never stored and is
 * shown to the user exactly once at creation. See lib/mcp-tokens.ts.
 */
export interface McpToken {
  id: string;
  user_email: string;
  token_hash: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

/**
 * Client-safe view of one of the current user's MCP tokens. Deliberately omits
 * `token_hash` — nothing token-secret ever reaches the browser after the
 * one-time reveal at creation.
 */
export interface McpTokenSummary {
  id: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

/** Parse an `owner/repo#number` backlink into its parts, or null if malformed. */
export function parseGithubIssue(
  backlink: string | null | undefined,
): { owner: string; repo: string; number: number } | null {
  const m = /^([^/\s]+)\/([^#\s]+)#(\d+)$/.exec((backlink ?? "").trim());
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

/** The github.com issue URL for a backlink, or null if it can't be parsed. */
export function githubIssueUrl(backlink: string | null | undefined): string | null {
  const p = parseGithubIssue(backlink);
  return p ? `https://github.com/${p.owner}/${p.repo}/issues/${p.number}` : null;
}

export interface Item {
  id: string;
  project_id: string;
  /** Immutable, per-project reference number. Displayed as {project.key}-{number}. */
  number: number;
  type: ItemType;
  status: ItemStatus;
  position: number;
  /**
   * The item's content. This is the sole source of truth; any plain-text
   * "name"/title shown in the UI or API is derived from `body` via
   * `richDocText` on read. (The legacy `name` column was renamed to
   * `bubbba_was_here` as a one-time backup and is no longer read or written.)
   */
  body: RichDoc | null;
  tags: string[];
  /** Member emails assigned to this item (shared projects only). */
  assignees: string[];
  /** The category (Area) node this item is filed under, if any. */
  category_id: string | null;
  /**
   * The epic this item belongs to (KANBAN-41), or null. The link is stored only
   * here, on the child; an epic's children are derived (items whose parent_id is
   * the epic). See parentLinkError for the rules.
   */
  parent_id: string | null;
  attachments: Attachment[];
  archived_at: string | null;
  /**
   * Backlink to the source GitHub issue, as `owner/repo#number`, for items
   * created by import (null otherwise). The dedupe key for re-import and the
   * target for Done→close / un-done→reopen write-back. See
   * docs/github-integration.md §Import.
   */
  github_issue: string | null;
  /**
   * The linked GitHub issue's own creation time (ISO), captured at import and on
   * refresh — shown on the item so it's clear when the upstream issue was opened.
   */
  github_issue_created_at: string | null;
  /** When this item was pulled into mykan from GitHub (import time), or null. */
  github_imported_at: string | null;
  /** Write-back sync state for the linked issue; see {@link GithubSync}. */
  github_sync: GithubSync;
  /**
   * Open (unanswered, not deleted) questions on this item (KANBAN-38). Derived
   * by GET /api/projects/[id]/items only, absent when 0, never written; item
   * PATCH responses don't carry it, so the board keeps the counts apart.
   */
  open_questions?: number;
  /**
   * When the item most recently entered the Done column (null otherwise).
   * Drives the Done ordering on the list and board; cleared when it leaves Done.
   */
  done_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

/** True when a browser can render this content type inline (native viewer). */
export function isViewable(contentType: string): boolean {
  const t = contentType.toLowerCase();
  return (
    t.startsWith("image/") ||
    t.startsWith("text/") ||
    t.startsWith("video/") ||
    t.startsWith("audio/") ||
    t === "application/pdf" ||
    t === "application/json"
  );
}

/** Human-readable byte size, e.g. "3.4 MB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const n = bytes / 1024 ** i;
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** Normalises tag input: lowercase, trimmed, deduped, capped. */
export function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const v = raw.trim().toLowerCase().replace(/\s+/g, " ");
    if (!v || v.length > 32) continue;
    if (!out.includes(v)) out.push(v);
    if (out.length >= 20) break;
  }
  return out;
}

/**
 * Normalises an assignee list against the set of `allowed` member emails:
 * trimmed, lowercased, deduped, and filtered to known members. Pure — callers
 * pass `allowed` (e.g. `whitelist()`) so this stays usable from client code.
 */
export function normalizeAssignees(input: unknown, allowed: string[]): string[] {
  if (!Array.isArray(input)) return [];
  const ok = new Set(allowed.map((e) => e.trim().toLowerCase()));
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const v = raw.trim().toLowerCase();
    if (!v || !ok.has(v) || out.includes(v)) continue;
    out.push(v);
  }
  return out;
}

/** Stable hue (0–359) derived from a tag's text, for consistent auto-colouring. */
export function tagHue(tag: string): number {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return h % 360;
}

/**
 * Chip colours for a tag — all on one hue, with lightness pulled from theme
 * variables (see globals.css) so the chips invert correctly in dark mode:
 * a light fill + dark ink in the light theme, a dark fill + light ink in dark.
 */
export function tagStyle(tag: string): {
  backgroundColor: string;
  color: string;
  borderColor: string;
} {
  const h = tagHue(tag);
  return {
    backgroundColor: `oklch(var(--tag-l-bg) 0.05 ${h})`,
    color: `oklch(var(--tag-l-fg) 0.13 ${h})`,
    borderColor: `oklch(var(--tag-l-bd) 0.06 ${h})`,
  };
}

/** UI order for type pickers. Epic is last so existing muscle memory holds. */
export const ITEM_TYPES: readonly ItemType[] = [
  "feature",
  "bug",
  "task",
  "idea",
  "epic",
] as const;
export const ITEM_STATUSES: readonly ItemStatus[] = [
  "new",
  "in_progress",
  "blocked",
  "testing",
  "done",
] as const;

export const STATUS_LABEL: Record<ItemStatus, string> = {
  new: "Not started",
  in_progress: "In Progress",
  blocked: "Blocked",
  testing: "Testing",
  done: "Done",
};

export const TYPE_LABEL: Record<ItemType, string> = {
  feature: "Feature",
  bug: "Bug",
  task: "Task",
  idea: "Thought",
  epic: "Epic",
};

export function isItemType(v: unknown): v is ItemType {
  return typeof v === "string" && (ITEM_TYPES as readonly string[]).includes(v);
}
export function isItemStatus(v: unknown): v is ItemStatus {
  return typeof v === "string" && (ITEM_STATUSES as readonly string[]).includes(v);
}

// ── Epics (KANBAN-41) ────────────────────────────────────────────────────────
// Pure rules shared by the API, MCP core, UI picker and tests. The database
// enforces the same rules (trigger items_enforce_parent_link); these exist so
// callers get a clear message before a write, not a raw Postgres error.

/** The slice of an item the parent/child rules look at. */
export type ParentLinkNode = {
  id: string;
  type: ItemType;
  project_id: string;
  parent_id?: string | null;
  archived_at?: string | null;
};

/**
 * Why `child` may not take `parent` as its epic, or null when the link is
 * allowed. `childType` is the type the child WILL have (a patch may change type
 * and parent together). A null parent (clearing the link) is always allowed.
 * An archived epic is refused as a new parent unless `allowArchived` is set.
 */
export function parentLinkError(
  child: { id?: string | null; project_id: string },
  childType: ItemType,
  parent: ParentLinkNode | null,
  opts: { parentRef?: string; allowArchived?: boolean } = {},
): string | null {
  if (!parent) return null;
  const name = opts.parentRef ?? "that item";
  if (child.id && parent.id === child.id) return "An item cannot be its own parent";
  if (childType === "epic") {
    return "An epic cannot have a parent (epics are one level only)";
  }
  if (parent.type !== "epic") return `The parent must be an epic; ${name} is not an epic`;
  if (parent.project_id !== child.project_id) {
    return `The parent epic must be in the same project; ${name} is in another project`;
  }
  if (parent.parent_id) return "The parent epic cannot itself have a parent";
  if (parent.archived_at && !opts.allowArchived) {
    return `${name} is archived; restore it before adding items to it`;
  }
  return null;
}

/**
 * Why an item may not change type from `from` to `to`, or null when allowed.
 * `childCount` counts ALL children (archived included — they still reference
 * the epic); `hasParent` is whether the item will still have a parent after
 * the write.
 */
export function typeChangeError(
  from: ItemType,
  to: ItemType,
  childCount: number,
  hasParent: boolean,
): string | null {
  if (from === to) return null;
  if (from === "epic" && childCount > 0) {
    return `This epic has ${childCount} child item${childCount === 1 ? "" : "s"}; unlink them before changing its type`;
  }
  if (to === "epic" && hasParent) {
    return "An item with a parent epic cannot become an epic; clear its parent first";
  }
  return null;
}

/**
 * An epic's progress over its NON-archived children: how many are Done out of
 * how many there are. Archived children still reference the epic but don't count.
 */
export function epicProgress(
  children: { status: ItemStatus; archived_at?: string | null }[],
): { done: number; total: number } {
  const live = children.filter((c) => !c.archived_at);
  return { done: live.filter((c) => c.status === "done").length, total: live.length };
}
