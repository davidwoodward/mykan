import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { denyItemAccess, requireSession } from "@/lib/api-auth";
import { whitelist } from "@/lib/auth";
import { categoryInProject } from "@/lib/categories-core";
import {
  isItemStatus,
  isItemType,
  isRichDoc,
  normalizeAssignees,
  normalizeTags,
  richDocText,
} from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const deny = await denyItemAccess(id, gate.email);
  if (deny) return deny;

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
  };
  const patch: Record<string, unknown> = {};
  if (isItemType(body.type)) patch.type = body.type;
  if (isItemStatus(body.status)) patch.status = body.status;
  if (typeof body.position === "number" && Number.isFinite(body.position)) {
    patch.position = body.position;
  }
  if (Array.isArray(body.tags)) patch.tags = normalizeTags(body.tags);
  // Assignees: keep only known members (the whitelist), lowercased and deduped.
  if (Array.isArray(body.assignees)) {
    patch.assignees = normalizeAssignees(body.assignees, whitelist());
  }
  // Category: must belong to this item's project (or null to un-file).
  if (typeof body.category_id === "string" || body.category_id === null) {
    const { data: itemRow } = await getSupabase()
      .from("items")
      .select("project_id")
      .eq("id", id)
      .maybeSingle();
    const projectId = (itemRow as { project_id: string } | null)?.project_id;
    if (
      projectId &&
      (await categoryInProject(getSupabase(), projectId, body.category_id))
    ) {
      patch.category_id = body.category_id;
    }
  }
  // Soft delete / restore.
  if (typeof body.archived === "boolean") {
    patch.archived_at = body.archived ? new Date().toISOString() : null;
  }
  // body is the source of truth; keep the flattened `name` label in sync with it.
  if (isRichDoc(body.body)) {
    patch.body = body.body;
    patch.name = richDocText(body.body);
  } else if (body.body === null) {
    patch.body = null;
    patch.name = "";
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no fields" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();
  patch.updated_by = gate.email;

  const { data, error } = await getSupabase()
    .from("items")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
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
