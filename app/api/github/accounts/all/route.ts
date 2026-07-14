import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getSupabase } from "@/lib/supabase-server";

/**
 * GET — all registered GitHub accounts (id + login), for the project→account
 * picker. The binding is global, so this lists every connected account, not just
 * the current user's. No credentials are exposed.
 */
export async function GET() {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;

  const { data, error } = await getSupabase()
    .from("github_accounts")
    .select("id, login")
    .order("login");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ accounts: data ?? [] });
}
