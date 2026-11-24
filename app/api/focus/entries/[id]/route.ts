import { getSupabase } from "@/lib/supabase-server";
import { requireSession } from "@/lib/api-auth";
import { completeFocusEntry, dropFocusEntry, updateFocusEntry } from "@/lib/focus-core";
import { bodyOf, respond } from "../../http";

type Ctx = { params: Promise<{ id: string }> };

/** { complete: true } ticks the entry off; otherwise edits label / why_now / target_date. */
export async function PATCH(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  const b = await bodyOf(req);
  if (b.complete === true) return respond(await completeFocusEntry(getSupabase(), gate.email, id));
  const patch: { label?: unknown; why_now?: unknown; target_date?: unknown } = {};
  if ("label" in b) patch.label = b.label;
  if ("why_now" in b) patch.why_now = b.why_now;
  if ("target_date" in b) patch.target_date = b.target_date;
  return respond(await updateFocusEntry(getSupabase(), gate.email, id, patch));
}

/** Drop the entry from the list; the card itself is untouched. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;
  return respond(await dropFocusEntry(getSupabase(), gate.email, id));
}
