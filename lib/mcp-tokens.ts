import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { whitelist } from "@/lib/auth";

// Per-user MCP tokens (KANBAN-30, Phase I.5a). A token is a user secret: the DB
// stores ONLY its SHA-256 hash, never the plaintext. The plaintext `mk_…` value
// is returned to the user exactly once at creation and is unrecoverable after.
// A presented bearer is verified by hashing it and matching an active
// (non-revoked, non-expired) row whose user_email is STILL whitelisted.
// See docs/github-integration.md §MCP.

/** Human-recognisable prefix so a leaked token is identifiable as a mykan MCP key. */
export const MCP_TOKEN_PREFIX = "mk_";

/** SHA-256 hex of a presented token — what we persist and look up. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Mint a fresh token. Returns the plaintext (show once, then discard) and its
 * hash (persist this). 32 random bytes → ~256 bits of entropy, base64url so the
 * value is header-safe.
 */
export function generateToken(): { token: string; hash: string } {
  const token = MCP_TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

/** A shape looks like one of our tokens (cheap pre-check before a DB hit). */
export function looksLikeMcpToken(presented: string): boolean {
  return presented.startsWith(MCP_TOKEN_PREFIX);
}

type TokenRow = {
  id: string;
  user_email: string;
  expires_at: string | null;
  revoked_at: string | null;
};

/**
 * Verify a presented bearer as a per-user MCP token. Returns the resolved,
 * lowercased user_email when the token is active (not revoked, not expired) AND
 * that email is still on the whitelist; otherwise null. Bumps last_used_at as a
 * best-effort side effect (never blocks the call).
 *
 * The lookup is by exact hash match (unique-indexed). We still constant-time
 * compare the stored hash against the recomputed one as defence-in-depth.
 */
export async function verifyMcpToken(
  sb: SupabaseClient,
  presented: string,
): Promise<string | null> {
  if (!presented) return null;
  const hash = hashToken(presented);

  const { data, error } = await sb
    .from("mcp_tokens")
    .select("id, user_email, expires_at, revoked_at, token_hash")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error || !data) return null;

  const row = data as TokenRow & { token_hash: string };
  // Defence-in-depth: the eq() already matched, but compare in constant time.
  if (!safeEqualHex(row.token_hash, hash)) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return null;

  const email = row.user_email.trim().toLowerCase();
  if (!whitelist().includes(email)) return null;

  // Best-effort last-used bump; ignore failures.
  void sb
    .from("mcp_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(
      () => {},
      () => {},
    );

  return email;
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}
