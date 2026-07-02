import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isItemStatus,
  isItemType,
  isRichDoc,
  normalizeAssignees,
  normalizeTags,
  paragraphDoc,
  richDocImageSrcs,
  richDocText,
  type Item,
  type ItemStatus,
  type ItemType,
  type Project,
  type RichDoc,
} from "@/lib/types";
import { whitelist } from "@/lib/auth";
import { ITEM_IMAGES_BUCKET } from "@/lib/supabase-server";
import {
  categoryInProject,
  findOrCreateByPath,
  listCategories,
  pathOf,
} from "@/lib/categories-core";
import {
  coreErr,
  coreOk,
  listProjects,
  resolveProject,
  type CoreResult,
} from "@/lib/projects-core";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A human reference like "AMOS-12" (project key + immutable item number). */
const REF_RE = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;

/** The display reference for an item: "{key}-{number}", or "#{number}" if keyless. */
function refOf(key: string | null, number: number): string {
  return key ? `${key}-${number}` : `#${number}`;
}

/**
 * Resolve an item by either its UUID or a "{KEY}-{N}" reference (e.g. AMOS-12),
 * returning the row plus its project (for the key + visibility). A project the
 * actor can't see is reported as "not found".
 */
async function loadVisibleItem(
  sb: SupabaseClient,
  actor: string,
  ref: string,
): Promise<CoreResult<{ item: Item; project: Project }>> {
  const raw = String(ref ?? "").trim();
  const refMatch = !UUID_RE.test(raw) ? REF_RE.exec(raw) : null;

  if (refMatch) {
    const [, key, numStr] = refMatch;
    const projs = await listProjects(sb, actor);
    if (!projs.ok) return projs;
    const project = projs.data.find(
      (p) => (p.key ?? "").toLowerCase() === key.toLowerCase(),
    );
    if (!project) return coreErr(`Item not found: ${raw}`, 404);
    const { data, error } = await sb
      .from("items")
      .select("*")
      .eq("project_id", project.id)
      .eq("number", Number(numStr))
      .maybeSingle();
    if (error) return coreErr(error.message, 500);
    if (!data) return coreErr(`Item not found: ${raw}`, 404);
    return coreOk({ item: data as Item, project });
  }

  const { data, error } = await sb
    .from("items")
    .select("*")
    .eq("id", raw)
    .maybeSingle();
  if (error) return coreErr(error.message, 500);
  if (!data) return coreErr(`Item not found: ${raw}`, 404);
  const proj = await resolveProject(sb, actor, (data as Item).project_id);
  if (!proj.ok) return coreErr(`Item not found: ${raw}`, 404);
  return coreOk({ item: data as Item, project: proj.data });
}

export type ItemSummary = {
  id: string;
  /** "{KEY}-{N}" reference, e.g. "AMOS-12". */
  ref: string;
  number: number;
  name: string;
  type: ItemType;
  status: ItemStatus;
  tags: string[];
  assignees: string[];
  /** Area path, e.g. "coach / home", or null if unfiled. */
  area: string | null;
};

export type ItemDetail = ItemSummary & {
  project_id: string;
  body_text: string;
  attachments: Item["attachments"];
};

/** Shape a single item into the detailed view (resolves the area path). */
async function detailOf(
  sb: SupabaseClient,
  project: Project,
  it: Item,
): Promise<ItemDetail> {
  const area = it.category_id
    ? pathOf(await listCategories(sb, project.id), it.category_id) || null
    : null;
  return {
    id: it.id,
    ref: refOf(project.key, it.number),
    number: it.number,
    project_id: it.project_id,
    name: richDocText(it.body),
    body_text: richDocText(it.body),
    type: it.type,
    status: it.status,
    tags: it.tags,
    assignees: it.assignees,
    area,
    attachments: it.attachments,
  };
}

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
  // Resolve area paths once for the whole project, not per row.
  const cats = await listCategories(sb, proj.data.id);
  return coreOk(
    rows.map((it) => ({
      id: it.id,
      ref: refOf(proj.data.key, it.number),
      number: it.number,
      name: richDocText(it.body),
      type: it.type,
      status: it.status,
      tags: it.tags,
      assignees: it.assignees,
      area: it.category_id ? pathOf(cats, it.category_id) || null : null,
    })),
  );
}

/** Full item detail with the rich-text body flattened to plain text. */
export async function getItem(
  sb: SupabaseClient,
  actor: string,
  itemRef: string,
): Promise<CoreResult<ItemDetail>> {
  const r = await loadVisibleItem(sb, actor, itemRef);
  if (!r.ok) return r;
  return coreOk(await detailOf(sb, r.data.project, r.data.item));
}

/** A decoded inline body image, ready to emit as an MCP image content block. */
export interface ItemImage {
  /** The node's original `src`, for correlating with the body text. */
  src: string;
  /** Base64-encoded image bytes (no data-URI prefix). */
  data: string;
  /** MIME type, e.g. "image/png". */
  mimeType: string;
}

export interface ItemImagesResult {
  images: ItemImage[];
  /** Images present in the body but omitted (over the count/size guardrails). */
  skipped: number;
  /** Total inline images referenced by the body. */
  total: number;
}

/** Max inline images decoded per request, and the per-image byte ceiling. */
const MAX_ITEM_IMAGES = 8;
const MAX_ITEM_IMAGE_BYTES = 5 * 1024 * 1024;

/** Maps a stored image `src` to its storage bucket key, or null if not ours. */
function imageKeyFromSrc(src: string): string | null {
  const prefix = "/api/images/";
  if (!src.startsWith(prefix)) return null; // external/absolute URLs aren't in our bucket
  const key = src.slice(prefix.length).split(/[?#]/)[0];
  return key || null;
}

/**
 * Resolve the inline screenshots embedded in an item's body into base64 image
 * blocks. Purely a read-time access path over data already stored — it decodes
 * the private-bucket bytes the body already points at; nothing is written and
 * the body itself is unchanged. Guarded by count and per-image size so a heavy
 * item can't return an unbounded payload.
 */
export async function getItemImages(
  sb: SupabaseClient,
  actor: string,
  itemRef: string,
): Promise<CoreResult<ItemImagesResult>> {
  const r = await loadVisibleItem(sb, actor, itemRef);
  if (!r.ok) return r;
  // The item is already visible to the actor and these images are embedded in
  // its body, so no further per-image access check is needed.
  const srcs = richDocImageSrcs(r.data.item.body);
  const images: ItemImage[] = [];
  let skipped = 0;
  for (const src of srcs) {
    if (images.length >= MAX_ITEM_IMAGES) {
      skipped++;
      continue;
    }
    const key = imageKeyFromSrc(src);
    if (!key) {
      skipped++;
      continue;
    }
    const { data, error } = await sb.storage
      .from(ITEM_IMAGES_BUCKET)
      .download(key);
    if (error || !data) {
      skipped++;
      continue;
    }
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.byteLength > MAX_ITEM_IMAGE_BYTES) {
      skipped++;
      continue;
    }
    images.push({
      src,
      data: bytes.toString("base64"),
      mimeType: data.type || "application/octet-stream",
    });
  }
  return coreOk({ images, skipped, total: srcs.length });
}

/** Move an item's kanban column. On a column change, append to the column end. */
export async function setItemStatus(
  sb: SupabaseClient,
  actor: string,
  itemRef: string,
  status: string,
): Promise<CoreResult<ItemDetail>> {
  if (!isItemStatus(status)) return coreErr(`Invalid status: ${status}`, 400);
  const r = await loadVisibleItem(sb, actor, itemRef);
  if (!r.ok) return r;
  const { item: it, project } = r.data;
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
    .eq("id", it.id)
    .select()
    .single();
  if (error) return coreErr(error.message, 500);
  return coreOk(await detailOf(sb, project, data as Item));
}

export type CreateItemInput = {
  name?: unknown;
  type?: unknown;
  body?: unknown;
  tags?: unknown;
  /** A category (Area) id, taking precedence over `area`. */
  category_id?: unknown;
  /** An Area path like "coach / home"; created if missing when no category_id. */
  area?: unknown;
  assignees?: unknown;
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
  const assignees = normalizeAssignees(input.assignees, whitelist());
  // An item's content lives entirely in `body`; there is no separate name
  // column. When only a plain-text `name`/title is supplied, seed the body
  // with it.
  const doc = isRichDoc(input.body)
    ? input.body
    : paragraphDoc(typeof input.name === "string" ? input.name : "");
  if (!richDocText(doc)) return coreErr("content required", 400);

  // Area: an explicit category_id wins; otherwise resolve/create from a path.
  let category_id: string | null =
    typeof input.category_id === "string" ? input.category_id : null;
  if (!category_id && typeof input.area === "string" && input.area.trim()) {
    const cat = await findOrCreateByPath(sb, proj.data.id, input.area, actor);
    if (!cat.ok) return cat;
    category_id = cat.data.id;
  }

  // position is a GLOBAL per-project order (Design A); append to the end of the
  // whole project so a new item lands at the bottom of the flat list (and, since
  // it's the highest position, still at the bottom of its status column).
  const { data: tail } = await sb
    .from("items")
    .select("position")
    .eq("project_id", proj.data.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (tail?.position ?? 0) + 1024;
  const { data, error } = await sb
    .from("items")
    .insert({
      project_id: proj.data.id,
      body: doc,
      tags,
      assignees,
      type,
      status: "new",
      position,
      created_by: actor,
      updated_by: actor,
      category_id,
    })
    .select()
    .single();
  if (error) return coreErr(error.message, 500);
  return coreOk(data as Item);
}

/** Append a note paragraph to the item body. */
export async function appendItemNote(
  sb: SupabaseClient,
  actor: string,
  itemRef: string,
  note: string,
): Promise<CoreResult<ItemDetail>> {
  const text = String(note ?? "").trim();
  if (!text) return coreErr("note required", 400);
  const r = await loadVisibleItem(sb, actor, itemRef);
  if (!r.ok) return r;
  const { item: it, project } = r.data;
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
      updated_at: new Date().toISOString(),
      updated_by: actor,
    })
    .eq("id", it.id)
    .select()
    .single();
  if (error) return coreErr(error.message, 500);
  return coreOk(await detailOf(sb, project, data as Item));
}

/** Replace an item's tags (normalized). */
export async function setItemTags(
  sb: SupabaseClient,
  actor: string,
  itemRef: string,
  tags: unknown,
): Promise<CoreResult<ItemDetail>> {
  const r = await loadVisibleItem(sb, actor, itemRef);
  if (!r.ok) return r;
  const { item: it, project } = r.data;
  const { data, error } = await sb
    .from("items")
    .update({
      tags: normalizeTags(tags),
      updated_at: new Date().toISOString(),
      updated_by: actor,
    })
    .eq("id", it.id)
    .select()
    .single();
  if (error) return coreErr(error.message, 500);
  return coreOk(await detailOf(sb, project, data as Item));
}

/** Replace an item's assignees (members only, normalized to the whitelist). */
export async function setItemAssignees(
  sb: SupabaseClient,
  actor: string,
  itemRef: string,
  assignees: unknown,
): Promise<CoreResult<ItemDetail>> {
  const r = await loadVisibleItem(sb, actor, itemRef);
  if (!r.ok) return r;
  const { item: it, project } = r.data;
  const { data, error } = await sb
    .from("items")
    .update({
      assignees: normalizeAssignees(assignees, whitelist()),
      updated_at: new Date().toISOString(),
      updated_by: actor,
    })
    .eq("id", it.id)
    .select()
    .single();
  if (error) return coreErr(error.message, 500);
  return coreOk(await detailOf(sb, project, data as Item));
}

/**
 * File an item under an Area. `area` may be a category id, a "/"-separated path
 * (created if missing), or empty/null to un-file the item.
 */
export async function setItemArea(
  sb: SupabaseClient,
  actor: string,
  itemRef: string,
  area: unknown,
): Promise<CoreResult<ItemDetail>> {
  const r = await loadVisibleItem(sb, actor, itemRef);
  if (!r.ok) return r;
  const { item: it, project } = r.data;

  let category_id: string | null = null;
  const raw = typeof area === "string" ? area.trim() : "";
  if (raw) {
    if (UUID_RE.test(raw) && (await categoryInProject(sb, project.id, raw))) {
      category_id = raw;
    } else {
      const cat = await findOrCreateByPath(sb, project.id, raw, actor);
      if (!cat.ok) return cat;
      category_id = cat.data.id;
    }
  }
  const { data, error } = await sb
    .from("items")
    .update({
      category_id,
      updated_at: new Date().toISOString(),
      updated_by: actor,
    })
    .eq("id", it.id)
    .select()
    .single();
  if (error) return coreErr(error.message, 500);
  return coreOk(await detailOf(sb, project, data as Item));
}
