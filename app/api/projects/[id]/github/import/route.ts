import { NextResponse } from "next/server";
import { requireSession, loadProjectForAccess } from "@/lib/api-auth";
import { getSupabase } from "@/lib/supabase-server";
import { importFromGithub } from "@/lib/github-core";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST — import a project's open GitHub issues as Not Started items (KANBAN-23 /
 * GH-4). Uses the logged-in user's own PAT for the project's bound account.
 * Body: { category_id? } — import one area's repo, or omit to import every
 * repo-bound area. See docs/github-integration.md §Import.
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

  const r = await importFromGithub(getSupabase(), gate.email, id, { categoryId });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data);
}
