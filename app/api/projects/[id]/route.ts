import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { loadProjectForAccess, requireSession } from "@/lib/api-auth";
import { whitelist } from "@/lib/auth";
import { normalizeAssignees } from "@/lib/types";
import { normalizeKeyInput } from "@/lib/card-url";
import {
  keyConstraintMessage,
  projectKeyAliases,
  projectKeyWriteError,
} from "@/lib/project-keys";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const access = await loadProjectForAccess(id, gate.email);
  if (access.error) return access.error;
  // The project's old keys (KANBAN-45), for the edit panel.
  const key_aliases = await projectKeyAliases(getSupabase(), id);
  return NextResponse.json({ ...access.project, key_aliases });
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
    github_account_id?: unknown;
  };
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (typeof body.description === "string" || body.description === null) {
    patch.description = body.description;
  }
  // The project key is the board's URL and every card's ref prefix. It can be
  // renamed (KANBAN-45): the database keeps the old key as an alias, so old
  // links and refs keep working. Sending the current key is a no-op. The key
  // can't be cleared, and can't be another project's key or old key.
  if (body.key !== undefined) {
    const current = (access.project as { key?: string | null }).key ?? null;
    const next = normalizeKeyInput(body.key);
    if (next !== current) {
      const keyErr = await projectKeyWriteError(getSupabase(), next, id);
      if (keyErr) return NextResponse.json({ error: keyErr.error }, { status: keyErr.status });
      patch.key = next;
    }
  }
  // The GitHub account this project pulls from (github_accounts.id). Empty
  // string clears it. A bad id is rejected by the FK at the DB level.
  if (typeof body.github_account_id === "string" || body.github_account_id === null) {
    patch.github_account_id = body.github_account_id || null;
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
  if (error) {
    const msg = keyConstraintMessage(error);
    return NextResponse.json({ error: msg ?? error.message }, { status: msg ? 400 : 500 });
  }
  // The project's old keys ride along, so the edit panel can show them.
  const key_aliases = await projectKeyAliases(getSupabase(), id);
  return NextResponse.json({ ...data, key_aliases });
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
