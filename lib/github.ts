import "server-only";

/**
 * Thin GitHub REST client (KANBAN-19). Kept deliberately small and isolated so a
 * future move to a GitHub App only has to touch this module. All calls are
 * server-side with a per-user PAT — see docs/github-integration.md §Authentication.
 */
const GITHUB_API = "https://api.github.com";

function githubHeaders(pat: string): HeadersInit {
  return {
    Authorization: `Bearer ${pat}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export interface GithubValidation {
  ok: boolean;
  /** Canonical account login (correct casing), when the account was found. */
  login?: string;
  /** PAT expiry as ISO, if GitHub reported one; null otherwise. */
  expiresAt: string | null;
  /** User-facing reason when `ok` is false. */
  error?: string;
}

/**
 * Validate a PAT for a given account/owner login:
 *   1. GET /user       — is the token itself valid? (401/403 → rejected)
 *   2. GET /users/{login} — does that account exist, and what is its canonical login?
 * Returns the canonical login to store, so we never trust the user-typed name.
 */
export async function validateGithubConnection(
  pat: string,
  account: string,
): Promise<GithubValidation> {
  let me: Response;
  try {
    me = await fetch(`${GITHUB_API}/user`, { headers: githubHeaders(pat) });
  } catch {
    return { ok: false, expiresAt: null, error: "Couldn’t reach GitHub — try again." };
  }
  if (me.status === 401 || me.status === 403) {
    return {
      ok: false,
      expiresAt: null,
      error: "GitHub rejected that token. Check it hasn’t expired and grants Metadata: read.",
    };
  }
  if (!me.ok) {
    return { ok: false, expiresAt: null, error: `GitHub error (${me.status}).` };
  }
  const expiresAt = parseExpiry(me.headers.get("github-authentication-token-expiration"));

  const acct = await fetch(`${GITHUB_API}/users/${encodeURIComponent(account)}`, {
    headers: githubHeaders(pat),
  });
  if (acct.status === 404) {
    return { ok: false, expiresAt, error: `No GitHub account “${account}” found.` };
  }
  if (!acct.ok) {
    return { ok: false, expiresAt, error: `Couldn’t verify “${account}” (${acct.status}).` };
  }
  const data = (await acct.json()) as { login?: string };
  return { ok: true, login: data.login ?? account, expiresAt };
}

/**
 * GitHub reports token expiry in the `github-authentication-token-expiration`
 * header (present for expiring PATs), e.g. "2026-07-13 20:00:00 UTC". Returns an
 * ISO string, or null when absent/unparseable.
 */
function parseExpiry(header: string | null): string | null {
  if (!header) return null;
  const d = new Date(header.replace(" UTC", " +0000"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
