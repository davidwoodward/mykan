import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { denyItemAccess, requireSession } from "@/lib/api-auth";
import { coreResponse } from "@/lib/api-entries";
import {
  ENTRY_LIST_MAX_LIMIT,
  addEntry,
  entryLengthError,
  listEntries,
} from "@/lib/item-entries";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The card page's entries (KANBAN-38): every progress note, question and
 * decision on the item, deleted ones included (the panels show them in a
 * collapsed "Deleted" group so they can be restored), newest first.
 */
export async function GET(_req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const deny = await denyItemAccess(id, gate.email);
  if (deny) return deny;
  return coreResponse(
    await listEntries(getSupabase(), gate.email, id, {
      limit: ENTRY_LIST_MAX_LIMIT,
      includeDeleted: true,
    }),
  );
}

/** Add a progress note, question or decision from the web. */
export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const deny = await denyItemAccess(id, gate.email);
  if (deny) return deny;

  const body = (await req.json().catch(() => ({}))) as { kind?: unknown; body?: unknown };
  const capErr = entryLengthError(body.body);
  if (capErr) return NextResponse.json({ error: capErr }, { status: 400 });
  return coreResponse(
    await addEntry(getSupabase(), gate.email, id, { kind: body.kind, body: body.body }, "web"),
    201,
  );
}
