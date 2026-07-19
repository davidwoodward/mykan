# A real dev environment: `dev` branch, `mykan_dev` schema, `kanban-dev.dbwoodward.com`

**Date:** 2026-07-19
**Card:** KANBAN-33
**Status:** design — approved in discussion, not yet built
**Exists to serve:** KANBAN-32 (card slots, sub-items, My Queue) — specifically the
`body` → Intent migration, which transforms existing content and must be rehearsed.

---

## Why

KANBAN-32 includes the first migration in mykan's life that **transforms** existing
content rather than adding alongside it. There is currently nowhere to rehearse it: local
dev points at production, and the only safety net is a data-only JSON export.

This builds a dev environment whose single purpose is to let a destructive migration be
run, inspected, thrown away, and run again until it is right — before it ever touches
production.

## The core loop (this is the point of the whole thing)

```
clone prod → run the REAL migration script → inspect in the dev app
      ↑                                             │
      └───────────── re-sync (reset) ←──────── it's wrong
```

Then, and only then, run **that same script** against `mykan`.

Two consequences that shape every decision below:

1. **`mykan_dev` starts as a faithful clone of prod's CURRENT structure** — warts
   included. It is deliberately *old* until the migration makes it new. Building it in the
   desired end-state shape would mean writing a throwaway ETL and never testing the real
   migration.
2. **The re-sync script is the centerpiece, not a convenience.** It is the "reset the
   experiment" button and will run many times.

**Gate:** no migration rehearsal until the clone is verified row-for-row against prod. A
rehearsal on a subtly incomplete clone is worse than none — it produces false confidence
immediately before touching production.

---

## Reconnaissance findings (verified 2026-07-19, live DB)

These were checked against the live database rather than assumed, and several change the
plan.

| Question | Answer | Consequence |
|---|---|---|
| Where do the enums live? | **`mykan.item_status` (5 values), `mykan.item_type` (4)** — inside the schema, not `public` | Clean. The clone gets its own enums; adding a status in dev **cannot** affect prod. The risk that motivated this question does not exist. |
| Trigger functions? | One: `mykan.set_item_number`, fired by `items_set_number` BEFORE INSERT on `items`. **Does not hardcode `mykan.`** | Copies to `mykan_dev` safely; resolves via its own schema. Must not be forgotten — without it, dev items get no `number`. |
| Sequences? | **None** | Nothing to reset. |
| Storage buckets? | **Two**, both private: `item-images`, `item-attachments` | Both need dev counterparts — the earlier plan assumed one. |
| `done_at` drift? | **Confirmed live** (`timestamptz`), absent from `schema.sql` | Real drift. Fix before cloning. |
| FKs to reproduce | **7** (see below) | A naive `CREATE TABLE … LIKE` would silently drop all of them. |
| Where are the literals? | **All three in `lib/supabase-server.ts`** — `DB_SCHEMA`, `ITEM_IMAGES_BUCKET`, `ITEM_ATTACHMENTS_BUCKET` | The code change is one small file. |

**Foreign keys the clone must reproduce**, with delete rules:

| Table | Column | References | On delete |
|---|---|---|---|
| `categories` | `parent_id` | `categories` | CASCADE |
| `categories` | `project_id` | `projects` | CASCADE |
| `items` | `project_id` | `projects` | CASCADE |
| `items` | `category_id` | `categories` | SET NULL |
| `item_versions` | `item_id` | `items` | CASCADE |
| `projects` | `github_account_id` | `github_accounts` | SET NULL |
| `github_credentials` | `account_id` | `github_accounts` | CASCADE |

**Baseline row counts** (2026-07-19) — the clone must match exactly:

| Table | Rows |
|---|---|
| projects | 12 |
| categories | 45 |
| items | 192 |
| item_versions | 397 |
| github_accounts | 2 |
| github_credentials | 2 |
| mcp_tokens | 0 |

> Note: yesterday's backup recorded 191 items / 386 versions. The drift is KANBAN-32 and
> its notes. Evidence that any snapshot goes stale within a day — re-sync immediately
> before each rehearsal, never trust an old clone.

### The blocker nobody had identified

`lib/supabase-server.ts` documents it:

> *"The Data API (PostgREST) must have `mykan` in its exposed schemas for this to
> resolve."*

**`mykan_dev` must be added to the Supabase project's exposed schemas**, or every query
from the dev app fails regardless of how perfect the clone is. This is a project-level
Supabase setting, not something the clone SQL can do. It is the first thing to verify
after creating the schema, and the most likely cause of a baffling "everything is
broken" first deploy.

---

## Design

### 1. Code: three literals become environment-driven

In `lib/supabase-server.ts`, currently:

```ts
export const ITEM_IMAGES_BUCKET = "item-images";
export const ITEM_ATTACHMENTS_BUCKET = "item-attachments";
const DB_SCHEMA = "mykan";
```

Each reads from an env var with the **production value as default**, so prod behaviour is
unchanged if the var is absent:

- `MYKAN_DB_SCHEMA` → default `mykan`
- `MYKAN_IMAGES_BUCKET` → default `item-images`
- `MYKAN_ATTACHMENTS_BUCKET` → default `item-attachments`

Defaulting to production values is deliberate: a missing var in dev shows up loudly as
"I'm looking at prod data" rather than a silent misconfiguration in production.

### 2. Database: `mykan_dev` as a structural clone

Built from the **live schema**, not from `schema.sql` (which is known to drift). Order:

1. `CREATE SCHEMA mykan_dev`
2. Create its own enum types (`mykan_dev.item_status`, `mykan_dev.item_type`) with values
   copied from prod's
3. Create all 7 tables with full column definitions, defaults, PKs, and the 7 FKs above
4. Recreate indexes (incl. the GIN indexes on `tags` / `assignees`, and the unique
   `(project_id, number)`)
5. Recreate `set_item_number` and the `items_set_number` trigger
6. **Add `mykan_dev` to Supabase's exposed schemas** and verify a query resolves
7. Copy data in FK order: `projects` → `github_accounts` → `categories` → `items` →
   `item_versions` → `github_credentials`
8. **Verify row counts match** the table above
9. `TRUNCATE mykan_dev.github_credentials`

Step 9 is the GitHub safety valve: without credentials, the code already degrades to
`github_sync = 'no_pat'`, a state it handles. This prevents dev from **closing real GitHub
issues** via the Done→close write-back. It runs on every re-sync, so it is self-healing.

### 3. Storage: separate buckets, objects copied

Two new private buckets — `item-images-dev`, `item-attachments-dev`. The re-sync copies
the *objects*, not just the rows, because `items.attachments` and inline body images store
paths: pointing dev at empty buckets breaks every image, and inline images are exactly
what the `body` → Intent migration is most likely to mangle. Copy server-side via the
Storage API rather than round-tripping through the local machine.

### 4. Re-sync script

`scripts/sync-dev-from-prod.sh`, alongside the existing `export-mykan.sh` pattern. Idempotent:

1. Drop and recreate all `mykan_dev` tables (structure from live `mykan`)
2. Copy all data in FK order
3. Sync storage objects into the dev buckets
4. `TRUNCATE mykan_dev.github_credentials`
5. Print row counts for both schemas side by side and **fail loudly on mismatch**

### 5. Branch and deploy topology

| | Production | Dev |
|---|---|---|
| Branch | `main` | `dev` |
| Vercel project | existing | new `mykan-dev` (Production Branch = `dev`) |
| Domain | `kanban.dbwoodward.com` | `kanban-dev.dbwoodward.com` |
| Schema | `mykan` | `mykan_dev` |
| Buckets | `item-images`, `item-attachments` | `…-dev` |
| Whitelist | 3 users | **David only** |
| Telegram | wired | **not wired** |
| MCP | `mykan` | `mykan-dev`, registered only when in use |

**GitHub's default branch stays `main`.** The only upside of switching is that
`gh pr create` targets `dev` automatically; the downside is a class of accidents where
something infers "default branch = production." `--base dev` is cheap insurance.

**Telegram is deliberately unwired.** A bot token has exactly one webhook URL — if dev
inherited `TELEGRAM_BOT_TOKEN`, whichever deploy registered last would steal the bot and
silently drive the wrong database from chat. Omitting the vars costs nothing (a second bot
via BotFather is available if ever needed).

**MCP gets its own key and registration** (`mcp__mykan-dev__*` vs `mcp__mykan__*`).
Registered at user scope **only while actively working the migration**, then removed — an
agent in a session with both can pick the wrong one, and `/mcp reconnect` refreshes tool
schemas but not an agent's conceptual model. Note this makes `MYKAN_SERVICE_API_KEY` a
**five**-location family.

### 6. Local development points at dev

`.env.local` gains `MYKAN_DB_SCHEMA=mykan_dev` and the two bucket vars. From then on,
localhost:3005 touches **only** dev data; production is reachable only through a deployed
`main`.

Keep these **out of `~/.zshrc`** — the shell already overrides `.env.local` for
`MYKAN_SERVICE_API_KEY`, and a schema var in the shell would follow into every project and
every session.

### 7. Dev marker

`app/icon.tsx` already returns red in development and brand indigo in production. Add a
third state for the dev deployment: **bright yellow with black dots** — hazard-flavoured,
unmistakable at tab size, unlike both the indigo brand mark and the red localhost icon.
The browser tab is the primary surface; a nav-bar marker is secondary.

### 8. Documentation must change in the same PR

`AGENTS.md` currently says:

> *"Merge the PR into `main` — this is what triggers the Vercel production deploy."*

**This is the single most likely way the new setup gets bypassed** — by an agent
faithfully following the documented process straight into production. It must be rewritten
to describe merging into the branch currently being worked, with `main` reserved for
deliberate promotion.

---

## Division of labour

**David does:** all `vercel env add` calls (adding secrets is his to authorize), plus any
`.env.local` and `~/.zshrc` edits — with concise, specific instructions provided at the
time.

**Claude does:** everything else — code changes, schema clone, re-sync script, branch,
Vercel project creation and domain wiring, Cloudflare DNS (`dns_token.txt` is already
scoped to `dbwoodward.com`), doc updates.

Also: **upgrade the Vercel CLI first** (54.0.0 → 56.3.1) — before creating a project and
wiring a domain, not mid-setup.

## Ordering

1. Upgrade Vercel CLI
2. Fix `schema.sql` drift (`done_at`) → PR → merge to `main` → **new tag** marking the
   pre-work point
3. Env-drive the three literals in `lib/supabase-server.ts`
4. Create `mykan_dev` (structure) + expose to PostgREST + verify
5. Create dev buckets
6. Write re-sync script; run; **verify row counts**
7. Create `dev` branch; update `AGENTS.md`
8. Create `mykan-dev` Vercel project (Production Branch = `dev`)
9. Cloudflare DNS for `kanban-dev`
10. Env vars *(David)* — incl. distinct `AUTH_SECRET`, narrowed `AUTH_ALLOWED_EMAILS`, dev
    `MYKAN_SERVICE_API_KEY`, same `GITHUB_PAT_ENC_KEY`
11. Google OAuth redirect URI for `kanban-dev` in GCP project `alignpain`
12. **Live end-to-end sign-in test** — per standing rule, auth config changes are verified
    with a real OAuth round trip, never a green build
13. Yellow dev favicon
14. Point `.env.local` at dev *(David)*
15. Dev MCP key + registration, when the migration work begins

## Tagging

**Do not move `pre-card-slots`** (already pushed at `f913883`). Re-pointing a pushed tag
force-rewrites history other clones may hold, and destroys a deliberate marker. Add a
second tag after step 2. Two markers, both honest.

## Notes and non-goals

- **Enum asymmetry:** prod's enums live in `mykan`, dev's will live in `mykan_dev`.
  Symmetrical and clean — this was a risk before recon and turned out not to be one.
- **`mykan-dev` is permanent**, not torn down after the migration.
- **Not covered:** production Supabase backups, point-in-time recovery, or a real
  `pg_dump` (no Postgres password exists on this machine; all DDL has always gone through
  the Management API). A proper `pg_dump` remains worth taking immediately before the
  production migration and is tracked on KANBAN-32.
