import { getSupabase } from "@/lib/supabase-server";
import { requireSession } from "@/lib/api-auth";
import { getFocusSettings, updateFocusSettings } from "@/lib/focus-core";
import { bodyOf, respond } from "../http";

export async function GET() {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  return respond(await getFocusSettings(getSupabase(), gate.email));
}

/** Change the caller's focus settings; turning it on creates the personal project once. */
export async function PATCH(req: Request) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  return respond(await updateFocusSettings(getSupabase(), gate.email, await bodyOf(req)));
}
