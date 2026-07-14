import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getSupabase } from "@/lib/supabase-server";

/**
 * DELETE — disconnect the current user's credential for one account. Removes ONLY
 * this user's credential; the shared account row and other users' credentials are
 * left intact (see docs/github-integration.md §Core model).
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const { error } = await getSupabase()
    .from("github_credentials")
    .delete()
    .eq("account_id", id)
    .eq("user_email", gate.email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
