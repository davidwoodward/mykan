import { NextResponse } from "next/server";
import {
  getSupabase,
  ITEM_ATTACHMENTS_BUCKET,
} from "@/lib/supabase-server";
import { denyItemAccess, requireSession } from "@/lib/api-auth";
import type { Attachment } from "@/lib/types";

type Ctx = { params: Promise<{ id: string; attId: string }> };

// Streams an attachment's bytes. `?download=1` forces a download; otherwise the
// browser renders it inline (its native viewer) where it can. Gated by session.
export async function GET(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id, attId } = await params;

  const deny = await denyItemAccess(id, gate.email);
  if (deny) return deny;

  const supabase = getSupabase();
  const { data: row, error } = await supabase
    .from("items")
    .select("attachments")
    .eq("id", id)
    .single();
  if (error || !row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const list: Attachment[] = Array.isArray(row.attachments) ? row.attachments : [];
  const att = list.find((a) => a.id === attId);
  if (!att) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: blob, error: dlErr } = await supabase
    .storage.from(ITEM_ATTACHMENTS_BUCKET)
    .download(att.path);
  if (dlErr || !blob) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const download = new URL(req.url).searchParams.get("download") === "1";
  const disposition = download ? "attachment" : "inline";
  // RFC 5987 filename* for non-ASCII names, with a plain fallback.
  const fallback = att.name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");

  return new Response(blob.stream(), {
    headers: {
      "Content-Type": att.content_type || "application/octet-stream",
      "Content-Disposition": `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(att.name)}`,
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
