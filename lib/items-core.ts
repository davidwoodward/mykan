import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isItemStatus,
  isItemType,
  isRichDoc,
  normalizeTags,
  paragraphDoc,
  richDocText,
  type Item,
  type ItemStatus,
  type ItemType,
  type RichDoc,
} from "@/lib/types";
import {
  coreErr,
  coreOk,
  resolveProject,
  type CoreResult,
} from "@/lib/projects-core";

/** Load an item and confirm its project is visible to `actor` (else 404). */
async function loadVisibleItem(
  sb: SupabaseClient,
  actor: string,
  itemId: string,
): Promise<CoreResult<Item>> {
  const { data, error } = await sb
    .from("items")
    .select("*")
    .eq("id", itemId)
    .maybeSingle();
  if (error) return coreErr(error.message, 500);
  if (!data) return coreErr(`Item not found: ${itemId}`, 404);
  const proj = await resolveProject(sb, actor, (data as Item).project_id);
  if (!proj.ok) return coreErr(`Item not found: ${itemId}`, 404);
  return coreOk(data as Item);
}

export type ItemSummary = Pick<Item, "id" | "name" | "type" | "status" | "tags">;
export type ItemDetail = {
  id: string;
  project_id: string;
  name: string;
  body_text: string;
  type: ItemType;
  status: ItemStatus;
  tags: string[];
  attachments: Item["attachments"];
};

/** Non-archived items in a project, optionally filtered by status. */
export async function listItems(
  sb: SupabaseClient,
  actor: string,
  projectRef: string,
  status?: ItemStatus,
): Promise<CoreResult<ItemSummary[]>> {
  const proj = await resolveProject(sb, actor, projectRef);
  if (!proj.ok) return proj;
  const { data, error } = await sb
    .from("items")
    .select("*")
    .eq("project_id", proj.data.id)
    .is("archived_at", null)
    .order("position", { ascending: true });
  if (error) return coreErr(error.message, 500);
  let rows = (data ?? []) as Item[];
  if (status) rows = rows.filter((it) => it.status === status);
  return coreOk(
    rows.map((it) => ({
      id: it.id,
      name: it.name,
      type: it.type,
      status: it.status,
      tags: it.tags,
    })),
  );
}

/** Full item detail with the rich-text body flattened to plain text. */
export async function getItem(
  sb: SupabaseClient,
  actor: string,
  itemId: string,
): Promise<CoreResult<ItemDetail>> {
  const r = await loadVisibleItem(sb, actor, itemId);
  if (!r.ok) return r;
  const it = r.data;
  return coreOk({
    id: it.id,
    project_id: it.project_id,
    name: it.name,
    body_text: richDocText(it.body),
    type: it.type,
    status: it.status,
    tags: it.tags,
    attachments: it.attachments,
  });
}

/** Move an item's kanban column. On a column change, append to the column end. */
export async function setItemStatus(
  sb: SupabaseClient,
  actor: string,
  itemId: string,
  status: string,
): Promise<CoreResult<Item>> {
  if (!isItemStatus(status)) return coreErr(`Invalid status: ${status}`, 400);
  const r = await loadVisibleItem(sb, actor, itemId);
  if (!r.ok) return r;
  const it = r.data;
  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
    updated_by: actor,
  };
  if (it.status !== status) {
    const { data: tail } = await sb
      .from("items")
      .select("position")
      .eq("project_id", it.project_id)
      .eq("status", status)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    patch.position = (tail?.position ?? 0) + 1024;
  }
  const { data, error } = await sb
    .from("items")
    .update(patch)
    .eq("id", itemId)
    .select()
    .single();
  if (error) return coreErr(error.message, 500);
  return coreOk(data as Item);
}

export type CreateItemInput = {
  name?: unknown;
  type?: unknown;
  body?: unknown;
  tags?: unknown;
};

/** Create an item in a project (mirrors POST /api/projects/[id]/items). */
export async function createItem(
  sb: SupabaseClient,
  actor: string,
  projectRef: string,
  input: CreateItemInput,
): Promise<CoreResult<Item>> {
  const proj = await resolveProject(sb, actor, projectRef);
  if (!proj.ok) return proj;
  const type: ItemType = isItemType(input.type) ? input.type : "feature";
  const tags = normalizeTags(input.tags);
  const doc = isRichDoc(input.body)
    ? input.body
    : paragraphDoc(typeof input.name === "string" ? input.name : "");
  const name = richDocText(doc);
  if (!name) return coreErr("name required", 400);
  const { data: tail } = await sb
    .from("items")
    .select("position")
    .eq("project_id", proj.data.id)
    .eq("status", "new")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (tail?.position ?? 0) + 1024;
  const { data, error } = await sb
    .from("items")
    .insert({
      project_id: proj.data.id,
      name,
      body: doc,
      tags,
      type,
      status: "new",
      position,
      created_by: actor,
      updated_by: actor,
    })
    .select()
    .single();
  if (error) return coreErr(error.message, 500);
  return coreOk(data as Item);
}

/** Append a note paragraph to the item body and re-sync the flattened name. */
export async function appendItemNote(
  sb: SupabaseClient,
  actor: string,
  itemId: string,
  note: string,
): Promise<CoreResult<Item>> {
  const text = String(note ?? "").trim();
  if (!text) return coreErr("note required", 400);
  const r = await loadVisibleItem(sb, actor, itemId);
  if (!r.ok) return r;
  const it = r.data;
  const doc: RichDoc = isRichDoc(it.body) ? it.body : { type: "doc", content: [] };
  const para = { type: "paragraph", content: [{ type: "text", text }] };
  const nextDoc: RichDoc = {
    type: "doc",
    content: [...(Array.isArray(doc.content) ? doc.content : []), para],
  };
  const { data, error } = await sb
    .from("items")
    .update({
      body: nextDoc,
      name: richDocText(nextDoc),
      updated_at: new Date().toISOString(),
      updated_by: actor,
    })
    .eq("id", itemId)
    .select()
    .single();
  if (error) return coreErr(error.message, 500);
  return coreOk(data as Item);
}

/** Replace an item's tags (normalized). */
export async function setItemTags(
  sb: SupabaseClient,
  actor: string,
  itemId: string,
  tags: unknown,
): Promise<CoreResult<Item>> {
  const r = await loadVisibleItem(sb, actor, itemId);
  if (!r.ok) return r;
  const { data, error } = await sb
    .from("items")
    .update({
      tags: normalizeTags(tags),
      updated_at: new Date().toISOString(),
      updated_by: actor,
    })
    .eq("id", itemId)
    .select()
    .single();
  if (error) return coreErr(error.message, 500);
  return coreOk(data as Item);
}
