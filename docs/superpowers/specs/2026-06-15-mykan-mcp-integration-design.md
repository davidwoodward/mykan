# mykan MCP integration

**Date:** 2026-06-15
**Status:** Approved (design)

## Problem

Claude Code should be able to work mykan items directly: list projects, pick an
item, move it to **In Progress**, do the build/debug/work, then move it to
**Done** — knowing the project and the item. Today the only way in is the
browser UI behind Google OAuth, which an agent can't drive.

## Approach

Mirror the `../time` app's MCP layer exactly (David's explicit request). Time's
model: a single HTTP MCP endpoint inside the Next.js app, Bearer-key auth, and a
shared core that both the browser API routes and the MCP tools call so logic
never drifts. We add one piece Time didn't ship — a Claude Code skill that runs
the full work-an-item loop.

"Status" = the item's kanban column (`new` / `in_progress` / `done`); moving
status is the New → In Progress → Done drag, done programmatically.

## Architecture: one door, two callers

```
Browser (Auth.js session) ─┐
                           ├─> shared core (lib/items-core.ts) ─> Supabase (service role)
Claude Code (Bearer key) ──┘
```

- **`app/api/mcp/route.ts`** — MCP server via `mcp-handler` + `zod`, HTTP /
  streamable transport at `/api/mcp`. The handler is wrapped in a `gated()`
  function that verifies the Bearer key before any tool runs; `GET`, `POST`,
  `DELETE` all map to it. (Same shape as Time.)
- **`lib/service-auth.ts`** — `parseServiceKeys()` reads `MYKAN_SERVICE_API_KEY`
  (comma-separated for rotation); `checkServiceKey(req)` does a constant-time
  compare (`crypto.timingSafeEqual`) of the `Authorization: Bearer <key>` header.
  Ported from Time verbatim.
- **`proxy.ts`** — add `api/mcp` to the matcher's exclusion list so the MCP route
  is not gated by the Auth.js session middleware (it has its own Bearer auth).
- **Identity:** the MCP acts as the owner. An `MCP_ACTOR_EMAIL` env var (default
  `dawoodward@gmail.com`, via `ownerEmail()`) is stamped into `created_by` /
  `updated_by` and used for privacy checks, so the agent sees every project
  including private ones (owner semantics — consistent with the web UI).

## Shared core (`lib/items-core.ts`, `lib/projects-core.ts`)

Extract the operations currently inline in the API routes into pure functions
that take the Supabase service-role client plus an `actor` email, returning a
`{ ok, data | error }` result. Then refactor the existing HTTP routes to call
them, so the browser and the MCP share one implementation.

Functions:

- `listProjects(sb, actor)` → visible projects (public + actor's private).
- `listItems(sb, actor, projectRef, statusFilter?)` — `projectRef` is a name or
  id; resolves it (404 if hidden/missing).
- `getItem(sb, actor, itemId)` — full item, body flattened to text via
  `richDocText`, plus tags/attachments/status.
- `setItemStatus(sb, actor, itemId, status)` — validates `isItemStatus`; when
  moving into a column, appends to the end (max position + 1024) like the board
  does on cross-column drops.
- `createItem(sb, actor, projectRef, { name, type?, body?, tags? })` — mirrors
  `POST /api/projects/[id]/items` (paragraphDoc seed, normalizeTags, position).
- `appendItemNote(sb, actor, itemId, text)` — appends a paragraph (and a
  separating rule) to the rich-text body and re-syncs the flattened `name`.
- `setItemTags(sb, actor, itemId, tags)` — `normalizeTags`, replace.

`resolveProjectRef` / access checks reuse the privacy rules already in
`lib/api-auth.ts` (`loadProjectForAccess` / `denyItemAccess`) so the MCP can't
reach a project the actor shouldn't see. The HTTP routes keep their
`requireSession` gate; the core functions take the resolved `actor` from either
caller.

## MCP tools (7)

Each returns `{ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }`
(Time's `json()` helper). Zod input schemas.

1. `list_projects` → `[{ id, name, is_private }]`
2. `list_items` (`project`: name|id, `status?`: new|in_progress|done) →
   `[{ id, name, type, status, tags }]`
3. `get_item` (`item_id`) → `{ id, project_id, name, body_text, type, status, tags, attachments }`
4. `update_item_status` (`item_id`, `status`: new|in_progress|done) → updated item
5. `create_item` (`project`, `name`, `type?`, `body?`, `tags?`) → created item
6. `append_item_note` (`item_id`, `note`) → updated item
7. `set_item_tags` (`item_id`, `tags`: string[]) → updated item

## Claude Code integration

- **Registration:** a committed `.mcp.json` (`type: "http"`,
  `url: https://kanban.dbwoodward.com/api/mcp`, header
  `Authorization: Bearer ${MYKAN_SERVICE_API_KEY}` — shell env expansion, no
  secret in the repo). Which deployment the agent talks to is just the `url` in
  the registration: the committed `.mcp.json` points at the deployed app; to
  drive a local dev server instead, register a second entry (or edit the `url`)
  pointing at `http://localhost:3005/api/mcp`. Docs also give the equivalent
  `claude mcp add --transport http` command for user-scope use from other repos.
- **Skill — `work-item`** (`.claude/skills/work-item/SKILL.md`): the hands-off
  loop. Given a project + item (or it lists and asks), it: `get_item` →
  `update_item_status` to `in_progress` → does the build/debug work from the item
  body as the spec → `append_item_note` summarizing what changed →
  `update_item_status` to `done`. Stops for confirmation before marking done if
  the work is ambiguous.

## Dependencies

`mcp-handler@^1.1.0` and `zod@^4` (Time's versions). `.npmrc` already has
`min-release-age=7`, so the 7-day cooldown gate is satisfied.

## Env vars (new)

```
MYKAN_SERVICE_API_KEY=mykan_sk_<base64>   # Bearer key(s), comma-separated for rotation
MCP_ACTOR_EMAIL=dawoodward@gmail.com      # optional; defaults to ownerEmail()
```

Generate: `printf 'mykan_sk_%s' "$(openssl rand -base64 32)"`. Set in
`.env.local` (local) and Vercel project env (prod). Documented in a new
`docs/mcp-setup.md` mirroring Time's `ENV_SETUP.md` + `MCP_STEWARD.md`.

## Security notes

- Bearer key compared in constant time; never logged; not committed.
- `/api/mcp` excluded from session middleware but self-gated — verify a
  keyless/wrong-key request returns 401.
- The actor identity bounds visibility through the same privacy rules as the UI.

## Testing / verification

- `tsc --noEmit` + `next build` clean.
- Unit-ish: call the core functions against the live DB (service role) via a
  throwaway script — list/get/create/status/note/tags round-trip; revert test
  writes.
- MCP endpoint: `curl` with a valid key returns the tool list / a tool result;
  with no/invalid key returns 401.
- End-to-end: register locally (`claude mcp add` against localhost:3005), confirm
  `mcp__mykan__*` tools appear and a status change moves the card on the board.

## Rollout

1. Implement core + route + auth + skill + `.mcp.json` + docs.
2. Add `MYKAN_SERVICE_API_KEY` to `.env.local` and Vercel env.
3. Deploy (merge to `main`).
4. Register the MCP in Claude Code and verify the loop.

## Non-goals

- No item deletion/archive via MCP (UI-only for now).
- No attachment upload via MCP (paths/metadata only on read).
- No separate npm package — the MCP lives in the Next.js app, like Time.
