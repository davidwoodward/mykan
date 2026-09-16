import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isItemStatus,
  isItemType,
  isRichDoc,
  normalizeAssignees,
  normalizeTags,
  paragraphDoc,
  parentLinkError,
  typeChangeError,
  epicProgress,
  richDocImageSrcs,
  richDocText,
  richDocTitle,
  type GithubSync,
  type Item,
  type ItemStatus,
  type ItemType,
  type Project,
  type RichDoc,
} from "@/lib/types";
import { writeBackOnStatusChange } from "@/lib/github-writeback";
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
import { snapshotThenWrite, type HistorySource } from "@/lib/item-history";
import { deleteWithChildHistory } from "@/lib/epic-delete";

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
export async function loadVisibleItem(
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
  /** Title: the first non-empty line of the body (see `richDocTitle`). */
  name: string;
  type: ItemType;
  status: ItemStatus;
  tags: string[];
  assignees: string[];
  /** Area path, e.g. "coach / home", or null if unfiled. */
  area: string | null;
  /** Ref of the epic this item belongs to (e.g. "KANBAN-41"), or null. */
  parent: string | null;
};

/** A linked item in a detail view: its ref and title (`name`). */
export type ItemLink = { ref: string; name: string };

export type ItemDetail = Omit<ItemSummary, "parent"> & {
  /** The epic this item belongs to (ref + title), or null. */
  parent: ItemLink | null;
  /**
   * Epics only: the epic's non-archived children in board order. Archived
   * children still reference the epic but are left out here and of the count.
   */
  children?: (ItemLink & { status: ItemStatus })[];
  /** Epics only: "N/M done" over `children`. */
  children_progress?: string;
  project_id: string;
  /** The whole body flattened to plain text (title line included). */
  body_text: string;
  attachments: Item["attachments"];
  /** Backlink to the source GitHub issue (`owner/repo#number`), or null. */
  github_issue: string | null;
  /** The linked issue's creation time on GitHub (ISO), or null. */
  github_issue_created_at: string | null;
  /** When the item was pulled into mykan from GitHub (ISO), or null. */
  github_imported_at: string | null;
  /** Write-back sync flag for the linked issue (null when in sync). */
  github_sync: GithubSync;
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
  let parent: ItemLink | null = null;
  if (it.parent_id) {
    const { data: p } = await sb
      .from("items")
      .select("number, body")
      .eq("id", it.parent_id)
      .maybeSingle();
    if (p) {
      const row = p as Pick<Item, "number" | "body">;
      parent = { ref: refOf(project.key, row.number), name: richDocTitle(row.body) };
    }
  }
  // Children are only looked up for epics, so ordinary mutator responses don't
  // pay for an extra query.
  let epic: Pick<ItemDetail, "children" | "children_progress"> = {};
  if (it.type === "epic") {
    const { data: kids } = await sb
      .from("items")
      .select("number, body, status, archived_at, position")
      .eq("parent_id", it.id)
      .is("archived_at", null)
      .order("position", { ascending: true });
    const rows = (kids ?? []) as Pick<Item, "number" | "body" | "status" | "archived_at">[];
    const { done, total } = epicProgress(rows);
    epic = {
      children: rows.map((c) => ({
        ref: refOf(project.key, c.number),
        name: richDocTitle(c.body),
        status: c.status,
      })),
      children_progress: `${done}/${total} done`,
    };
  }
  return {
    id: it.id,
    ref: refOf(project.key, it.number),
    number: it.number,
    project_id: it.project_id,
    name: richDocTitle(it.body),
    body_text: richDocText(it.body),
    type: it.type,
    status: it.status,
    tags: it.tags,
    assignees: it.assignees,
    area,
    parent,
    ...epic,
    attachments: it.attachments,
    github_issue: it.github_issue,
    github_issue_created_at: it.github_issue_created_at,
    github_imported_at: it.github_imported_at,
    github_sync: it.github_sync,
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
  // Parent refs come from the rows already in hand; only a parent that isn't
  // among them (an archived epic) needs one batched lookup.
  const numberById = new Map(((data ?? []) as Item[]).map((it) => [it.id, it.number]));
  const missing = [
    ...new Set(
      rows
        .map((it) => it.parent_id)
        .filter((id): id is string => !!id && !numberById.has(id)),
    ),
  ];
  if (missing.length) {
    const { data: extra } = await sb.from("items").select("id, number").in("id", missing);
    for (const r of (extra ?? []) as Pick<Item, "id" | "number">[]) {
      numberById.set(r.id, r.number);
    }
  }
  const parentRef = (id: string | null | undefined) => {
    const n = id ? numberById.get(id) : undefined;
    return n === undefined ? null : refOf(proj.data.key, n);
  };
  return coreOk(
    rows.map((it) => ({
      id: it.id,
      ref: refOf(proj.data.key, it.number),
      number: it.number,
      name: richDocTitle(it.body),
      type: it.type,
      status: it.status,
      tags: it.tags,
      assignees: it.assignees,
      area: it.category_id ? pathOf(cats, it.category_id) || null : null,
      parent: parentRef(it.parent_id),
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
  source: HistorySource = "mcp",
): Promise<CoreResult<ItemDetail>> {
  if (!isItemStatus(status)) return coreErr(`Invalid status: ${status}`, 400);
  const r = await loadVisibleItem(sb, actor, itemRef);
  if (!r.ok) return r;
  const { item: it, project } = r.data;
  const patch: Record<string, unknown> = { status };
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
    // Stamp/clear the Done timestamp that drives Done ordering.
    if (status === "done") patch.done_at = new Date().toISOString();
    else if (it.status === "done") patch.done_at = null;
  }
  const w = await snapshotThenWrite(sb, actor, it, patch, source);
  if (!w.ok) return w;

  // Write-back (GH-5): a Done-boundary crossing on a GitHub-linked item closes /
  // reopens the issue with the actor's PAT. Best-effort — the status change is
  // already committed above and is NEVER rolled back; a skip/failure only records
  // a retry-able flag. See docs/github-integration.md §Write-back.
  if (it.github_issue) {
    const sync = await writeBackOnStatusChange(
      sb,
      actor,
      it.github_issue,
      it.status,
      w.data.status,
    );
    if (sync !== undefined) {
      await sb.from("items").update({ github_sync: sync }).eq("id", it.id);
      w.data.github_sync = sync;
    }
  }
  return coreOk(await detailOf(sb, project, w.data));
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
  /**
   * Explicit global position for the new item. When omitted, the item appends
   * to the end of the project (the default). Used to insert a new item at a
   * specific spot (e.g. right after a selected row).
   */
  position?: unknown;
  /**
   * Backlink to a source GitHub issue (`owner/repo#number`), set only by import
   * (see lib/github-core.ts). Stored on the item as its dedupe/write-back key.
   */
  github_issue?: unknown;
  /** The source issue's GitHub creation time (ISO), captured at import. */
  github_issue_created_at?: unknown;
  /** The parent epic, as an item id or KEY-N reference. Empty/null = none. */
  parent?: unknown;
};

/**
 * Resolve a parent reference (item id or KEY-N) for an item in `project` whose
 * type will be `childType`, applying the epic rules. `childId` is null for an
 * item not created yet. Empty/null → no parent.
 */
export async function resolveParent(
  sb: SupabaseClient,
  actor: string,
  project: Project,
  childId: string | null,
  childType: ItemType,
  parentRef: unknown,
): Promise<CoreResult<Item | null>> {
  const raw = typeof parentRef === "string" ? parentRef.trim() : "";
  if (!raw) return coreOk(null);
  const r = await loadVisibleItem(sb, actor, raw);
  if (!r.ok) return coreErr(`Parent not found: ${raw}`, 404);
  const parent = r.data.item;
  const err = parentLinkError({ id: childId, project_id: project.id }, childType, parent, {
    parentRef: refOf(r.data.project.key, parent.number),
  });
  if (err) return coreErr(err, 400);
  return coreOk(parent);
}

/** How many items (archived included) reference `itemId` as their parent. */
export async function countChildren(sb: SupabaseClient, itemId: string): Promise<number> {
  const { count } = await sb
    .from("items")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", itemId);
  return count ?? 0;
}

/**
 * App-side check for a web patch that changes an item's type and/or parent (the
 * database enforces the same rules). `nextParentId` undefined = parent
 * unchanged. Returns a user-facing error or null.
 */
export async function patchLinkError(
  sb: SupabaseClient,
  current: Item,
  nextType: ItemType,
  nextParentId: string | null | undefined,
): Promise<string | null> {
  const parentId = nextParentId === undefined ? (current.parent_id ?? null) : nextParentId;
  if (nextType !== current.type) {
    const kids = current.type === "epic" ? await countChildren(sb, current.id) : 0;
    const err = typeChangeError(current.type, nextType, kids, !!parentId);
    if (err) return err;
  }
  if (!nextParentId) return null;
  const { data } = await sb.from("items").select("*").eq("id", nextParentId).maybeSingle();
  if (!data) return "Parent not found";
  // An unchanged link to a since-archived epic stays valid.
  return parentLinkError(current, nextType, data as Item, {
    allowArchived: nextParentId === current.parent_id,
  });
}

/**
 * Permanently delete an item. If it has children (an epic), each child is first
 * un-linked through the history chokepoint, so its history reads
 * "parent KEY-N removed (epic deleted)"; see lib/epic-delete.ts for the order
 * and the failure handling. The caller has already checked access.
 */
export async function deleteItemWithHistory(
  sb: SupabaseClient,
  actor: string,
  item: Item,
  projectKey: string | null,
  source: HistorySource = "web",
): Promise<CoreResult<{ unlinked: number }>> {
  const { data: kidRows, error: kidErr } = await sb
    .from("items")
    .select("*")
    .eq("parent_id", item.id);
  if (kidErr) return coreErr(kidErr.message, 500);
  // Latest known row per child: the chokepoint snapshots whatever it is given.
  const rows = new Map(((kidRows ?? []) as Item[]).map((c) => [c.id, c]));
  const parentRef = refOf(projectKey, item.number);

  const outcome = await deleteWithChildHistory({
    childIds: [...rows.keys()],
    unlink: async (id) => {
      const w = await snapshotThenWrite(sb, actor, rows.get(id)!, { parent_id: null }, source, null, {
        parent_ref: parentRef,
        parent_cleared_reason: "epic_deleted",
      });
      if (!w.ok) return w.error;
      rows.set(id, w.data);
      return null;
    },
    relink: async (id) => {
      const w = await snapshotThenWrite(sb, actor, rows.get(id)!, { parent_id: item.id }, source);
      if (!w.ok) return w.error;
      rows.set(id, w.data);
      return null;
    },
    deleteItem: async () => {
      const { error } = await sb.from("items").delete().eq("id", item.id);
      return error ? error.message : null;
    },
  });
  if (!outcome.ok) {
    const stranded = outcome.relinkFailed.map((id) => refOf(projectKey, rows.get(id)!.number));
    const tail = stranded.length
      ? ` — but ${stranded.join(", ")} could not be linked back; re-add ${stranded.length === 1 ? "it" : "them"} to ${parentRef}`
      : "";
    return coreErr(`${outcome.error}${tail}`, 500);
  }
  return coreOk({ unlinked: outcome.unlinked.length });
}

/** Postgres guard-rule errors (check / FK violations) are the caller's fault. */
function writeErrStatus(code: string | undefined): number {
  return code === "23514" || code === "23503" ? 400 : 500;
}

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

  const parent = await resolveParent(sb, actor, proj.data, null, type, input.parent);
  if (!parent.ok) return parent;

  // Area: an explicit category_id wins; otherwise resolve/create from a path.
  let category_id: string | null =
    typeof input.category_id === "string" ? input.category_id : null;
  if (!category_id && typeof input.area === "string" && input.area.trim()) {
    const cat = await findOrCreateByPath(sb, proj.data.id, input.area, actor);
    if (!cat.ok) return cat;
    category_id = cat.data.id;
  }

  // position is a GLOBAL per-project order (Design A). An explicit position
  // (e.g. inserting right after a selected row) wins; otherwise append to the
  // end of the whole project so a new item lands at the bottom of the flat list
  // (and, since it's the highest position, at the bottom of its status column).
  let position: number;
  if (typeof input.position === "number" && Number.isFinite(input.position)) {
    position = input.position;
  } else {
    const { data: tail } = await sb
      .from("items")
      .select("position")
      .eq("project_id", proj.data.id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();
    position = (tail?.position ?? 0) + 1024;
  }
  const github_issue =
    typeof input.github_issue === "string" && input.github_issue.trim()
      ? input.github_issue.trim()
      : null;
  const github_issue_created_at =
    typeof input.github_issue_created_at === "string" && input.github_issue_created_at.trim()
      ? input.github_issue_created_at.trim()
      : null;
  // A GitHub-linked item records when it was pulled into mykan (import time).
  const github_imported_at = github_issue ? new Date().toISOString() : null;
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
      parent_id: parent.data?.id ?? null,
      github_issue,
      github_issue_created_at,
      github_imported_at,
    })
    .select()
    .single();
  if (error) return coreErr(error.message, writeErrStatus(error.code));
  return coreOk(data as Item);
}

/**
 * Link an item to its epic, or clear the link. `parent` is the epic's id or
 * KEY-N reference; empty/null clears it. The epic rules (one level, same
 * project, parent must be a non-archived epic, no self-parent) are checked here
 * with clear messages and enforced again by the database. Recorded in history.
 */
export async function setItemParent(
  sb: SupabaseClient,
  actor: string,
  itemRef: string,
  parent: unknown,
  source: HistorySource = "mcp",
): Promise<CoreResult<ItemDetail>> {
  const r = await loadVisibleItem(sb, actor, itemRef);
  if (!r.ok) return r;
  const { item: it, project } = r.data;
  const p = await resolveParent(sb, actor, project, it.id, it.type, parent);
  if (!p.ok) return p;
  const w = await snapshotThenWrite(sb, actor, it, { parent_id: p.data?.id ?? null }, source);
  if (!w.ok) return w;
  return coreOk(await detailOf(sb, project, w.data));
}

/** Append a note paragraph to the item body. */
export async function appendItemNote(
  sb: SupabaseClient,
  actor: string,
  itemRef: string,
  note: string,
  source: HistorySource = "mcp",
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
  const w = await snapshotThenWrite(sb, actor, it, { body: nextDoc }, source);
  if (!w.ok) return w;
  return coreOk(await detailOf(sb, project, w.data));
}

/**
 * Replace an item's entire body with plain text (one paragraph per line).
 * The safe-overwrite counterpart to appendItemNote: the previous state is
 * always recoverable from history, so an agent may REPLACE content — including
 * the first line, which acts as the title. NOTE: inline images in the old body
 * are dropped from the new one (they remain in the history snapshot).
 */
export async function setItemBody(
  sb: SupabaseClient,
  actor: string,
  itemRef: string,
  text: string,
  source: HistorySource = "mcp",
): Promise<CoreResult<ItemDetail>> {
  const raw = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!raw) return coreErr("body text required", 400);
  const r = await loadVisibleItem(sb, actor, itemRef);
  if (!r.ok) return r;
  const { item: it, project } = r.data;
  const nextDoc: RichDoc = {
    type: "doc",
    content: raw.split("\n").map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
  const w = await snapshotThenWrite(sb, actor, it, { body: nextDoc }, source);
  if (!w.ok) return w;
  return coreOk(await detailOf(sb, project, w.data));
}

/** Replace an item's tags (normalized). */
export async function setItemTags(
  sb: SupabaseClient,
  actor: string,
  itemRef: string,
  tags: unknown,
  source: HistorySource = "mcp",
): Promise<CoreResult<ItemDetail>> {
  const r = await loadVisibleItem(sb, actor, itemRef);
  if (!r.ok) return r;
  const { item: it, project } = r.data;
  const w = await snapshotThenWrite(
    sb,
    actor,
    it,
    { tags: normalizeTags(tags) },
    source,
  );
  if (!w.ok) return w;
  return coreOk(await detailOf(sb, project, w.data));
}

/** Replace an item's assignees (members only, normalized to the whitelist). */
export async function setItemAssignees(
  sb: SupabaseClient,
  actor: string,
  itemRef: string,
  assignees: unknown,
  source: HistorySource = "mcp",
): Promise<CoreResult<ItemDetail>> {
  const r = await loadVisibleItem(sb, actor, itemRef);
  if (!r.ok) return r;
  const { item: it, project } = r.data;
  const w = await snapshotThenWrite(
    sb,
    actor,
    it,
    { assignees: normalizeAssignees(assignees, whitelist()) },
    source,
  );
  if (!w.ok) return w;
  return coreOk(await detailOf(sb, project, w.data));
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
  source: HistorySource = "mcp",
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
  const w = await snapshotThenWrite(sb, actor, it, { category_id }, source);
  if (!w.ok) return w;
  return coreOk(await detailOf(sb, project, w.data));
}
