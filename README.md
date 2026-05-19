# Mykan

A minimal project + item tracker with a kanban board. Two-user app, Google sign-in restricted to a hardcoded whitelist. Built on Next.js 16, Auth.js v5, Supabase Postgres, deployed to Vercel.

## What it does

- **Projects** — a name and an optional description.
- **Items** — a name and a type (`feature` / `bug` / `idea`), belonging to one project.
- **List view** — items grouped by status; click the status pill to cycle.
- **Board view** — kanban with three columns (New / In Progress / Done), drag-and-drop to reorder or change status.
- **Capture** — the name field is a textarea that grows as you type. Enter is a newline; ⌘/Ctrl+Enter (or the Add button) commits.

## Architecture in one line

The browser only ever calls `/app/api/**`. Those route handlers run server-side, hold the Supabase **service-role** key, and gate every request on an Auth.js session whose `signIn` callback only permits the whitelisted emails.

```
Browser ──fetch──▶ /api/projects, /api/items, /api/auth/[...]
                          │
                          ▼
                   lib/auth.ts (session check)
                          │
                          ▼
                   lib/supabase-server.ts (service-role)
                          │
                          ▼
                   Supabase Postgres
```

No `NEXT_PUBLIC_SUPABASE_*` vars exist. `lib/supabase-server.ts` carries an `import "server-only"` directive; if a client component imports it, the build fails.

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4
- Auth.js v5 (Google provider, JWT sessions)
- `@supabase/supabase-js` v2 (server-side, service-role)
- `@dnd-kit/core` + `@dnd-kit/sortable` for the board
- Deployed on Vercel

## Local setup

See **[ENV_SETUP.md](./ENV_SETUP.md)** for the full setup walkthrough. Quick version:

```bash
# 1. install
npm install

# 2. copy .env.local.example to .env.local and fill in
cp .env.local.example .env.local
# AUTH_SECRET: openssl rand -base64 32
# AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET: Google Cloud Console OAuth client
# SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY: Supabase project Settings → API

# 3. apply the schema once, in the Supabase SQL editor:
#    paste the contents of supabase/schema.sql and run

# 4. start dev
npm run dev
# → http://localhost:3000
```

Sign in with one of the whitelisted Google accounts (see `lib/auth.ts`).

## Deploying to Vercel

```bash
vercel link            # one-time: create or attach the project
vercel env add AUTH_SECRET production
vercel env add AUTH_GOOGLE_ID production
vercel env add AUTH_GOOGLE_SECRET production
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
# (repeat with `preview` instead of `production` for PR previews)
```

After the first production deploy:

1. Note the assigned domain (e.g. `https://mykan-xxx.vercel.app`).
2. In Google Cloud Console → OAuth client, add `https://<domain>/api/auth/callback/google` to **Authorized redirect URIs**.

Production is served at **`kanban.dbwoodward.com`**. To wire that up: add a `CNAME` record `kanban → cname.vercel-dns.com` at the dbwoodward.com DNS provider, then `vercel domains add kanban.dbwoodward.com`. Full walkthrough in [ENV_SETUP.md](./ENV_SETUP.md) section 9.

Vercel's GitHub integration handles CI/CD automatically once the repo is linked:

- Push to `main` → production deploy
- Open a PR → preview deploy with its own URL

The `.github/workflows/ci.yml` workflow runs typecheck + lint + build on PRs as a pre-merge gate.

## Repo layout

```
app/
  api/
    auth/[...nextauth]/route.ts   ← Auth.js handler
    projects/route.ts              ← GET, POST
    projects/[id]/route.ts         ← GET, PATCH, DELETE
    projects/[id]/items/route.ts   ← GET, POST
    items/[id]/route.ts            ← PATCH, DELETE
  projects/[id]/page.tsx           ← project detail (list + board)
  signin/page.tsx                  ← sign-in screen
  page.tsx                         ← projects list
components/
  AutoGrowTextarea.tsx
  Board.tsx                        ← @dnd-kit kanban
  ItemList.tsx
  ProjectsView.tsx
  ProjectDetailView.tsx
  SignOutButton.tsx
  TypeBadge.tsx
lib/
  auth.ts                          ← Auth.js v5 config + whitelist
  api-auth.ts                      ← requireSession() for routes
  supabase-server.ts               ← server-only Supabase client
  types.ts                         ← shared types and labels
middleware.ts                      ← session gate for non-API/non-asset routes
supabase/
  schema.sql                       ← Postgres schema (paste into SQL editor)
```

## Editing the whitelist

Defaults are in `lib/auth.ts`. Override at runtime by setting `AUTH_ALLOWED_EMAILS` to a comma-separated list. Emails are matched case-insensitively against the Google-verified account email.
