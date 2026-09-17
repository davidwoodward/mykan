import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { coreResponse, gateEntry } from "@/lib/api-entries";
import { entryLengthError, supersedeEntry } from "@/lib/item-entries";

type Ctx = { params: Promise<{ id: string; entryId: string }> };

/**
 * Supersede a decision (or progress note) with a new entry of the same kind:
 * the new one is created, the older one is marked superseded (kept, versioned).
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id, entryId } = await params;
  const g = await gateEntry(id, entryId);
  if ("error" in g) return g.error;

  const body = (await req.json().catch(() => ({}))) as { body?: unknown };
  const capErr = entryLengthError(body.body);
  if (capErr) return NextResponse.json({ error: capErr }, { status: 400 });
  return coreResponse(
    await supersedeEntry(getSupabase(), g.email, g.entry.id, { body: body.body }, "web"),
    201,
  );
}
