import { NextResponse } from "next/server";
import { requireSession, loadProjectForAccess } from "@/lib/api-auth";
import { getSupabase } from "@/lib/supabase-server";
import { listReposForProject } from "@/lib/github-core";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET — repo names under the project's bound GitHub account that the logged-in
 * user's PAT can see, for the area→repo binding picker (KANBAN-23). Returns an
 * empty list (never an error) when no account is bound or no PAT is connected,
 * so the picker degrades to free typing. See docs/github-integration.md.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const access = await loadProjectForAccess(id, gate.email);
  if (access.error) return access.error;

  const r = await listReposForProject(getSupabase(), gate.email, id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data);
}
