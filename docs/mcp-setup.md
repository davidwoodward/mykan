# mykan MCP setup

The app exposes an MCP server over HTTP that Claude Code uses to list
projects/items, move items across the board, and drive the GitHub integration.
Every call is bearer-authenticated.

- **Canonical endpoint: `https://kanban.dbwoodward.com/mcp`.**
- `https://kanban.dbwoodward.com/api/mcp` still works (backward compat) but is
  legacy — prefer `/mcp` for any new registration.

## Per-user tokens (recommended — KANBAN-30)

As of Phase I.5a, each user connects with their **own** token. The server maps
`token → mykan user → that user's GitHub PAT`, so MCP actions are attributed to
you (no shared identity, no credential borrowing) and the GitHub write-back /
refresh / import tools use *your* PAT. The same token works for **interactive**
Claude Code and **headless/cron** agents — there is no browser step.

### 1. Mint a token (in the app)

Sign in to mykan, click the **key icon** in the top bar (next to the GitHub
icon) → **Generate token** (optionally label it, e.g. `laptop` or `cron`). The
`mk_…` value is shown **once** — copy it now; it is unrecoverable afterwards
(only its hash is stored). Revoke any token from the same panel; revocation
takes effect immediately.

### 2. Register with Claude Code

The panel shows a ready-to-paste command. It registers the server at **user
scope** (available in every project, no repo secret, no approval prompt):

```bash
claude mcp add --transport http --scope user mykan \
  https://kanban.dbwoodward.com/mcp \
  --header "Authorization: Bearer <your mk_… token>"
```

Headless/cron agents use the **same** command with the same token — no browser
flow. For a local dev server, run `npm run dev -- -p 3005` and point a second
entry at `http://localhost:3005/mcp`.

Verify: `claude mcp get mykan` shows **✔ Connected**; in a session `/mcp` (or
`/tools`) lists `mcp__mykan__list_projects`, `…__update_item_status`, etc. Your
token lives only in `~/.claude.json` (your machine) — never in the repo.

## Shared service key (legacy / transition)

Before per-user tokens, MCP used a single shared `MYKAN_SERVICE_API_KEY`. The
server still **dual-accepts** it (it authenticates as the owner) so existing
registrations keep working during the rollout, but it will be retired once
everyone holds a personal token. Don't register new clients with it.

The key is a comma-separated list in the Vercel project env (production) and
`.env.local` (local dev); rotate by adding a new value and removing the old.

## Tools

`list_projects`, `list_items`, `get_item`, `update_item_status`,
`create_item`, `set_item_body`, `append_item_note`, `set_item_tags`,
`set_item_area`, `set_item_assignees`, `set_project_github_account`,
`list_areas`, `set_area_github_repo`, `refresh_item_from_github`.

`set_item_body` REPLACES an item's whole body (safe overwrite): the previous
state is snapshotted to the item's history first, so it is always recoverable
from the History panel (clock icon on any row/card).

## How it works

Both the browser (Auth.js session) and Claude Code (bearer token) call the same
shared core (`lib/projects-core.ts`, `lib/items-core.ts`) so behaviour never
drifts. The MCP route resolves the acting user from the presented token
(`lib/mcp-tokens.ts` for a per-user `mk_…` token, else the shared key → owner)
and runs the handler inside an `AsyncLocalStorage` scope carrying that identity
(`lib/mcp-actor-context.ts`), so every tool acts as that user. The `/mcp` and
`/api/mcp` routes are excluded from the session middleware (`proxy.ts`) and
self-gate via `lib/mcp-server.ts`. Token secrets are stored as SHA-256 hashes
only; the Authorization header is never logged.

Interactive **browser OAuth** ("Authenticate → Google") is Phase I.5b — a
deferred UX polish on top of this; the static per-user token already covers both
interactive and headless use. See docs/github-integration.md §MCP.
