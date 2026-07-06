import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { loadProjectForAccess, requireSession } from "@/lib/api-auth";
import { createItem } from "@/lib/items-core";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const access = await loadProjectForAccess(id, gate.email);
  if (access.error) return access.error;

  const { data, error } = await getSupabase()
    .from("items")
    .select("*")
    .eq("project_id", id)
    .order("position", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const access = await loadProjectForAccess(id, gate.email);
  if (access.error) return access.error;

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    type?: unknown;
    body?: unknown;
    tags?: unknown;
    category_id?: unknown;
    position?: unknown;
  };
  const r = await createItem(getSupabase(), gate.email, id, {
    name: body.name,
    type: body.type,
    body: body.body,
    tags: body.tags,
    category_id: body.category_id,
    position: body.position,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 201 });
}
