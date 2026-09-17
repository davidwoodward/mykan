import { getSupabase } from "@/lib/supabase-server";
import { coreResponse, gateEntry } from "@/lib/api-entries";
import { undeleteEntry } from "@/lib/item-entries";

type Ctx = { params: Promise<{ id: string; entryId: string }> };

/** Bring back a soft-deleted entry (versioned). */
export async function POST(_req: Request, { params }: Ctx) {
  const { id, entryId } = await params;
  const g = await gateEntry(id, entryId);
  if ("error" in g) return g.error;
  return coreResponse(await undeleteEntry(getSupabase(), g.email, g.entry.id, "web"));
}
