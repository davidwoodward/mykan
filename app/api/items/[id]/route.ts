import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { denyItemAccess, requireSession } from "@/lib/api-auth";
import { whitelist } from "@/lib/auth";
import { categoryInProject } from "@/lib/categories-core";
import { snapshotThenWrite } from "@/lib/item-history";
import { writeBackOnStatusChange } from "@/lib/github-writeback";
import {
  isItemStatus,
  isItemType,
  isRichDoc,
  normalizeAssignees,
  normalizeTags,
  type Item,
} from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const deny = await denyItemAccess(id, gate.email);
  if (deny) return deny;

  // Load the full current row: snapshotThenWrite records the previous state.
  const { data: currentRow } = await getSupabase()
    .from("items")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!currentRow) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const current = currentRow as Item;

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    type?: unknown;
    status?: unknown;
    position?: unknown;
    body?: unknown;
    tags?: unknown;
    assignees?: unknown;
    archived?: unknown;
    category_id?: unknown;
    edit_session?: unknown;
  };
  const patch: Record<string, unknown> = {};
  if (isItemType(body.type)) patch.type = body.type;
  if (isItemStatus(body.status)) {
    patch.status = body.status;
    // Stamp when an item enters Done (drives Done ordering); clear on leaving.
    // Callers only send `status` on an actual transition, so this never
    // re-stamps an item already in Done.
    patch.done_at = body.status === "done" ? new Date().toISOString() : null;
  }
  if (typeof body.position === "number" && Number.isFinite(body.position)) {
    patch.position = body.position;
  }
  if (Array.isArray(body.tags)) patch.tags = normalizeTags(body.tags);
  // Assignees: keep only known members (the whitelist), lowercased and deduped.
  if (Array.isArray(body.assignees)) {
    patch.assignees = normalizeAssignees(body.assignees, whitelist());
  }
  // Category: must belong to this item's project (or null to un-file).
  if (
    (typeof body.category_id === "string" &&
      (await categoryInProject(getSupabase(), current.project_id, body.category_id))) ||
    body.category_id === null
  ) {
    patch.category_id = body.category_id;
  }
  // Soft delete / restore.
  if (typeof body.archived === "boolean") {
    patch.archived_at = body.archived ? new Date().toISOString() : null;
  }
  // body is the sole source of an item's content; any plain-text label is
  // derived from it on read (see lib/items-core.ts).
  if (isRichDoc(body.body)) {
    patch.body = body.body;
  } else if (body.body === null) {
    patch.body = null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no fields" }, { status: 400 });
  }

  // The editor's per-open session id: body autosaves within one editing
  // session coalesce to one history entry; closing the editor seals it.
  const editSession =
    typeof body.edit_session === "string" && body.edit_session.length <= 64
      ? body.edit_session
      : null;

  // The chokepoint records history (when tracked fields change) and stamps
  // updated_at/updated_by.
  const w = await snapshotThenWrite(
    getSupabase(),
    gate.email,
    current,
    patch,
    "web",
    editSession,
  );
  if (!w.ok) return NextResponse.json({ error: w.error }, { status: w.status });

  // Write-back (GH-5): a Done-boundary crossing on a GitHub-linked item closes /
  // reopens the issue with the acting user's PAT. The status is already committed
  // above and is NEVER rolled back; a skip/failure only records a retry-able flag.
  if (current.github_issue) {
    const sync = await writeBackOnStatusChange(
      getSupabase(),
      gate.email,
      current.github_issue,
      current.status,
      w.data.status,
    );
    if (sync !== undefined) {
      await getSupabase().from("items").update({ github_sync: sync }).eq("id", id);
      w.data.github_sync = sync;
    }
  }
  return NextResponse.json(w.data);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const deny = await denyItemAccess(id, gate.email);
  if (deny) return deny;

  const { error } = await getSupabase().from("items").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
