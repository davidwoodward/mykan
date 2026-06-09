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
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
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
