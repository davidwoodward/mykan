# mykan Telegram bot setup

The app exposes a Telegram webhook at `/api/telegram`. A bot lets you work your
board from chat: add items, list them, move them across columns, review and
add/remove tags, and set an item's Area — all from your phone.

It reuses the same shared core (`lib/projects-core.ts`, `lib/items-core.ts`) the
web app and the MCP server use, acting as the owner identity (`MCP_ACTOR_EMAIL`),
so it sees every project (including private) and stamps authorship as the owner.

## Commands

| Command | What it does |
|---|---|
| `/help` | Show the command list |
| `/projects` | List projects with their keys |
| `/list <project> [status]` | List items, optionally filtered (e.g. `/list KANBAN in_progress`) |
| `/add <project> <text>` | Add an item (the first line is the title) |
| `/item <ref>` | Show one item (e.g. `/item KANBAN-4`) |
| `/status <ref> <status>` | Move it: `new` · `doing` · `blocked` · `done` (aliases accepted) |
| `/tags <ref>` | Review an item's tags |
| `/tag <ref> +add -remove` | Add/remove tags (e.g. `/tag KANBAN-4 +urgent -later`) |
| `/area <ref> <path>` | File under an Area (e.g. `/area KANBAN-4 coach / home`; omit the path to un-file) |

`<project>` accepts a project **key** (e.g. `KANBAN`), name, or id. `<ref>` is a
`KEY-N` reference (e.g. `KANBAN-4`).

---

## Setup — what to do in Telegram (one-time)

### 1. Create the bot and get its token

1. In Telegram, open a chat with **[@BotFather](https://t.me/BotFather)**.
2. Send `/newbot`. Give it a display name (e.g. `mykan`) and a username ending
   in `bot` (e.g. `mykan_board_bot`).
3. BotFather replies with an **HTTP API token** like
   `8123456789:AAH…`. That's `TELEGRAM_BOT_TOKEN`.
4. (Optional, nicer UX) Send `/setcommands` to BotFather, pick your bot, and
   paste:

   ```
   projects - list projects
   list - list items: /list <project> [status]
   add - add an item: /add <project> <text>
   item - show one item: /item <ref>
   status - move an item: /status <ref> <status>
   tags - review an item's tags
   tag - add/remove tags: /tag <ref> +a -b
   area - set an item's area: /area <ref> <path>
   help - show help
   ```

### 2. Find your chat id (so only you can drive the bot)

A bot token is not secret enough on its own — anyone who finds the bot can
message it. The webhook only obeys chat ids in `TELEGRAM_ALLOWED_CHAT_IDS`, so
get your id now, before setting the env vars in step 3.

Message **[@userinfobot](https://t.me/userinfobot)** in Telegram; it replies with
your numeric id (e.g. `123456789`). Copy that number — it's your
`TELEGRAM_ALLOWED_CHAT_IDS` value.

> Recovery path (only if you skipped this): once the bot is deployed and the
> webhook is registered (steps 3–4), messaging the bot from a chat that isn't
> allowlisted yet makes it reply with **"Your chat id is `<number>`"**. Add that
> id to `TELEGRAM_ALLOWED_CHAT_IDS` and redeploy. Getting the id up front from
> @userinfobot avoids this extra round-trip.

---

## Setup — server side

### 3. Set the environment variables

Add the three variables to the Vercel project. Use `vercel env add` — it reads
each value from **stdin** (it prompts, you paste), so the token never lands in
your shell history or on the command line. Run these from the repo root:

```bash
vercel env add TELEGRAM_BOT_TOKEN production
vercel env add TELEGRAM_WEBHOOK_SECRET production
vercel env add TELEGRAM_ALLOWED_CHAT_IDS production
```

Each command prompts `What's the value of …?` — paste the value and press Enter:

| Variable | Value |
|---|---|
| `TELEGRAM_BOT_TOKEN` | the token from BotFather (the whole `8123…:AAH…` string) |
| `TELEGRAM_WEBHOOK_SECRET` | a random string you choose: `openssl rand -hex 32` |
| `TELEGRAM_ALLOWED_CHAT_IDS` | your chat id from step 2 (comma-separated for more than one) |

`TELEGRAM_WEBHOOK_SECRET` is echoed back by Telegram on every webhook call so the
route can reject forged requests — any random value works, it just has to match
the `secret_token` you pass in step 4.

Notes:
- If `vercel env add` reports the project isn't linked, run `vercel link` once
  and pick the mykan project.
- Env-var changes don't apply to the running deployment — after adding all three,
  redeploy production: `vercel --prod` (or push a commit / click Redeploy).
- Verify with `vercel env ls` (values are masked).
- For a local dev server, put the same three in `.env.local` instead.

### 4. Register the webhook with Telegram

Point Telegram at the deployed route, passing the same secret. Run this once
(replace the token and secret):

```bash
curl -sS "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H 'content-type: application/json' \
  -d '{
    "url": "https://kanban.dbwoodward.com/api/telegram",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message"]
  }'
```

A successful response is `{"ok":true,"result":true,"description":"Webhook was set"}`.
Check status any time with
`curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`.

### 5. Use it

Message your bot `/help`. If your chat id isn't allowlisted yet, it tells you the
id — add it to `TELEGRAM_ALLOWED_CHAT_IDS` (redeploy on Vercel for the env change
to take effect), then try `/projects`.

---

## How it works

- Telegram POSTs each message to `/api/telegram`. The route verifies the
  `X-Telegram-Bot-Api-Secret-Token` header against `TELEGRAM_WEBHOOK_SECRET`,
  then checks the sender/chat id against `TELEGRAM_ALLOWED_CHAT_IDS`.
- The command is parsed in `lib/telegram.ts` and dispatched to the shared core
  functions (`createItem`, `listItems`, `setItemStatus`, `setItemTags`,
  `setItemArea`, …) — the same ones behind the web UI and MCP, so behaviour never
  drifts.
- The route always answers Telegram with `200` (so it doesn't retry) and reports
  any problem back in the chat.
- `/api/telegram` is excluded from the session middleware (`proxy.ts`) and
  self-gated by the secret + allowlist checks.
- `TELEGRAM_API_BASE` can override the Telegram API host (defaults to
  `https://api.telegram.org`); it exists so tests can capture outbound replies.
```
