import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { loadProjectForAccess, requireSession } from "@/lib/api-auth";
import { whitelist } from "@/lib/auth";
import { normalizeAssignees } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const access = await loadProjectForAccess(id, gate.email);
  if (access.error) return access.error;
  return NextResponse.json(access.project);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const access = await loadProjectForAccess(id, gate.email);
  if (access.error) return access.error;

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    description?: unknown;
    key?: unknown;
    sharedWith?: unknown;
  };
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (typeof body.description === "string" || body.description === null) {
    patch.description = body.description;
  }
  // Short uppercase reference key (e.g. AMOS). Empty clears it back to null.
  if (typeof body.key === "string" || body.key === null) {
    patch.key =
      typeof body.key === "string"
        ? body.key.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || null
        : null;
  }
  // Sharing may be changed only by the project's owner (creator). The list is
  // normalized to whitelisted members, minus the owner (always implicit).
  // `is_private` is kept as a mirror of "shared with no one".
  if (Array.isArray(body.sharedWith)) {
    if (access.project.created_by !== gate.email) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const members = normalizeAssignees(
      body.sharedWith as string[],
      whitelist(),
    ).filter((e) => e !== gate.email);
    patch.shared_with = members;
    patch.is_private = members.length === 0;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no fields" }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();
  patch.updated_by = gate.email;

  const { data, error } = await getSupabase()
    .from("projects")
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

  const access = await loadProjectForAccess(id, gate.email);
  if (access.error) return access.error;

  const { error } = await getSupabase().from("projects").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
