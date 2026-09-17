import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { coreResponse, editSessionOf, gateEntry } from "@/lib/api-entries";
import { deleteEntry, editEntry, entryLengthError } from "@/lib/item-entries";

type Ctx = { params: Promise<{ id: string; entryId: string }> };

/**
 * Edit an entry's text (and/or state). The web editor saves ONCE when editing
 * finishes and sends its per-open `edit_session`; should one open save twice
 * (a keepalive save on leaving that landed, then the finish), body-only saves
 * of the same session fold into one version (coalescesIntoLatest).
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, entryId } = await params;
  const g = await gateEntry(id, entryId);
  if ("error" in g) return g.error;

  const body = (await req.json().catch(() => ({}))) as {
    body?: unknown;
    state?: unknown;
    edit_session?: unknown;
  };
  if (body.body !== undefined) {
    const capErr = entryLengthError(body.body);
    if (capErr) return NextResponse.json({ error: capErr }, { status: 400 });
  }
  return coreResponse(
    await editEntry(
      getSupabase(),
      g.email,
      g.entry.id,
      { body: body.body, state: body.state },
      "web",
      editSessionOf(body.edit_session),
    ),
  );
}

/** Soft-delete an entry (versioned; restorable). */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, entryId } = await params;
  const g = await gateEntry(id, entryId);
  if ("error" in g) return g.error;
  return coreResponse(await deleteEntry(getSupabase(), g.email, g.entry.id, "web"));
}
