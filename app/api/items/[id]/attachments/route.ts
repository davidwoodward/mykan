import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  getSupabase,
  ITEM_ATTACHMENTS_BUCKET,
} from "@/lib/supabase-server";
import { requireSession } from "@/lib/api-auth";
import type { Attachment } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

// Vercel serverless request bodies cap around 4.5 MB; stay safely under it.
const MAX_BYTES = 4 * 1024 * 1024;

// Uploads one file's raw bytes (Content-Type: the file's type, X-File-Name: its
// original name) into the item's folder in the private bucket, then appends its
// metadata to the item's attachments array. Returns the updated item.
export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const contentType =
    (req.headers.get("content-type") ?? "").split(";")[0].trim() ||
    "application/octet-stream";
  const rawName = req.headers.get("x-file-name");
  const name = (rawName ? safeDecode(rawName) : "").trim() || "file";

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }
  if (bytes.byteLength > MAX_BYTES) {
    return NextResponse.json(
      { error: "File too large (max 4 MB)" },
      { status: 413 },
    );
  }

  const supabase = getSupabase();

  const { data: row, error: readErr } = await supabase
    .from("items")
    .select("attachments")
    .eq("id", id)
    .single();
  if (readErr || !row) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const ext = name.includes(".") ? name.split(".").pop() : undefined;
  const path = `${id}/${randomUUID()}${ext ? `.${ext}` : ""}`;
  const { error: upErr } = await supabase
    .storage.from(ITEM_ATTACHMENTS_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const attachment: Attachment = {
    id: randomUUID(),
    name,
    content_type: contentType,
    size: bytes.byteLength,
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
    // Roll back the orphaned object so storage doesn't drift from metadata.
    await supabase.storage.from(ITEM_ATTACHMENTS_BUCKET).remove([path]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}
