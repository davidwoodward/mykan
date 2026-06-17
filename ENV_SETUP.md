# Mykan — Environment Setup

Everything you need to gather and install before the build starts. Reply in chat with the values once you have them.

## 1. CLIs to install + sign into

| CLI | Why | Install | Sign in |
|---|---|---|---|
| **Node 20+** (ideally 22 LTS) | Next.js 16 requires Node ≥ 20.9 | `brew install node` (or nvm) | — |
| **gh** | Create the GitHub repo, push, view PRs | `brew install gh` | `! gh auth login` |
| **vercel** | Link the project, push env vars, trigger deploys | `npm i -g vercel` | `! vercel login` |
| **supabase** (optional) | Push schema from CLI; alternative is pasting SQL into the Supabase dashboard | `brew install supabase/tap/supabase` | `! supabase login` |

The `!` prefix runs the command in the Claude Code session so the output lands in our conversation. `gcloud` is **not** needed; Google OAuth creds are created in the Cloud Console UI.

## 2. Supabase

Create a new project (any region close to you, e.g. `us-east-1`). From **Settings → API**:

- `SUPABASE_URL` — the Project URL (`https://<ref>.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` — the **service_role** key (or, on newer projects, the **secret** API key)

That's it. No anon key (frontend won't touch Supabase). No DB connection string (we'll apply schema via the SQL editor or `supabase db push`).

## 3. Google OAuth

In **Google Cloud Console** (use whichever workspace you prefer):

1. Create or pick a project → **APIs & Services → Credentials → Create OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized JavaScript origins:**
   - `http://localhost:3000`
4. **Authorized redirect URIs:**
   - `http://localhost:3000/api/auth/callback/google`
   - (We'll add the Vercel production URL after the first deploy — Google lets you add it later.)
5. Grab:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

If the OAuth consent screen isn't set up yet:
- Workspace **Internal** is simplest (no verification required).
- Otherwise **External** in **Testing** mode, with both whitelisted emails added as test users.

## 4. Auth.js secret

Generated automatically during scaffold (`openssl rand -base64 32`). No action needed from you.

## 5. Vercel

Nothing to pre-create. After the first push to GitHub:

1. `vercel link` — one interactive prompt, pick "create new project."
2. `vercel env add ...` — push the env vars from `.env.local`.
3. Vercel auto-wires CI/CD from the linked GitHub repo: every push to `main` → production deploy, every PR → preview deploy. No GitHub Actions file needed for the deploy itself.
4. After the first production deploy, copy the assigned URL into Google's **Authorized redirect URIs** (add `https://<vercel-domain>/api/auth/callback/google`).

## 6. `.env.local` template

```
# Auth.js
AUTH_SECRET=<generated for you>
AUTH_GOOGLE_ID=<from you>
AUTH_GOOGLE_SECRET=<from you>

# Supabase (server-only — no NEXT_PUBLIC_ prefix on purpose)
SUPABASE_URL=<from you>
SUPABASE_SERVICE_ROLE_KEY=<from you>

# MCP server bearer key (comma-separated to rotate). Generate:
#   printf 'mykan_sk_%s' "$(openssl rand -base64 32 | tr -d '/+=')"
MYKAN_SERVICE_API_KEY=<generated>
# Optional: identity the MCP acts as (defaults to the owner email)
# MCP_ACTOR_EMAIL=dawoodward@gmail.com

# Optional: override the hardcoded whitelist
# AUTH_ALLOWED_EMAILS=dawoodward@gmail.com,matthewL@experiencealign.com
```

`MYKAN_SERVICE_API_KEY` is the key the MCP server at `/api/mcp` accepts; full registration walkthrough in [docs/mcp-setup.md](./docs/mcp-setup.md). The absence of `NEXT_PUBLIC_*` Supabase vars is intentional: it's how we enforce "frontend never calls Supabase directly." All DB access flows through server-only API routes that hold the service-role key.

## 7. Architecture (for reference)

API routes (all server-side, all hold the service-role Supabase client):

- `app/api/auth/[...nextauth]/route.ts` — Auth.js handler
- `app/api/projects/route.ts` — `GET` list, `POST` create
- `app/api/projects/[id]/route.ts` — `GET` / `PATCH` / `DELETE`
- `app/api/projects/[id]/items/route.ts` — `GET` list project items, `POST` create item
- `app/api/items/[id]/route.ts` — `PATCH` (rename, retype, change status/position), `DELETE`
- `app/api/mcp/route.ts` — MCP server (HTTP) for Claude Code; bearer-gated via `lib/service-auth.ts`, excluded from the session middleware in `proxy.ts`

The browser API routes and the MCP tools both call a shared core (`lib/projects-core.ts`, `lib/items-core.ts`) so logic never drifts. Client components use `fetch('/api/...')`. The Supabase client is constructed in a server-only `lib/supabase-server.ts` that throws if imported from a client module. No leak path.

## 8. Auto-deploy on merge to main

Native to Vercel once the GitHub repo is linked — no extra config needed.

A lightweight `.github/workflows/ci.yml` will also be added to run `tsc --noEmit` and `next build` on PRs, so broken code can't merge. (Tell me if you'd rather skip this and rely solely on Vercel's preview deploy as the gate.)

## 9. Custom domain — kanban.dbwoodward.com

Three steps, in order. Do these *after* the first successful Vercel deploy.

### a. Add a DNS record at your dbwoodward.com DNS provider

| Field | Value |
|---|---|
| Type | `CNAME` |
| Host / Name | `kanban` *(some UIs want the full `kanban.dbwoodward.com`)* |
| Value / Target | `cname.vercel-dns.com` |
| TTL | `3600` (or the provider default) |

**Cloudflare specifically:** set the record to **DNS-only** (gray cloud, no proxy) so Vercel can complete the TLS handshake. If the orange cloud is on you'll get cert / redirect-loop errors.

### b. Add the domain to the Vercel project

Dashboard route: **Project → Settings → Domains → Add `kanban.dbwoodward.com`**. Or, from the repo root:

```bash
vercel domains add kanban.dbwoodward.com
```

Vercel polls DNS, then auto-issues a Let's Encrypt cert (≈ 1–2 minutes once the CNAME propagates). The current production deploy is automatically aliased to the new domain.

### c. Add the production URL to Google OAuth

In Google Cloud Console → your OAuth client → **Authorized redirect URIs**, add:

```
https://kanban.dbwoodward.com/api/auth/callback/google
```

Leaving the `*.vercel.app` redirect in place is safe — Vercel's preview deploys hit that one.

## 10. Checklist — reply when ready

- [ ] `gh` installed and signed in
- [ ] `vercel` installed and signed in
- [ ] Supabase project created
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Google OAuth client created with `http://localhost:3000/api/auth/callback/google` as a redirect URI
- [ ] `GOOGLE_CLIENT_ID`
- [ ] `GOOGLE_CLIENT_SECRET`
- [ ] DNS provider for dbwoodward.com identified (so I can give exact instructions if the generic table above doesn't map cleanly)

Paste the four values into chat (or drop them into `.env.local` yourself and just say "ready") and I'll start the scaffold.
