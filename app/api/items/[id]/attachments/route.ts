import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  getSupabase,
  ITEM_ATTACHMENTS_BUCKET,
} from "@/lib/supabase-server";
import { denyItemAccess, requireSession } from "@/lib/api-auth";
import type { Attachment } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

// Confirms an attachment after its bytes were uploaded via a signed URL (see
// ./sign). Records the metadata on the item and returns the updated item.
export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const deny = await denyItemAccess(id, gate.email);
  if (deny) return deny;

  const body = (await req.json().catch(() => ({}))) as {
    path?: unknown;
    name?: unknown;
    content_type?: unknown;
    size?: unknown;
  };
  const path = typeof body.path === "string" ? body.path : "";
  // The path must live inside this item's folder — don't let a client point at
  // another item's (or an arbitrary) storage key.
  if (!path.startsWith(`${id}/`)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  const name = (typeof body.name === "string" ? body.name.trim() : "").slice(0, 200) || "file";
  const content_type =
    typeof body.content_type === "string" ? body.content_type : "application/octet-stream";
  const size =
    typeof body.size === "number" && Number.isFinite(body.size) ? body.size : 0;

  const supabase = getSupabase();

  const { data: row, error: readErr } = await supabase
    .from("items")
    .select("attachments")
    .eq("id", id)
    .single();
  if (readErr || !row) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const attachment: Attachment = {
    id: randomUUID(),
    name,
    content_type,
    size,
    path,
  };
  const current = Array.isArray(row.attachments) ? row.attachments : [];
  const next = [...current, attachment];

  const { data, error } = await supabase
    .from("items")
    .update({ attachments: next, updated_at: new Date().toISOString(), updated_by: gate.email })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    await supabase.storage.from(ITEM_ATTACHMENTS_BUCKET).remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
