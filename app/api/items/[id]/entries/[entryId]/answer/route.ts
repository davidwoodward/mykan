import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { coreResponse, gateEntry } from "@/lib/api-entries";
import { answerQuestion, entryLengthError } from "@/lib/item-entries";

type Ctx = { params: Promise<{ id: string; entryId: string }> };

/**
 * Answer an open question: `{ body }` records a new decision and links it;
 * `{ decision_id }` links an existing active decision on the same item.
 * Exactly one of the two.
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id, entryId } = await params;
  const g = await gateEntry(id, entryId);
  if ("error" in g) return g.error;

  const body = (await req.json().catch(() => ({}))) as {
    body?: unknown;
    decision_id?: unknown;
  };
  const decisionId = typeof body.decision_id === "string" ? body.decision_id.trim() : "";
  if (decisionId && body.body !== undefined) {
    return NextResponse.json({ error: "pass either decision_id or body" }, { status: 400 });
  }
  if (!decisionId) {
    const capErr = entryLengthError(body.body);
    if (capErr) return NextResponse.json({ error: capErr }, { status: 400 });
  }
  return coreResponse(
    await answerQuestion(
      getSupabase(),
      g.email,
      g.entry.id,
      decisionId ? { decisionId } : { body: body.body },
      "web",
    ),
  );
}
