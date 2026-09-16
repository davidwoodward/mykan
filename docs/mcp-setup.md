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
`set_item_area`, `set_item_assignees`, `set_item_parent`,
`set_project_github_account`, `list_areas`, `set_area_github_repo`,
`refresh_item_from_github`, `set_item_type`.

Item entries (KANBAN-37): `record_decision`, `ask_question`,
`answer_question`, `update_item_entry`, `list_item_entries`,
`delete_item_entry`, `restore_item_entry`, `list_item_entry_versions`,
`restore_item_entry_version` (and `append_item_note`, which now writes a
progress entry).

**Entries: progress, decisions and questions (KANBAN-37).** A card's body is
its description: a clean living spec of the work. Everything that happens
*while* working lives beside it, in `item_entries` (KANBAN-36):

- `append_item_note(item, note)` keeps its name but **no longer edits the
  body**. It records a *progress* entry and answers with the entry plus a
  sentence saying where it went ("Recorded as a progress entry on KANBAN-37
  (not in the card body). Read it back with list_item_entries …").
- `record_decision(item, decision, supersedes?)` records a *decision*.
  Decisions are David's: Claude records what David decided and never decides
  for him. `supersedes` (an active decision's id on the same item) marks the
  older one superseded; it is kept, not deleted.
- `ask_question(item, question)` records an open *question*;
  `answer_question(question, decision_id | decision)` answers it with an
  existing active decision or new decision text, and links the two.
- `update_item_entry(entry, body)` edits any entry's text. Every edit goes
  through the entry version chokepoint, so earlier text is always recoverable:
  `list_item_entry_versions(entry)` and `restore_item_entry_version(entry,
  version)`. `delete_item_entry` is a soft delete, undone by
  `restore_item_entry`.
- `list_item_entries(item, kind?, state?, since?, limit?, include_deleted?)`
  reads background on demand, newest first (limit 1-200, default 50).
- `get_item` stays compact: alongside the title (`name`), `body_text` and the
  epic fields it returns `decisions` (active: `id, body, created_at,
  created_by, supersedes_id`), `open_questions` (`id, body, created_at`) and
  `progress` as a summary only (`{count, last_at}`, non-deleted progress
  entries, superseded included). The progress log itself is not returned.

Guardrails (constants in `lib/mcp-entry-guards.ts`):

- **Entry size cap: 2,000 characters**, for every kind, on create and edit over
  MCP. Over the cap nothing is saved and the error tells Claude to put the
  detail in the repo (a doc, a `_continue/` handoff, the PR description) and
  record a short entry linking to it. Decisions and questions share the cap:
  each is a sentence or two, and one number keeps the contract learnable.
- **Body budget: 8,000 characters.** `set_item_body` still writes a longer
  description, but its response carries a `warning`: a growing spec usually
  means progress is leaking back in.
- **The boundary**, repeated in the tool descriptions: the card holds the work
  (description), its decisions and its status; lobe holds durable lessons;
  repo `_continue/` docs hold handoffs, linked from the card and never copied
  into it.

`set_item_type(item, type)` changes an item's type (feature, bug, task, idea,
epic) through the same path as the web: recorded in history, and refused with a
clear message when an epic still has children or when an item with a parent
would become an epic.

After this ships, every running Claude Code session must **reconnect mykan**
(`/mcp` → reconnect, or restart the session) to see the new tools and
descriptions.

**Epics (KANBAN-41).** `epic` is an item type that groups other cards. The link
is stored once, on the child: `create_item` takes an optional `parent` (the
epic's KEY-N ref or id) and `set_item_parent` sets or clears it (empty
`parent`). `list_items` returns each item's `parent` ref (or null);
`get_item` returns `parent` as `{ref, name}` and, for an epic, `children`
(`{ref, name, status}`, non-archived only) plus `children_progress`
("N/M done"). Rules, enforced by the database too: one level only (an epic has
no parent, a child is never an epic), same project only, the parent must be a
non-archived epic, and an epic can't change type while it has children.

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
