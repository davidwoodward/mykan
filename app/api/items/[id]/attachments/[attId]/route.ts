import { NextResponse } from "next/server";
import {
  getSupabase,
  ITEM_ATTACHMENTS_BUCKET,
} from "@/lib/supabase-server";
import { requireSession } from "@/lib/api-auth";
import type { Attachment } from "@/lib/types";

type Ctx = { params: Promise<{ id: string; attId: string }> };

async function loadAttachments(id: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("items")
    .select("attachments")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  const list: Attachment[] = Array.isArray(data.attachments) ? data.attachments : [];
  return { supabase, list };
}

// Rename an attachment.
export async function PATCH(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id, attId } = await params;

  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const loaded = await loadAttachments(id);
  if (!loaded) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  if (!loaded.list.some((a) => a.id === attId)) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }
  const next = loaded.list.map((a) => (a.id === attId ? { ...a, name } : a));

  const { data, error } = await loaded.supabase
    .from("items")
    .update({ attachments: next, updated_at: new Date().toISOString(), updated_by: gate.email })
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// Remove an attachment: delete its bytes, then drop it from the array.
export async function DELETE(_req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id, attId } = await params;

  const loaded = await loadAttachments(id);
  if (!loaded) return NextResponse.json({ error: "Item not found" }, { status: 404 });
  const target = loaded.list.find((a) => a.id === attId);
  if (!target) {
    return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  }

  await loaded.supabase.storage.from(ITEM_ATTACHMENTS_BUCKET).remove([target.path]);
  const next = loaded.list.filter((a) => a.id !== attId);

  const { data, error } = await loaded.supabase
    .from("items")
    .update({ attachments: next, updated_at: new Date().toISOString(), updated_by: gate.email })
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
