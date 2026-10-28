import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { denyItemAccess, requireSession } from "@/lib/api-auth";
import { moveEpicChild } from "@/lib/epic-reorder-core";
import type { EpicMoveTarget } from "@/lib/epic-order";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Move a card within its epic's status group (KANBAN-68). Body: `{before: id}`,
 * `{after: id}`, or `{to: "top" | "bottom"}`. Edits only the epic's own order
 * (epic_position), never the board's.
 */
export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const deny = await denyItemAccess(id, gate.email);
  if (deny) return deny;

  const body = (await req.json().catch(() => ({}))) as {
    before?: unknown;
    after?: unknown;
    to?: unknown;
  };
  let target: EpicMoveTarget;
  if (typeof body.before === "string" && body.before) target = { before: body.before };
  else if (typeof body.after === "string" && body.after) target = { after: body.after };
  else if (body.to === "top" || body.to === "bottom") target = { to: body.to };
  else return NextResponse.json({ error: "Give before, after or to" }, { status: 400 });

  const r = await moveEpicChild(getSupabase(), gate.email, id, target);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data);
}
