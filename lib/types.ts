export type ItemType = "feature" | "bug" | "idea";
export type ItemStatus = "new" | "in_progress" | "blocked" | "done";

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

/**
 * Flattens the plain text out of a rich-text body, preserving the line
 * structure: block siblings (paragraphs, list items, code lines, headings) are
 * joined by newlines and hard line breaks become newlines, so the label shown
 * for an item keeps the line feeds and indentation the user typed. Images and
 * other non-text nodes contribute nothing.
 */
export function richDocText(body: RichDoc | null | undefined): string {
  if (!body || !Array.isArray(body.content)) return "";
  const flatten = (node: {
    type?: string;
    text?: string;
    content?: unknown[];
  }): string => {
    if (node.type === "text") return typeof node.text === "string" ? node.text : "";
    if (node.type === "hardBreak") return "\n";
    if (!Array.isArray(node.content)) return "";
    const kids = node.content as {
      type?: string;
      text?: string;
      content?: unknown[];
    }[];
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
      out += flatten(kids[i]);
    }
    return out;
  };
  // Trim only outer blank lines/space — interior newlines and indentation stay.
  return flatten(body as { content?: unknown[] }).replace(/^\s+|\s+$/g, "");
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
}

/** A node in a project's Area tree. Items reference one by id. */
export interface Category {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  position: number;
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
  attachments: Attachment[];
  archived_at: string | null;
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

export const ITEM_TYPES: readonly ItemType[] = ["feature", "bug", "idea"] as const;
export const ITEM_STATUSES: readonly ItemStatus[] = [
  "new",
  "in_progress",
  "blocked",
  "done",
] as const;

export const STATUS_LABEL: Record<ItemStatus, string> = {
  new: "Not started",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
};

export const TYPE_LABEL: Record<ItemType, string> = {
  feature: "Feature",
  bug: "Bug",
  idea: "Thought",
};

export function isItemType(v: unknown): v is ItemType {
  return typeof v === "string" && (ITEM_TYPES as readonly string[]).includes(v);
}
export function isItemStatus(v: unknown): v is ItemStatus {
  return typeof v === "string" && (ITEM_STATUSES as readonly string[]).includes(v);
}
