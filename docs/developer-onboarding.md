# Developer onboarding

Welcome. This is everything **you** (a developer joining a project) need to do to
start working in mykan and driving it from Claude Code. It picks up **after the
project owner has added you** — two things happen on their side first:

1. **Your email is whitelisted** so you can sign in at all.
2. **The project is shared with you** so it's visible once you're in.

You don't do either of those — if you can't sign in or can't see the project,
that's on the owner, not you (see [Troubleshooting](#troubleshooting)). Everything
below is yours to do.

Use the **exact Google account** whose email the owner whitelisted. A different
Google account — even yours — will be rejected.

---

## 1. Sign in

1. Go to **https://kanban.dbwoodward.com**.
2. Click **Sign in with Google** and pick the whitelisted account.
3. You land on the board. The project the owner shared with you is listed — open
   it with the project picker (back-chevron in the top bar).

If you see **"That account is not authorized to use Mykan,"** you signed in with
the wrong Google account. Sign out and retry with the whitelisted one.

## 2. (Recommended) Connect your GitHub

If your project uses the GitHub integration (issues/PRs mirrored as cards), connect
**your own** GitHub PAT so refreshes and write-backs are attributed to *you*, not a
shared identity:

- Click the **GitHub icon** in the top bar and follow the connect flow.
- Full detail — token scopes, org-repo scoping, what syncs — is in
  [`github-integration.md`](./github-integration.md).

Skip this if your project doesn't touch GitHub.

## 3. Connect Claude Code over MCP

This is what lets Claude Code (interactive **and** headless/cron) list your
projects, move cards, edit items, and drive the GitHub tools **as you**. You need
[Claude Code](https://claude.com/claude-code) installed first.

### a. Mint your personal token

1. In mykan's top bar, click the **key icon** (🔑, next to the GitHub icon) →
   the **MCP access tokens** panel opens.
2. Optionally type a **label** (e.g. `laptop`, `cron agent`) so you can tell
   tokens apart later.
3. Click **Generate token**.
4. A `mk_…` value appears with **"Copy this token now — it won't be shown
   again."** Copy it immediately — only its hash is stored, so it is
   **unrecoverable** afterward. If you lose it, just generate another and revoke
   the old one.

The token carries **your identity and your GitHub PAT reach** — treat it like a
password. Revoke any token from the same panel (the ✕); revocation is immediate.

### b. Register with Claude Code

The panel shows a ready-to-paste command right under the token. It registers the
server at **user scope** — available in every project on your machine, no repo
secret, no approval prompt:

```bash
claude mcp add --transport http --scope user mykan \
  https://kanban.dbwoodward.com/mcp \
  --header "Authorization: Bearer <your mk_… token>"
```

The **same** command and token work for headless/cron agents — there is no
browser step. (Interactive browser OAuth — an "Authenticate → Google" button — is
**not** built; the token is the intended mechanism and is actually simpler for
headless use.)

### c. Verify

```bash
claude mcp get mykan          # should show ✔ Connected
```

Then in a Claude Code session, `/mcp` (or `/tools`) should list the mykan tools:
`mcp__mykan__list_projects`, `mcp__mykan__update_item_status`, and the rest. Your
token lives only in `~/.claude.json` on your machine — never in the repo.

> If you registered before new tools shipped, restart the session — MCP tool
> lists load once per session.

## 4. Work

Ask Claude Code naturally — it maps to the tools:

- *"List my mykan projects / items in Permit Saige"* → `list_projects`, `list_items`
- *"Move KANBAN-N to In Progress / Done"* → `update_item_status`
- *"Create a task in Permit Saige: …"* → `create_item`
- *"Refresh KANBAN-N from GitHub"* → `refresh_item_from_github`

Full tool list and semantics: [`mcp-setup.md`](./mcp-setup.md).

If the owner installed the **work-item** skill for you, you can also say
*"work the next Permit Saige item"* and Claude Code will pick it up, move it to In
Progress, do the build from its description, and move it to Done.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "That account is not authorized" on sign-in | Wrong Google account, or not whitelisted yet | Use the whitelisted account; if it still fails, the owner needs to whitelist your email |
| Signed in, but the project isn't listed | Project not shared with you | Ask the owner to share it (adds you to the project's members) |
| `claude mcp get mykan` shows not connected | Bad/typo'd token, or token revoked | Re-mint a token (§3a) and re-run the `claude mcp add` command |
| Tools missing in a session after connecting | Tool list cached for the session | Restart the Claude Code session |
| GitHub refresh/write-back fails | No GitHub PAT connected, or wrong scopes | Connect your PAT (§2); see `github-integration.md` for scopes |

## See also

- [`mcp-setup.md`](./mcp-setup.md) — the MCP server, tools, and how auth works
- [`github-integration.md`](./github-integration.md) — GitHub PAT setup and sync
- [`DESIGN.md`](./DESIGN.md) — mykan's interaction patterns
