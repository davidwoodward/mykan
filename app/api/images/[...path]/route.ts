import { NextResponse } from "next/server";
import { getSupabase, ITEM_IMAGES_BUCKET } from "@/lib/supabase-server";
import { denyItemAccess, requireSession } from "@/lib/api-auth";

type Ctx = { params: Promise<{ path: string[] }> };

// Streams an item image back to the browser, gated behind the same session as
// everything else. The path segments map directly to the storage key
// (e.g. /api/images/<itemId>/<file>.png → bucket key "<itemId>/<file>.png").
export async function GET(_req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;

  const { path } = await params;
  const key = path.join("/");

  // The first path segment is the owning item id; gate by its project's
  // visibility so a private project's images can't be fetched by URL.
  const deny = await denyItemAccess(path[0], gate.email);
  if (deny) return deny;

  const { data, error } = await getSupabase()
    .storage.from(ITEM_IMAGES_BUCKET)
    .download(key);
  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new Response(data.stream(), {
    headers: {
      "Content-Type": data.type || "application/octet-stream",
      // Immutable: stored keys are random UUIDs, so contents never change.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
