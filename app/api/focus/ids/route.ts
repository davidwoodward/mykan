import { getSupabase } from "@/lib/supabase-server";
import { requireSession } from "@/lib/api-auth";
import { activeFocusItemIds } from "@/lib/focus-core";
import { respond } from "../http";

/** The caller's own active focus cards (ids only), for the list and board targets. */
export async function GET() {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const r = await activeFocusItemIds(getSupabase(), gate.email);
  return respond(r.ok ? { ok: true as const, data: { item_ids: r.data } } : r);
}
