import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptPat, isGithubCryptoConfigured } from "@/lib/github-crypto";
import { listAccessibleRepos, listOpenIssues } from "@/lib/github";
import { githubIssueBody } from "@/lib/markdown-tiptap";
import { createItem } from "@/lib/items-core";
import { listCategories, pathOf } from "@/lib/categories-core";
import { coreErr, coreOk, resolveProject, type CoreResult } from "@/lib/projects-core";
import type { Category, GithubCredentialStatus } from "@/lib/types";

/** Per-repo outcome line in an import summary. */
export interface ImportRepoResult {
  /** The repo name (owner implied by the account). */
  repo: string;
  /** The area path issues from this repo landed under. */
  area: string;
  imported: number;
  skipped: number;
  /** Set when this repo couldn't be imported (bad repo, GitHub error). */
  error?: string;
}

export interface ImportSummary {
  account: string | null;
  /**
   * Set when the acting user has no usable PAT for the project's account (none
   * connected, or the stored one was rejected). The UI shows a Connect prompt.
   * No items are imported when this is set. See docs/github-integration.md.
   */
  needs_connect?: { account: string; reason: "missing" | "invalid" };
  repos: ImportRepoResult[];
  imported: number;
  skipped: number;
}

/** The acting user's active credential row for an account, if any. */
async function loadCredential(
  sb: SupabaseClient,
  userEmail: string,
  accountId: string,
): Promise<{ encrypted_pat: string; status: GithubCredentialStatus } | null> {
  const { data } = await sb
    .from("github_credentials")
    .select("encrypted_pat, status")
    .eq("account_id", accountId)
    .eq("user_email", userEmail)
    .maybeSingle();
  return (data as { encrypted_pat: string; status: GithubCredentialStatus } | null) ?? null;
}

/** Flip a user's credential to `invalid` after GitHub rejects it (401/403). */
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
 * Resolve a project to its bound account login and the acting user's decrypted
 * PAT. Returns a discriminated result: `ok` with `{ owner, pat }`, or a reason
 * the caller surfaces (no account bound, missing/invalid credential, etc.).
 */
type AccountPat =
  | { ok: true; owner: string; pat: string }
  | { ok: false; kind: "error"; error: string; status: number }
  | { ok: false; kind: "needs_connect"; owner: string; reason: "missing" | "invalid" };

async function loadAccountPat(
  sb: SupabaseClient,
  actor: string,
  accountId: string,
): Promise<AccountPat> {
  const { data: acct, error } = await sb
    .from("github_accounts")
    .select("login")
    .eq("id", accountId)
    .maybeSingle();
  if (error) return { ok: false, kind: "error", error: error.message, status: 500 };
  if (!acct) return { ok: false, kind: "error", error: "The project’s GitHub account no longer exists.", status: 400 };
  const owner = (acct as { login: string }).login;

  const cred = await loadCredential(sb, actor, accountId);
  if (!cred) return { ok: false, kind: "needs_connect", owner, reason: "missing" };
  if (cred.status === "invalid") return { ok: false, kind: "needs_connect", owner, reason: "invalid" };
  try {
    return { ok: true, owner, pat: decryptPat(cred.encrypted_pat) };
  } catch {
    return { ok: false, kind: "needs_connect", owner, reason: "invalid" };
  }
}

export interface RepoListResult {
  account: string | null;
  repos: string[];
  needs_connect?: { account: string; reason: "missing" | "invalid" };
}

/**
 * List the repo names available under a project's bound GitHub account, using
 * the acting user's PAT — feeds the area→repo binding picker. Never throws for
 * a missing account/credential: returns an empty list (the picker still allows
 * typing a repo name by hand) plus a `needs_connect` hint when relevant.
 */
export async function listReposForProject(
  sb: SupabaseClient,
  actor: string,
  projectRef: string,
): Promise<CoreResult<RepoListResult>> {
  const proj = await resolveProject(sb, actor, projectRef);
  if (!proj.ok) return proj;
  if (!proj.data.github_account_id) return coreOk({ account: null, repos: [] });
  if (!isGithubCryptoConfigured()) return coreOk({ account: null, repos: [] });

  const auth = await loadAccountPat(sb, actor, proj.data.github_account_id);
  if (!auth.ok) {
    if (auth.kind === "error") return coreErr(auth.error, auth.status);
    return coreOk({
      account: auth.owner,
      repos: [],
      needs_connect: { account: auth.owner, reason: auth.reason },
    });
  }

  const result = await listAccessibleRepos(auth.pat, auth.owner);
  if (!result.ok) {
    if (result.authFailed) {
      await markCredentialInvalid(sb, actor, proj.data.github_account_id);
      return coreOk({
        account: auth.owner,
        repos: [],
        needs_connect: { account: auth.owner, reason: "invalid" },
      });
    }
    return coreErr(result.error, result.status || 502);
  }
  return coreOk({ account: auth.owner, repos: result.repos });
}

/**
 * Import open GitHub issues into a project as Not Started items, routed to the
 * area bound to each repo. The acting user's own PAT is used (no borrowing).
 *
 * - `categoryId` given → import only that area's repo.
 * - `categoryId` omitted → import every area in the project that has a bound repo.
 *
 * Dedupe is by the live item backlink `owner/repo#number`: an issue whose
 * backlink already exists on any item in the project is skipped. There is no
 * ledger — a deleted item lets a still-open issue re-import. See
 * docs/github-integration.md §Import.
 */
export async function importFromGithub(
  sb: SupabaseClient,
  actor: string,
  projectRef: string,
  opts: { categoryId?: string } = {},
): Promise<CoreResult<ImportSummary>> {
  if (!isGithubCryptoConfigured()) {
    return coreErr("GitHub isn’t configured on the server (missing encryption key).", 503);
  }

  const proj = await resolveProject(sb, actor, projectRef);
  if (!proj.ok) return proj;
  const project = proj.data;
  if (!project.github_account_id) {
    return coreErr("Link this project to a GitHub account first.", 400);
  }

  // Resolve the bound account's canonical login (the import owner).
  const { data: acct, error: acctErr } = await sb
    .from("github_accounts")
    .select("login")
    .eq("id", project.github_account_id)
    .maybeSingle();
  if (acctErr) return coreErr(acctErr.message, 500);
  if (!acct) return coreErr("The project’s GitHub account no longer exists.", 400);
  const owner = (acct as { login: string }).login;

  // Which areas to import: one requested area, or every repo-bound area.
  const cats = await listCategories(sb, project.id);
  let targets: Category[];
  if (opts.categoryId) {
    const cat = cats.find((c) => c.id === opts.categoryId);
    if (!cat) return coreErr("Area not found in this project.", 404);
    if (!cat.github_repo) return coreErr("This area isn’t linked to a GitHub repo.", 400);
    targets = [cat];
  } else {
    targets = cats.filter((c) => c.github_repo);
    if (targets.length === 0) {
      return coreErr("No areas are linked to a GitHub repo yet.", 400);
    }
  }

  // The acting user's credential for the account. Missing/invalid → Connect
  // prompt (not an error — importing is never blocked, it just can't proceed).
  const cred = await loadCredential(sb, actor, project.github_account_id);
  if (!cred) {
    return coreOk({
      account: owner,
      needs_connect: { account: owner, reason: "missing" },
      repos: [],
      imported: 0,
      skipped: 0,
    });
  }
  if (cred.status === "invalid") {
    return coreOk({
      account: owner,
      needs_connect: { account: owner, reason: "invalid" },
      repos: [],
      imported: 0,
      skipped: 0,
    });
  }

  let pat: string;
  try {
    pat = decryptPat(cred.encrypted_pat);
  } catch {
    // A ciphertext we can't decrypt is effectively an unusable credential.
    return coreOk({
      account: owner,
      needs_connect: { account: owner, reason: "invalid" },
      repos: [],
      imported: 0,
      skipped: 0,
    });
  }

  // Dedupe set: every backlink already present on a live item in the project
  // (archived or not — an archived item still holds the backlink). A new item's
  // backlink is added as we go, so one import never double-creates.
  const { data: existing, error: exErr } = await sb
    .from("items")
    .select("github_issue")
    .eq("project_id", project.id)
    .not("github_issue", "is", null);
  if (exErr) return coreErr(exErr.message, 500);
  const seen = new Set<string>(
    ((existing ?? []) as { github_issue: string | null }[])
      .map((r) => r.github_issue)
      .filter((v): v is string => !!v),
  );

  const summary: ImportSummary = { account: owner, repos: [], imported: 0, skipped: 0 };

  for (const area of targets) {
    const repo = area.github_repo as string;
    const areaPath = pathOf(cats, area.id) || repo;
    const result = await listOpenIssues(pat, owner, repo);

    if (!result.ok) {
      if (result.authFailed) {
        // Rejected token → mark the credential invalid and stop; surface Connect.
        await markCredentialInvalid(sb, actor, project.github_account_id);
        summary.needs_connect = { account: owner, reason: "invalid" };
        break;
      }
      summary.repos.push({ repo, area: areaPath, imported: 0, skipped: 0, error: result.error });
      continue;
    }

    let imported = 0;
    let skipped = 0;
    let error: string | undefined;
    for (const issue of result.issues) {
      const backlink = `${owner}/${repo}#${issue.number}`;
      if (seen.has(backlink)) {
        skipped++;
        continue;
      }
      const created = await createItem(sb, actor, project.id, {
        body: githubIssueBody(issue.title, issue.body),
        type: "task",
        tags: issue.labels,
        category_id: area.id,
        github_issue: backlink,
      });
      if (!created.ok) {
        error = created.error; // stop this repo; keep what imported so far
        break;
      }
      seen.add(backlink);
      imported++;
    }
    summary.repos.push({ repo, area: areaPath, imported, skipped, ...(error ? { error } : {}) });
    summary.imported += imported;
    summary.skipped += skipped;
  }

  return coreOk(summary);
}
