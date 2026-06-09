import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { requireSession } from "@/lib/api-auth";
import {
  isItemType,
  isRichDoc,
  paragraphDoc,
  richDocText,
  type ItemType,
} from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

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

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    type?: unknown;
    body?: unknown;
  };
  const type: ItemType = isItemType(body.type) ? body.type : "feature";
  // The body is the source of truth. An explicit doc wins; otherwise seed one
  // from the typed text. `name` is the flattened text, kept for display/hygiene.
  const doc = isRichDoc(body.body)
    ? body.body
    : paragraphDoc(typeof body.name === "string" ? body.name : "");
  const name = richDocText(doc);

  const supabase = getSupabase();
  const { data: tail } = await supabase
    .from("items")
    .select("position")
    .eq("project_id", id)
    .eq("status", "new")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = (tail?.position ?? 0) + 1024;

  const { data, error } = await supabase
    .from("items")
    .insert({
      project_id: id,
      name,
      body: doc,
      type,
      status: "new",
      position,
      created_by: gate.email,
      updated_by: gate.email,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
