import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { requireSession } from "@/lib/api-auth";
import { setFocusOrder } from "@/lib/focus-core";
import { bodyOf, respond } from "../http";

/** Reorder the caller's list: { order: [entry ids or card refs, top first] }. */
export async function PUT(req: Request) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const b = await bodyOf(req);
  if (!Array.isArray(b.order) || !b.order.every((x) => typeof x === "string") || !b.order.length) {
    return NextResponse.json({ error: "order must be a non-empty list of entry ids" }, { status: 400 });
  }
  return respond(await setFocusOrder(getSupabase(), gate.email, b.order as string[]));
}
