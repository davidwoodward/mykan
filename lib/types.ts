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

/**
 * Flattens the plain text out of a rich-text body — block nodes joined by
 * newlines, images and other non-text nodes contributing nothing. This is the
 * single-line label shown for an item.
 */
export function richDocText(body: RichDoc | null | undefined): string {
  if (!body || !Array.isArray(body.content)) return "";
  const blockText = (node: { content?: unknown[] }): string => {
    const out: string[] = [];
    const walk = (nodes: unknown[]) => {
      for (const c of nodes) {
        const cc = c as { type?: string; text?: string; content?: unknown[] };
        if (cc.type === "text" && typeof cc.text === "string") out.push(cc.text);
        if (Array.isArray(cc.content)) walk(cc.content);
      }
    };
    if (Array.isArray(node.content)) walk(node.content);
    return out.join("");
  };
  return (body.content as { content?: unknown[] }[])
    .map(blockText)
    .join("\n")
    .trim();
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
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
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
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
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
