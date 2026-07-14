import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getSupabase } from "@/lib/supabase-server";
import { generateToken } from "@/lib/mcp-tokens";
import type { McpTokenSummary } from "@/lib/types";

// Per-user MCP token management (KANBAN-30). Human-UI-only — deliberately NOT an
// MCP tool (an agent must never mint its own credential). Each route is
// session-gated and scoped to the signed-in user; the plaintext token is
// returned exactly once, at creation.

/** GET — the current user's active (non-revoked) MCP tokens. Never the plaintext. */
export async function GET() {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;

  const { data, error } = await getSupabase()
    .from("mcp_tokens")
    .select("id, label, created_at, last_used_at, expires_at")
    .eq("user_email", gate.email)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tokens = (data ?? []) as McpTokenSummary[];
  return NextResponse.json({ tokens });
}

/**
 * POST — mint a new token for the current user. Body: { label?, expiresInDays? }.
 * Persists only the hash; returns the plaintext ONCE (it is unrecoverable after).
 */
export async function POST(req: Request) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;

  const body = (await req.json().catch(() => ({}))) as {
    label?: unknown;
    expiresInDays?: unknown;
  };
  const label =
    typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : null;

  let expires_at: string | null = null;
  if (typeof body.expiresInDays === "number" && Number.isFinite(body.expiresInDays)) {
    const days = Math.max(1, Math.min(365, Math.floor(body.expiresInDays)));
    expires_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  const { token, hash } = generateToken();

  const { data, error } = await getSupabase()
    .from("mcp_tokens")
    .insert({ user_email: gate.email, token_hash: hash, label, expires_at })
    .select("id, label, created_at, last_used_at, expires_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The one and only time the plaintext is exposed.
  return NextResponse.json({ token, summary: data as McpTokenSummary }, { status: 201 });
}
