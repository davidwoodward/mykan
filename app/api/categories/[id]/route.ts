import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { loadProjectForAccess, requireSession } from "@/lib/api-auth";
import { deleteCategory, renameCategory, setCategoryGithubRepo } from "@/lib/categories-core";

type Ctx = { params: Promise<{ id: string }> };

/** Load a category's project_id and confirm the caller may access that project. */
async function gateCategory(id: string, email: string) {
  const { data } = await getSupabase()
    .from("categories")
    .select("project_id")
    .eq("id", id)
    .maybeSingle();
  if (!data) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  const projectId = (data as { project_id: string }).project_id;
  const access = await loadProjectForAccess(projectId, email);
  if (access.error) return { error: access.error };
  return { projectId };
}

export async function PATCH(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const g = await gateCategory(id, gate.email);
  if ("error" in g) return g.error;

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    github_repo?: unknown;
  };
  const sb = getSupabase();

  // Bind/unbind a GitHub repo on this Area.
  if (typeof body.github_repo === "string" || body.github_repo === null) {
    const repo = typeof body.github_repo === "string" ? body.github_repo.trim() || null : null;
    const r = await setCategoryGithubRepo(sb, g.projectId, id, repo, gate.email);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r.data);
  }

  // Otherwise a rename.
  if (typeof body.name !== "string") {
    return NextResponse.json({ error: "name or github_repo required" }, { status: 400 });
  }
  const r = await renameCategory(sb, g.projectId, id, body.name, gate.email);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const g = await gateCategory(id, gate.email);
  if ("error" in g) return g.error;

  const r = await deleteCategory(getSupabase(), g.projectId, id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
