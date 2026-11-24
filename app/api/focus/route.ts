import { getSupabase } from "@/lib/supabase-server";
import { requireSession } from "@/lib/api-auth";
import { addFocusEntry, loadFocus } from "@/lib/focus-core";
import { bodyOf, respond } from "./http";

// The caller's own focus list (KANBAN-74). Owner-only: every call acts on the
// signed-in user's list and nothing else.

export async function GET() {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  return respond(await loadFocus(getSupabase(), gate.email));
}

/** Add a card ({ item: "KEY-N" }) or quick-add ({ text }); optional position, why_now, target_date. */
export async function POST(req: Request) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const b = await bodyOf(req);
  return respond(
    await addFocusEntry(getSupabase(), gate.email, {
      item: typeof b.item === "string" ? b.item : undefined,
      text: typeof b.text === "string" ? b.text : undefined,
      position: typeof b.position === "number" ? b.position : undefined,
      label: b.label as string | null | undefined,
      why_now: b.why_now as string | null | undefined,
      target_date: b.target_date as string | null | undefined,
    }),
    201,
  );
}
