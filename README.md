# Mykan

A minimal project + item tracker with a kanban board. Small-team app, Google sign-in restricted to a whitelist. Built on Next.js 16, Auth.js v5, Supabase Postgres, deployed to Vercel.

## What it does

- **Projects** — a name, an optional description, a short **key** (e.g. `AMOS`), and a Shared/Private flag. Edit them inline from the pencil in the project nav.
- **Items** — belong to one project; carry a rich-text body (no separate title — the first line reads as one), a type (`feature` / `bug` / `task` / `idea`), a **status**, a stable **reference**, optional **assignees**, a **category (Area)**, and tags.
- **Item references** — every item gets an immutable, per-project number shown with the project key as `AMOS-12` (or `#12` before a key is set). Stamped at creation, never reused.
- **Status** — Not started / In Progress / **Blocked** / **Testing** / Done. Click the status pill to cycle. Testing is a *gate*, not a bucket: it passes to Done or bounces back to In Progress.
- **List view** — group by **Status**, **Area**, or **Flat** (one ungrouped list, status as a pill). Every list section is **drag-reorderable** (grip per row), and the row columns (status · ref · content) align across items.
- **Board view** — kanban with five columns (Not started / In Progress / Blocked / Testing / Done), drag-and-drop to reorder or change status; columns are collapsible per project per viewer; a refresh button reloads items in place without a full page reload.
- **One global order, many lenses** — `position` is a single per-project order (creation order by default); the board (per-status columns), the grouped lists, and the Flat list all read and edit it, so dragging anywhere stays in sync.
- **Categories (Areas)** — a per-project **hierarchical** area tree (e.g. `coach / program / checkin`). File an item under a node; **renaming a node ripples** to every item; **filtering by a node includes its whole subtree**. Type a `/`-path to find-or-create nodes; manage the tree (rename / add / delete) in the **Areas** panel.
- **Assignees** — multiple members per item (the whitelist), shown as avatar chips, on **shared** projects only.
- **Filters** — by **status** (multi-select), **area** (subtree), **tag** (keyboard-driven: drop-down on focus, type to narrow, Enter to apply, AND semantics), and **creator**.
- **Project page chrome** — a sticky top nav (back-to-projects arrow, project title + byline, edit pencil) over a function-organised toolbar (View · Filter · Actions). The whole app uses one wide `sm:w-[95%]` shell so the nav never shifts between pages. Long Done descriptions clamp to ~5 lines with Show more/less.
- **Capture** — the name field is a textarea that grows as you type. Enter is a newline; ⌘/Ctrl+Enter (or the Add button) commits. A new item can be filed under an Area as you add it.
- **Rich item bodies** — Tiptap rich-text with inline images and file attachments; free-form tags; soft-delete with an Archived view.
- **Private projects** — the owner can mark a project private (visible only to them); everyone else sees only shared projects. See [`docs/mcp-setup.md`](./docs/mcp-setup.md) and the privacy spec under `docs/superpowers/specs/`.
- **Dark mode** — light/dark theme with a moon/sun toggle; respects the OS preference, persists the choice.
- **MCP / agent access** — an HTTP MCP server at **`/mcp`** (legacy `/api/mcp` kept for compat) lets Claude Code list projects/items, move them across the board, and drive the GitHub integration. Each user connects with their **own** `mk_…` token (minted from the key icon in the top bar), so MCP actions are attributed to that user and use their GitHub PAT — no shared identity. One token covers interactive and headless/cron agents. See [`docs/mcp-setup.md`](./docs/mcp-setup.md).

## Architecture in one line

Two callers, one core. The browser calls `/app/api/**` gated by an Auth.js session (whitelisted emails only); Claude Code calls `/mcp` gated by a per-user bearer token. Both run through the same shared core (`lib/projects-core.ts`, `lib/items-core.ts`) so validation and visibility rules never drift. Every path holds the Supabase **service-role** key server-side.

```
Browser ──fetch (session)──▶ /api/projects, /api/items, /api/auth/[...]
                                          │
Claude Code ──user token──▶ /mcp ─────────┤   (token → user → their GitHub PAT)
                                          ▼
                          lib/projects-core.ts / lib/items-core.ts
                                          │
                                          ▼
                          lib/supabase-server.ts (service-role)
                                          │
                                          ▼
                                  Supabase Postgres
```

Session gating for browser routes/pages lives in `lib/auth.ts`; `/mcp` (and legacy `/api/mcp`) are excluded from the session middleware (`proxy.ts`) and self-gate in `lib/mcp-server.ts`, which resolves the acting user from the presented token (`lib/mcp-tokens.ts`, hashes-only; else the shared key → owner) and runs each tool as that user via an `AsyncLocalStorage` scope (`lib/mcp-actor-context.ts`). No `NEXT_PUBLIC_SUPABASE_*` vars exist — `lib/supabase-server.ts` carries `import "server-only"`; if a client component imports it, the build fails.

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4
- Auth.js v5 (Google provider, JWT sessions)
- `@supabase/supabase-js` v2 (server-side, service-role)
- `@dnd-kit/core` + `@dnd-kit/sortable` for the board
- Tiptap v3 (rich-text item bodies)
- `mcp-handler` + `zod` for the MCP server at `/mcp`
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

# 4. record that baseline so the migration runner doesn't replay it
npm run db:migrate -- --baseline

# 5. start dev
npm run dev
# → http://localhost:3000
```

Sign in with one of the whitelisted Google accounts (see `lib/auth.ts`).

## Database migrations

`supabase/migrations/*.sql` are applied in filename order by `npm run db:migrate`, which
records each one in `mykan.schema_migrations` — so which migrations have run is a fact in the
database, not something to reconstruct from memory.

```bash
npm run db:migrate                 # apply everything pending
npm run db:migrate -- --status     # what's applied, what's pending, any drift
npm run db:migrate -- --dry-run    # show what would run, change nothing
npm run db:migrate -- --baseline   # mark all current files applied WITHOUT running them
```

It needs `SUPABASE_ACCESS_TOKEN` (a Supabase **personal access token**, not the database
password) in your environment or `.env.local`, and finds the project ref from
`SUPABASE_PROJECT_REF` or `supabase/.temp/project-ref`. Local-only — the token must never
reach Vercel runtime or git.

Each file runs inside a transaction together with its ledger insert, so a failure rolls back
whole and stays pending; nothing half-applied gets recorded as done. A file that opens its own
transaction, or is marked `-- migrate:no-transaction` (for `CREATE INDEX CONCURRENTLY` and
friends), is left unwrapped. Editing a migration after it has been applied is reported as
checksum drift by `--status`.

New migrations keep the `YYYY-MM-DD-name.sql` prefix so filename order stays chronological,
and should also be folded into `supabase/schema.sql` — that file is what a fresh setup runs,
so a change that lands only in `migrations/` will be missing from every new deployment.

## Deploying to Vercel

```bash
vercel link            # one-time: create or attach the project
vercel env add AUTH_SECRET production
vercel env add AUTH_GOOGLE_ID production
vercel env add AUTH_GOOGLE_SECRET production
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add MYKAN_SERVICE_API_KEY production   # bearer key the MCP server accepts
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
    mcp/route.ts                   ← legacy MCP endpoint (basePath /api), token-gated
    mcp-tokens/route.ts · [id]/route.ts ← per-user MCP token mint/list/revoke (session-gated)
    projects/route.ts              ← GET, POST
    projects/[id]/route.ts         ← GET, PATCH (name/desc/key/privacy), DELETE
    projects/[id]/items/route.ts   ← GET, POST
    projects/[id]/categories/route.ts ← GET (tree), POST (find-or-create by path)
    categories/[id]/route.ts       ← PATCH (rename), DELETE (reparent + un-file)
    items/[id]/route.ts            ← PATCH (status/type/position/tags/assignees/category), DELETE
    items/[id]/attachments/**      ← upload/sign/rename/remove/serve
    items/[id]/images/route.ts     ← inline image upload
    images/[...path]/route.ts      ← authed image serving
  mcp/route.ts                     ← canonical MCP endpoint /mcp (basePath ""), token-gated
  [ref]/page.tsx                   ← /KEY (project list + board) and /KEY-N (card page)
  projects/[id]/page.tsx           ← old GUID links: 308 to /KEY
  not-found.tsx                    ← the one 404 (unknown, or not shared with you)
  signin/page.tsx                  ← sign-in screen
  page.tsx                         ← projects list
components/
  Board.tsx                        ← @dnd-kit kanban
  ProjectsView.tsx                 ← projects list + privacy toggle
  ProjectDetailView.tsx            ← toolbar, filters, grouping (Status/Area/Flat)
  ProjectHeader.tsx                ← inline edit of name/desc/key/visibility (the nav pencil)
  ItemList.tsx                     ← list rows; DraggableRows (sortable sections + Flat)
  CardPage.tsx · RichTextEditor.tsx (Tiptap) ← a card's page, /KEY-N (KANBAN-44)
  RefBadge.tsx                     ← KEY-# reference badge (+ project-key context)
  CategoryPicker.tsx · CategoryManager.tsx ← Area picker + tree manager
  AssigneePicker.tsx               ← multi-assignee picker (shared projects)
  TagEditor.tsx · InlineTags.tsx · Attachments.tsx · InlineAttachments.tsx
  ThemeToggle.tsx                  ← light/dark moon-sun toggle
  AutoGrowTextarea.tsx · TypeBadge.tsx · Byline.tsx · Brand.tsx · SignOutButton.tsx
lib/
  auth.ts                          ← Auth.js config + whitelist + ownerEmail/mcpActorEmail
  api-auth.ts                      ← requireSession() + project/item visibility guards
  service-auth.ts                  ← constant-time shared-key check (legacy dual-accept)
  mcp-server.ts                    ← MCP tool registration + per-request auth gate (both routes)
  mcp-tokens.ts                    ← per-user token mint/hash(SHA-256)/verify
  mcp-actor-context.ts             ← AsyncLocalStorage carrying the request's MCP actor
  projects-core.ts · items-core.ts · categories-core.ts ← shared core (browser + MCP)
  position.ts                      ← computePosition (shared by board + list drag)
  format.ts                        ← localPart / timeAgo / itemRef helpers
  supabase-server.ts               ← server-only Supabase client
  types.ts                         ← shared types, labels, richDocText/normalizeTags
proxy.ts                           ← session gate for non-API/non-asset routes (Next 16 middleware)
.claude/skills/work-item/SKILL.md  ← Claude Code skill: run an item In Progress → Done
docs/mcp-setup.md · docs/DESIGN.md ← MCP registration · design & UX conventions
supabase/
  schema.sql                       ← Postgres schema (paste into SQL editor)
  migrations/                      ← incremental DDL/data migrations, applied by
                                     `npm run db:migrate`; also folded into schema.sql
```

## Editing the whitelist

Defaults are in `lib/auth.ts`. Override at runtime by setting `AUTH_ALLOWED_EMAILS` to a comma-separated list. Emails are matched case-insensitively against the Google-verified account email.

Addresses are **canonicalised** first (`canonicalEmail` in `lib/types.ts`). For `gmail.com` and
`googlemail.com` that means dots in the local part and anything after a `+` are ignored, and
`googlemail.com` folds to `gmail.com` — so one Gmail account matches however it is spelled, and a
whitelist entry may be written either way. Every other domain is only trimmed and lowercased,
because a dot is significant there.

This matters beyond sign-in: the canonical form is the identity stored in `projects.shared_with`
and `items.assignees`, and `listProjects` / `loadProjectForAccess` compare it as an exact string.
The `jwt` callback canonicalises the session email so all three always agree.
