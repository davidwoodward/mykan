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

/** One GitHub issue, reduced to the fields import / refresh map into an item. */
export interface GithubIssue {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  html_url: string;
  /** The issue's own creation time on GitHub (ISO), for display in mykan. */
  created_at: string | null;
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
  created_at?: string;
  pull_request?: unknown;
  labels?: ({ name?: string } | string)[];
}

/** Reduce a raw issue payload to the {@link GithubIssue} fields we keep. */
function toGithubIssue(raw: RawIssue): GithubIssue {
  return {
    number: raw.number,
    title: raw.title ?? "",
    body: raw.body ?? null,
    html_url: raw.html_url ?? "",
    created_at: raw.created_at ?? null,
    labels: (raw.labels ?? [])
      .map((l) => (typeof l === "string" ? l : l?.name ?? ""))
      .filter(Boolean),
  };
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
      issues.push(toGithubIssue(raw));
    }
    if (batch.length < PER_PAGE) break; // last page
  }
  return { ok: true, issues };
}

export type GetIssueResult =
  | { ok: true; issue: GithubIssue }
  | { ok: false; status: number; authFailed: boolean; error: string };

/**
 * Fetch a single issue by number — the source of truth for a manual refresh
 * (docs/github-integration.md: a linked item only ever re-syncs from GitHub when
 * a human triggers it). Read-only; uses the caller's PAT. A 401/403 sets
 * `authFailed` so the caller can flip the credential to `invalid`.
 */
export async function getIssue(
  pat: string,
  owner: string,
  repo: string,
  number: number,
): Promise<GetIssueResult> {
  const url =
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    `/issues/${number}`;
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
      error: `Issue ${owner}/${repo}#${number} no longer exists (or your token can’t see it).`,
    };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, authFailed: false, error: `GitHub error (${res.status}).` };
  }
  const raw = (await res.json().catch(() => null)) as RawIssue | null;
  if (!raw || typeof raw.number !== "number") {
    return { ok: false, status: 502, authFailed: false, error: "Unexpected response from GitHub." };
  }
  return { ok: true, issue: toGithubIssue(raw) };
}

export type IssueStateResult =
  | { ok: true }
  | { ok: false; status: number; authFailed: boolean; error: string };

/**
 * Set an issue's open/closed state — the write half of the Done⇄issue loop
 * (docs/github-integration.md §Write-back). Setting the state it already holds is
 * a harmless GitHub no-op (returns 200). A 401/403 sets `authFailed`.
 */
export async function setIssueState(
  pat: string,
  owner: string,
  repo: string,
  number: number,
  state: "open" | "closed",
): Promise<IssueStateResult> {
  const url =
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}` +
    `/issues/${number}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "PATCH",
      headers: { ...githubHeaders(pat), "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
  } catch {
    return { ok: false, status: 0, authFailed: false, error: "Couldn’t reach GitHub — try again." };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, authFailed: true, error: "GitHub rejected your token." };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, authFailed: false, error: `GitHub error (${res.status}).` };
  }
  return { ok: true };
}

export type ListReposResult =
  | { ok: true; repos: string[] }
  | { ok: false; status: number; authFailed: boolean; error: string };

interface RawRepo {
  name: string;
  archived?: boolean;
  owner?: { login?: string };
}

type RepoPageResult =
  | { ok: true; names: string[] }
  | { ok: false; status: number; authFailed: boolean; error: string };

/**
 * Paginate a repos endpoint, collecting non-archived repo names. When `ownerFilter`
 * is set (the cross-owner `/user/repos` case) only repos owned by it are kept; the
 * org endpoint is already owner-scoped so it passes null. A 404 (e.g. the owner is
 * a user, not an org) resolves to an empty page set, not an error.
 */
async function collectRepoNames(
  pat: string,
  path: (page: number) => string,
  ownerFilter: string | null,
): Promise<RepoPageResult> {
  const names: string[] = [];
  const PER_PAGE = 100;
  const MAX_PAGES = 10;
  for (let page = 1; page <= MAX_PAGES; page++) {
    let res: Response;
    try {
      res = await fetch(`${GITHUB_API}${path(page)}`, { headers: githubHeaders(pat) });
    } catch {
      return { ok: false, status: 0, authFailed: false, error: "Couldn’t reach GitHub — try again." };
    }
    if (res.status === 404) break; // owner isn't an org (or no visibility) — treat as empty
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, authFailed: true, error: "GitHub rejected your token." };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, authFailed: false, error: `GitHub error (${res.status}).` };
    }
    const batch = (await res.json().catch(() => [])) as RawRepo[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const r of batch) {
      if (r.archived || !r.name) continue;
      if (ownerFilter && (r.owner?.login ?? "").toLowerCase() !== ownerFilter) continue;
      names.push(r.name);
    }
    if (batch.length < PER_PAGE) break;
  }
  return { ok: true, names };
}

/**
 * List the (non-archived) repo names under `owner` that the caller's PAT can see —
 * for the area→repo binding picker. Queries BOTH `/user/repos` (filtered to the
 * owner; covers personal accounts and repos surfaced by affiliation) AND
 * `/orgs/{owner}/repos` (covers an ORG account reached via a member's PAT, whose
 * repos don't always appear under `/user/repos`), then unions the names. A 401/403
 * on either sets `authFailed` like {@link listOpenIssues}.
 */
export async function listAccessibleRepos(
  pat: string,
  owner: string,
): Promise<ListReposResult> {
  const target = owner.toLowerCase();
  const enc = encodeURIComponent(owner);
  const [user, org] = await Promise.all([
    collectRepoNames(
      pat,
      (p) => `/user/repos?per_page=100&page=${p}&sort=full_name`,
      target,
    ),
    collectRepoNames(pat, (p) => `/orgs/${enc}/repos?per_page=100&page=${p}&sort=full_name`, null),
  ]);
  // Surface an auth failure from either call so the caller can prompt a reconnect.
  for (const r of [user, org]) {
    if (!r.ok && r.authFailed) return r;
  }
  // A hard (non-auth) error only matters if BOTH failed — a single failure (e.g.
  // the org endpoint 403ing) shouldn't wipe out results from the other.
  if (!user.ok && !org.ok) return user;
  const names = new Set<string>();
  if (user.ok) for (const n of user.names) names.add(n);
  if (org.ok) for (const n of org.names) names.add(n);
  return { ok: true, repos: [...names].sort((a, b) => a.localeCompare(b)) };
}
