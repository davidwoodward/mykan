import { getSupabase } from "@/lib/supabase-server";
import { requireSession } from "@/lib/api-auth";
import { confirmFocusReview } from "@/lib/focus-core";
import { respond } from "../http";

/** "Confirm as is": clears the review until the next trigger. */
export async function POST() {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  return respond(await confirmFocusReview(getSupabase(), gate.email));
}
