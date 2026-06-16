export type ItemType = "feature" | "bug" | "idea";
export type ItemStatus = "new" | "in_progress" | "done";

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
  /** When true, visible only to its creator (the owner). Defaults to public. */
  is_private: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

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
  name: string;
  type: ItemType;
  status: ItemStatus;
  position: number;
  body: RichDoc | null;
  tags: string[];
  attachments: Attachment[];
  archived_at: string | null;
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

/** Stable hue (0–359) derived from a tag's text, for consistent auto-colouring. */
export function tagHue(tag: string): number {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Chip colours for a tag — light fill, dark ink, soft border — all on one hue. */
export function tagStyle(tag: string): {
  backgroundColor: string;
  color: string;
  borderColor: string;
} {
  const h = tagHue(tag);
  return {
    backgroundColor: `oklch(95% 0.045 ${h})`,
    color: `oklch(45% 0.13 ${h})`,
    borderColor: `oklch(88% 0.06 ${h})`,
  };
}

export const ITEM_TYPES: readonly ItemType[] = ["feature", "bug", "idea"] as const;
export const ITEM_STATUSES: readonly ItemStatus[] = ["new", "in_progress", "done"] as const;

export const STATUS_LABEL: Record<ItemStatus, string> = {
  new: "New",
  in_progress: "In Progress",
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
