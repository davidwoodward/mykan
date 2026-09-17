import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { denyItemAccess, requireSession } from "@/lib/api-auth";
import { coreResponse } from "@/lib/api-entries";
import { addEntry, entryLengthError, listCardEntries } from "@/lib/item-entries";

type Ctx = { params: Promise<{ id: string }> };

/**
 * The card page's entries (KANBAN-38), newest first, deleted ones included
 * (the panels show them in a collapsed "Deleted" group so they can be
 * restored). Every open question and active decision is always on the first
 * page; the rest is paged: `?before=<cursor>` loads older (listCardEntries).
 * Returns { entries, hasMore, before }.
 */
export async function GET(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const deny = await denyItemAccess(id, gate.email);
  if (deny) return deny;
  return coreResponse(
    await listCardEntries(getSupabase(), gate.email, id, {
      before: new URL(req.url).searchParams.get("before"),
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
