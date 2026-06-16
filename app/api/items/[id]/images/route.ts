import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSupabase, ITEM_IMAGES_BUCKET } from "@/lib/supabase-server";
import { denyItemAccess, requireSession } from "@/lib/api-auth";

type Ctx = { params: Promise<{ id: string }> };

// Vercel serverless request bodies cap around 4.5 MB; stay safely under it.
const MAX_BYTES = 4 * 1024 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
};

// Accepts the raw image bytes (Content-Type: image/*) and stores them under the
// item's folder in the private bucket. Returns a URL pointing at our authed
// image-serving route — the browser never talks to Supabase Storage directly.
export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const deny = await denyItemAccess(id, gate.email);
  if (deny) return deny;

  const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  const ext = EXT_BY_TYPE[contentType];
  if (!ext) {
    return NextResponse.json(
      { error: "Unsupported image type" },
      { status: 415 },
    );
  }

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }
  if (bytes.byteLength > MAX_BYTES) {
    return NextResponse.json(
      { error: "Image too large (max 4 MB)" },
      { status: 413 },
    );
  }

  const path = `${id}/${randomUUID()}.${ext}`;
  const { error } = await getSupabase()
    .storage.from(ITEM_IMAGES_BUCKET)
    .upload(path, bytes, { contentType, upsert: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ url: `/api/images/${path}` }, { status: 201 });
}
