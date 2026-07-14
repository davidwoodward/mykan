import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getSupabase } from "@/lib/supabase-server";

/**
 * DELETE — revoke one of the current user's MCP tokens (KANBAN-30). Sets
 * revoked_at so the verify path rejects it immediately; scoped to the signed-in
 * user's own tokens (and only ones not already revoked). We keep the row for the
 * audit trail rather than hard-deleting.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const { data, error } = await getSupabase()
    .from("mcp_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_email", gate.email)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
