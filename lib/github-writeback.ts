import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptPat, isGithubCryptoConfigured } from "@/lib/github-crypto";
import { setIssueState } from "@/lib/github";
import { parseGithubIssue, type GithubSync, type ItemStatus } from "@/lib/types";

/**
 * GH-5 write-back — the "out" half of the Done⇄issue loop
 * (docs/github-integration.md §Write-back). Kept separate from lib/github-core.ts
 * (import) so it can be called from the item write paths (REST PATCH + MCP
 * setItemStatus) without pulling in that module's item-creation dependency.
 */

/** The GitHub issue state a mykan status implies: Done ⇒ closed, everything else ⇒ open. */
export function desiredIssueState(status: ItemStatus): "open" | "closed" {
  return status === "done" ? "closed" : "open";
}

/**
 * True only when a transition crosses the Done boundary (Done→other or other→Done)
 * — the sole moment the desired issue state changes, and thus the only time we
 * bother writing back. Moves between two non-Done statuses leave the issue open.
 */
export function crossesDoneBoundary(prev: ItemStatus, next: ItemStatus): boolean {
  return prev !== next && (prev === "done" || next === "done");
}

/** Flip the actor's credential to `invalid` after GitHub rejects it (401/403). */
async function markCredentialInvalid(
  sb: SupabaseClient,
  userEmail: string,
  accountId: string,
): Promise<void> {
  await sb
    .from("github_credentials")
    .update({ status: "invalid", updated_at: new Date().toISOString() })
    .eq("account_id", accountId)
    .eq("user_email", userEmail);
}

/**
 * Reconcile a linked GitHub issue to `state` using the ACTOR's own PAT (never
 * borrowed). Best-effort by contract: this NEVER throws and its caller must NEVER
 * block or roll back the mykan status change on its result. Returns the flag to
 * store on `items.github_sync`:
 *
 *   - `null`     — success, or a harmless no-op (issue already in `state`).
 *   - `'no_pat'` — the actor has no usable PAT for the account → write skipped.
 *   - `'failed'` — GitHub rejected the token / was unreachable → retry-able.
 *
 * The account is resolved from the backlink owner (import composes the backlink as
 * `<account.login>/<repo>#<n>`, so the owner IS the account login).
 */
export async function pushIssueState(
  sb: SupabaseClient,
  actor: string,
  backlink: string | null,
  state: "open" | "closed",
): Promise<GithubSync> {
  const parsed = parseGithubIssue(backlink);
  if (!parsed) return null; // no/garbled backlink — nothing to write back
  if (!isGithubCryptoConfigured()) return "no_pat"; // can't decrypt any PAT
  const { owner, repo, number } = parsed;

  const { data: acct } = await sb
    .from("github_accounts")
    .select("id")
    .ilike("login", owner)
    .maybeSingle();
  if (!acct) return "no_pat";
  const accountId = (acct as { id: string }).id;

  const { data: cred } = await sb
    .from("github_credentials")
    .select("encrypted_pat, status")
    .eq("account_id", accountId)
    .eq("user_email", actor)
    .maybeSingle();
  const row = cred as { encrypted_pat: string; status: string } | null;
  if (!row || row.status === "invalid") return "no_pat";

  let pat: string;
  try {
    pat = decryptPat(row.encrypted_pat);
  } catch {
    return "no_pat"; // a ciphertext we can't decrypt is an unusable credential
  }

  const res = await setIssueState(pat, owner, repo, number, state);
  if (res.ok) return null;
  if (res.authFailed) await markCredentialInvalid(sb, actor, accountId);
  return "failed";
}

/**
 * Reconcile after a status change, but only when the Done boundary was crossed.
 * Returns the sync flag to persist, or `undefined` when nothing was owed (the
 * caller should then leave `github_sync` untouched — a non-boundary move must not
 * clear an existing not-synced flag). See {@link crossesDoneBoundary}.
 */
export async function writeBackOnStatusChange(
  sb: SupabaseClient,
  actor: string,
  backlink: string | null,
  prev: ItemStatus,
  next: ItemStatus,
): Promise<GithubSync | undefined> {
  if (!backlink || !crossesDoneBoundary(prev, next)) return undefined;
  return pushIssueState(sb, actor, backlink, desiredIssueState(next));
}
