import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api-auth";
import { getSupabase } from "@/lib/supabase-server";
import { encryptPat, isGithubCryptoConfigured } from "@/lib/github-crypto";
import { validateGithubConnection } from "@/lib/github";
import type { GithubConnection, GithubCredentialStatus } from "@/lib/types";

/**
 * GET — the current user's GitHub connections (never their PAT). Returns
 * `configured` (is the server-side encryption key set?) plus the accounts this
 * user holds a credential for, with per-user status. See docs/github-integration.md.
 */
export async function GET() {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;

  const { data, error } = await getSupabase()
    .from("github_credentials")
    .select("status, expires_at, account:github_accounts(id, login)")
    .eq("user_email", gate.email);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const accounts: GithubConnection[] = (data ?? [])
    .map((row) => {
      const acct = row.account as unknown as { id: string; login: string } | null;
      if (!acct) return null;
      return {
        id: acct.id,
        login: acct.login,
        status: row.status as GithubCredentialStatus,
        expires_at: (row.expires_at as string | null) ?? null,
      };
    })
    .filter((c): c is GithubConnection => c !== null)
    .sort((a, b) => a.login.localeCompare(b.login));

  return NextResponse.json({ configured: isGithubCryptoConfigured(), accounts });
}

/**
 * POST — connect (or reconnect) a GitHub account for the current user.
 * Body: { login, pat }. Validates the PAT against GitHub, upserts the global
 * account by canonical login (first connector creates it), then upserts THIS
 * user's encrypted credential. The PAT is never echoed back.
 */
export async function POST(req: Request) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;

  if (!isGithubCryptoConfigured()) {
    return NextResponse.json(
      { error: "GitHub connect isn’t configured on the server yet (missing encryption key)." },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { login?: unknown; pat?: unknown };
  const login = typeof body.login === "string" ? body.login.trim().replace(/^@/, "") : "";
  const pat = typeof body.pat === "string" ? body.pat.trim() : "";
  if (!login) return NextResponse.json({ error: "A GitHub account name is required." }, { status: 400 });
  if (!pat) return NextResponse.json({ error: "A personal access token is required." }, { status: 400 });

  const check = await validateGithubConnection(pat, login);
  if (!check.ok || !check.login) {
    return NextResponse.json({ error: check.error ?? "Couldn’t validate that token." }, { status: 400 });
  }

  const sb = getSupabase();

  // Upsert the global account by canonical login (the first connector creates it).
  let accountId: string;
  const existing = await sb
    .from("github_accounts")
    .select("id")
    .eq("login", check.login)
    .maybeSingle();
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 });
  if (existing.data) {
    accountId = existing.data.id as string;
  } else {
    const created = await sb
      .from("github_accounts")
      .insert({ login: check.login, created_by: gate.email })
      .select("id")
      .single();
    if (created.error) return NextResponse.json({ error: created.error.message }, { status: 500 });
    accountId = created.data.id as string;
  }

  // Upsert THIS user's encrypted credential. onConflict = (account_id, user_email).
  const up = await sb
    .from("github_credentials")
    .upsert(
      {
        account_id: accountId,
        user_email: gate.email,
        encrypted_pat: encryptPat(pat),
        status: "active",
        expires_at: check.expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "account_id,user_email" },
    )
    .select("expires_at")
    .single();
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

  const connection: GithubConnection = {
    id: accountId,
    login: check.login,
    status: "active",
    expires_at: (up.data.expires_at as string | null) ?? null,
  };
  return NextResponse.json(connection, { status: 201 });
}
