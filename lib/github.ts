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

/** One open GitHub issue, reduced to the fields import maps into an item. */
export interface GithubIssue {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  html_url: string;
}

export type ListIssuesResult =
  | { ok: true; issues: GithubIssue[] }
  | {
      ok: false;
      /** HTTP status GitHub returned (0 for a network failure). */
      status: number;
      /** True on 401/403 — the caller should mark the credential invalid. */
      authFailed: boolean;
      error: string;
    };

/** The `/issues` endpoint returns PRs too; those carry a `pull_request` key. */
interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  pull_request?: unknown;
  labels?: ({ name?: string } | string)[];
}

/**
 * List a repo's OPEN issues (pull requests excluded), following pagination up to
 * a sane cap. Read-only; uses the caller's PAT. A 401/403 sets `authFailed` so
 * the caller can flip the credential to `invalid` and prompt a reconnect.
 */
export async function listOpenIssues(
  pat: string,
  owner: string,
  repo: string,
): Promise<ListIssuesResult> {
  const issues: GithubIssue[] = [];
  const PER_PAGE = 100;
  const MAX_PAGES = 20; // hard cap: up to 2000 open issues per import
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url =
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
      `/issues?state=open&per_page=${PER_PAGE}&page=${page}`;
    let res: Response;
    try {
      res = await fetch(url, { headers: githubHeaders(pat) });
    } catch {
      return { ok: false, status: 0, authFailed: false, error: "Couldn’t reach GitHub — try again." };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        status: res.status,
        authFailed: true,
        error: "GitHub rejected your token — reconnect your account.",
      };
    }
    if (res.status === 404) {
      return {
        ok: false,
        status: 404,
        authFailed: false,
        error: `No repo “${owner}/${repo}” (or your token can’t see it).`,
      };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, authFailed: false, error: `GitHub error (${res.status}).` };
    }
    const batch = (await res.json().catch(() => [])) as RawIssue[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const raw of batch) {
      if (raw.pull_request) continue; // PRs share the issues endpoint — skip them
      issues.push({
        number: raw.number,
        title: raw.title ?? "",
        body: raw.body ?? null,
        html_url: raw.html_url ?? "",
        labels: (raw.labels ?? [])
          .map((l) => (typeof l === "string" ? l : l?.name ?? ""))
          .filter(Boolean),
      });
    }
    if (batch.length < PER_PAGE) break; // last page
  }
  return { ok: true, issues };
}

export type ListReposResult =
  | { ok: true; repos: string[] }
  | { ok: false; status: number; authFailed: boolean; error: string };

interface RawRepo {
  name: string;
  archived?: boolean;
  owner?: { login?: string };
}

/**
 * List the (non-archived) repo names under `owner` that the caller's PAT can
 * see — for the area→repo binding picker. Uses `/user/repos` (which returns
 * everything a fine-grained PAT was granted, across affiliations) and filters to
 * the bound account's owner. A 401/403 sets `authFailed` like {@link listOpenIssues}.
 */
export async function listAccessibleRepos(
  pat: string,
  owner: string,
): Promise<ListReposResult> {
  const names: string[] = [];
  const PER_PAGE = 100;
  const MAX_PAGES = 10;
  const target = owner.toLowerCase();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${GITHUB_API}/user/repos?per_page=${PER_PAGE}&page=${page}&sort=full_name`;
    let res: Response;
    try {
      res = await fetch(url, { headers: githubHeaders(pat) });
    } catch {
      return { ok: false, status: 0, authFailed: false, error: "Couldn’t reach GitHub — try again." };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, authFailed: true, error: "GitHub rejected your token." };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, authFailed: false, error: `GitHub error (${res.status}).` };
    }
    const batch = (await res.json().catch(() => [])) as RawRepo[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const r of batch) {
      if (r.archived) continue;
      if ((r.owner?.login ?? "").toLowerCase() === target && r.name) names.push(r.name);
    }
    if (batch.length < PER_PAGE) break;
  }
  names.sort((a, b) => a.localeCompare(b));
  return { ok: true, repos: names };
}
