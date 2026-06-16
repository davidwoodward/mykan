# mykan MCP setup

The app exposes an MCP server at `/api/mcp` (HTTP transport), gated by a bearer
key. Claude Code uses it to list projects/items and move items across the board.

## 1. Generate and set the key

```bash
printf 'mykan_sk_%s\n' "$(openssl rand -base64 32)"
```

Set `MYKAN_SERVICE_API_KEY` to that value in `.env.local` (local) and in the
Vercel project env (production). Rotate by setting a comma-separated list and
removing the old value once clients are updated.

## 2. Export it in your shell (for `.mcp.json` expansion)

```bash
export MYKAN_SERVICE_API_KEY=mykan_sk_...
```

## 3. Register with Claude Code

The repo's `.mcp.json` points at the deployed app. To use it elsewhere or to
target local dev:

```bash
# deployed
claude mcp add --transport http mykan https://kanban.dbwoodward.com/api/mcp \
  --header "Authorization: Bearer ${MYKAN_SERVICE_API_KEY}"

# local dev (run `npm run dev -- -p 3005` first)
claude mcp add --transport http mykan-local http://localhost:3005/api/mcp \
  --header "Authorization: Bearer ${MYKAN_SERVICE_API_KEY}"
```

Verify: `claude mcp list` shows `mykan` connected; in a session `/tools` lists
`mcp__mykan__list_projects`, `…__update_item_status`, etc.

## Tools

`list_projects`, `list_items`, `get_item`, `update_item_status`,
`create_item`, `append_item_note`, `set_item_tags`.

## How it works

Both the browser (Auth.js session) and Claude Code (bearer key) call the same
shared core (`lib/projects-core.ts`, `lib/items-core.ts`) so behaviour never
drifts. The MCP acts as the owner identity (`MCP_ACTOR_EMAIL`, default the owner
email), so it sees private projects and stamps `created_by`/`updated_by`
accordingly. The `/api/mcp` route is excluded from the session middleware
(`proxy.ts`) and self-gated by the bearer check in `lib/service-auth.ts`.
