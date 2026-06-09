import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  getSupabase,
  ITEM_ATTACHMENTS_BUCKET,
} from "@/lib/supabase-server";
import { requireSession } from "@/lib/api-auth";

type Ctx = { params: Promise<{ id: string }> };

// Issues a signed URL the browser can PUT a file's bytes to directly, under a
// server-chosen path inside the item's folder. Keeps large files off the
// serverless function (no 4.5 MB body limit).
export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name : "file";
  const ext = name.includes(".") ? name.split(".").pop() : undefined;
  const path = `${id}/${randomUUID()}${ext ? `.${ext}` : ""}`;

  const { data, error } = await getSupabase()
    .storage.from(ITEM_ATTACHMENTS_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Could not sign upload" },
      { status: 500 },
    );
  }

  const uploadUrl = `${process.env.SUPABASE_URL}/storage/v1/object/upload/sign/${ITEM_ATTACHMENTS_BUCKET}/${path}?token=${data.token}`;
  return NextResponse.json({ path, uploadUrl });
}
