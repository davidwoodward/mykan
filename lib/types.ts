export type ItemType = "feature" | "bug" | "idea";
export type ItemStatus = "new" | "in_progress" | "done";

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
  idea: "Idea",
};

export function isItemType(v: unknown): v is ItemType {
  return typeof v === "string" && (ITEM_TYPES as readonly string[]).includes(v);
}
export function isItemStatus(v: unknown): v is ItemStatus {
  return typeof v === "string" && (ITEM_STATUSES as readonly string[]).includes(v);
}
