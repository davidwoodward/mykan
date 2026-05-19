import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { requireSession } from "@/lib/api-auth";
import { isItemStatus, isItemType } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    type?: unknown;
    status?: unknown;
    position?: unknown;
  };
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string") patch.name = body.name.trim();
  if (isItemType(body.type)) patch.type = body.type;
  if (isItemStatus(body.status)) patch.status = body.status;
  if (typeof body.position === "number" && Number.isFinite(body.position)) {
    patch.position = body.position;
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

  const { error } = await getSupabase().from("items").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
