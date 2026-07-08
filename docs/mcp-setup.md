# mykan MCP setup

The app exposes an MCP server at `/api/mcp` (HTTP transport), gated by a bearer
key. Claude Code uses it to list projects/items and move items across the board.

Registration mirrors the `time` app: the server is added at **user scope** with
the key embedded in your local Claude Code config (`~/.claude.json`). No
project-scoped `.mcp.json` (so no secret in the repo, no approval prompt) and no
shell env var on the client side.

## 1. Generate the key (server side)

```bash
printf 'mykan_sk_%s\n' "$(openssl rand -base64 32 | tr -d '/+=')"
```

This value is the key the **server** accepts. Set it as `MYKAN_SERVICE_API_KEY`
in the Vercel project env (production) and, for a local dev server, in
`.env.local`. It's a comma-separated list, so rotate by adding a new key and
removing the old once the client is updated.

## 2. Register with Claude Code (client side)

Add the server at user scope with the same key embedded (available in every
project, no approval, no env var):

```bash
claude mcp add --transport http --scope user mykan \
  https://kanban.dbwoodward.com/api/mcp \
  --header "Authorization: Bearer <the key from step 1>"
```

To target a local dev server instead, run `npm run dev -- -p 3005` and add a
second entry pointing at `http://localhost:3005/api/mcp`.

Verify: `claude mcp get mykan` shows **✔ Connected**; in a session `/mcp` (or
`/tools`) lists `mcp__mykan__list_projects`, `…__update_item_status`, etc. The
key lives only in `~/.claude.json` (your machine) and the Vercel env — never in
the repo.

## Tools

`list_projects`, `list_items`, `get_item`, `update_item_status`,
`create_item`, `append_item_note`, `set_item_body`, `set_item_tags`,
`set_item_area`, `set_item_assignees`.

`set_item_body` REPLACES an item's whole body (safe overwrite): the previous
state is snapshotted to the item's history first, so it is always recoverable
from the History panel (clock icon on any row/card).

## How it works

Both the browser (Auth.js session) and Claude Code (bearer key) call the same
shared core (`lib/projects-core.ts`, `lib/items-core.ts`) so behaviour never
drifts. The MCP acts as the owner identity (`MCP_ACTOR_EMAIL`, default the owner
email), so it sees private projects and stamps `created_by`/`updated_by`
accordingly. The `/api/mcp` route is excluded from the session middleware
(`proxy.ts`) and self-gated by the bearer check in `lib/service-auth.ts`.
