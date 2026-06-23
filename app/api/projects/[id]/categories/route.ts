import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { loadProjectForAccess, requireSession } from "@/lib/api-auth";
import { findOrCreateByPath, listCategories } from "@/lib/categories-core";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const access = await loadProjectForAccess(id, gate.email);
  if (access.error) return access.error;
  return NextResponse.json(await listCategories(getSupabase(), id));
}

// Create (or find) the node at the end of a "/"-separated path.
export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const access = await loadProjectForAccess(id, gate.email);
  if (access.error) return access.error;

  const body = (await req.json().catch(() => ({}))) as { path?: unknown };
  if (typeof body.path !== "string") {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }
  const r = await findOrCreateByPath(getSupabase(), id, body.path, gate.email);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 201 });
}
