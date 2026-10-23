import { NextResponse } from "next/server";
import { requireSession, loadProjectForAccess } from "@/lib/api-auth";
import { getSupabase } from "@/lib/supabase-server";
import { syncProjectWithGithub } from "@/lib/github-core";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST — Sync with GitHub (KANBAN-65): import new open issues from every
 * repo-linked area, then move cards whose issue was closed on GitHub to Done.
 * Body: { category_id? } — sync one area's repo, or omit to sync every
 * repo-linked area. Uses the logged-in user's own PAT. See
 * docs/github-integration.md §Sync.
 */
export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  // Visibility gate (404s a hidden project); the core also re-resolves.
  const access = await loadProjectForAccess(id, gate.email);
  if (access.error) return access.error;

  const body = (await req.json().catch(() => ({}))) as { category_id?: unknown };
  const categoryId = typeof body.category_id === "string" ? body.category_id : undefined;

  const r = await syncProjectWithGithub(getSupabase(), gate.email, id, "web", { categoryId });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data);
}
