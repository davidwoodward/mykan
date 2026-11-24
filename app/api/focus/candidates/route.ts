import { getSupabase } from "@/lib/supabase-server";
import { requireSession } from "@/lib/api-auth";
import { focusCandidates } from "@/lib/focus-core";
import { respond } from "../http";

/** Cards the caller can put on their list, for the add picker. */
export async function GET() {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  return respond(await focusCandidates(getSupabase(), gate.email));
}
