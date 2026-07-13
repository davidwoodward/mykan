# mykan — GitHub integration

Status: **spec / not yet built.** This captures the design agreed during noodling on
2026-07-13. It deliberately records the *decisions and their reasons*, not just the
end state, so the "why" survives into implementation.

## Why this exists

The integration grew out of one concrete need: **import GitHub issues into mykan** so work
tracked upstream lands in the same board an agent already operates. Everything else here is
the minimum scaffolding that need requires, plus the natural other half of the loop.

The finished shape is a **symmetric loop**:

- **In:** an open GitHub issue → *import* → a Not Started mykan item under the repo's area.
- **Out:** a mykan item → *Done* → the linked issue is *closed*. Move it back out of Done →
  the issue is *reopened*.

This deepens mykan's agent-native moat: pull your issues into the tracker, then have an agent
work them where the code lives, and completion flows back to GitHub automatically.

## Core model — three layers

The key insight that made this clean: **the account is the credential boundary.** Separate the
shared *fact* of an account from the personal *secret* that reaches it.

### 1. GitHub account — global entity

A system-wide row identifying a GitHub account/org by its canonical `login`. Registered once;
shared across all mykan users. The first person to connect a new account creates this row.

### 2. Credential (PAT) — per (user, account)

**The only user-supplied secret in the system.** One row per *(mykan user × GitHub account they
connected)*, holding *that user's* fine-grained PAT.

- **This is mykan's first user secret at rest.** Every existing secret (`MYKAN_SERVICE_API_KEY`,
  Supabase keys) is a *system* secret in Vercel env. This is different: a per-user secret in the
  database. That raises the bar — see Security below.
- **Actor rule:** whoever runs the action (UI session user, or MCP-authenticated user) — *their*
  PAT is used. Always. **No credential borrowing** — a user never rides another user's token.
  If the acting user has no PAT for the relevant account, the GitHub side-effect is skipped and
  surfaced (never blocked); see failure handling.

### 3. Associations — global

- **`project → account`** (1:1). A project pulls from exactly one GitHub account. Multiple
  repos may live within that account.
- **`area path → repo`** (within the project's account). This binding *is the import routing*:
  issues from repo R become items under the area bound to R. No "which area?" ambiguity.

Both associations are global (shared pool) — everyone sees the same project↔account and
area↔repo mappings.

## Authentication — Connect GitHub Account

A **Connect GitHub Account** control (the GitHub icon) in mykan settings. It captures:

- the **account name** (validated/canonicalized against GitHub on connect — see below), and
- the user's **fine-grained PAT**.

### PAT scope — mint once for the roadmap

We do **not** ask users to mint a read-only token, because read scope is short-lived (write-back
is part of the design). Users mint **once**, scoped to what the roadmap needs:

- **`Metadata: read`** — mandatory baseline for any fine-grained PAT.
- **`Issues: read & write`** — read covers import; write covers Done→close / un-done→reopen.
- **`Pull requests: read & write`** — *only if* PR interaction is genuinely committed; otherwise
  omit. "Roadmap scope" means committed work, not "everything GitHub offers."

Connect helper text, roughly: *"Create a fine-grained PAT on <account> with Metadata: read and
Issues: read & write, then paste it here."*

Fine-grained PATs are **per-account by nature** — which matches our credential boundary exactly.
Caveats to surface in the UX: an **org** account may require an admin to approve the PAT before it
works, and fine-grained PATs carry a **max ~1-year expiry**, so the reconnect lifecycle below is
always necessary.

### Credential lifecycle

1. **Validate on connect** — call GitHub `/user` (or equivalent) with the token to confirm it
   works and to capture the *real* login, rather than trusting the typed name.
2. **Encrypt at rest** (see Security).
3. **Write-only** — after entry, show "Connected ✓" state, never the token value back.
4. **Detect expiry/revocation** — on a `401`/`403` from GitHub, mark *that* credential invalid and
   surface a per-user **"reconnect your GitHub for <account>"** state, without disturbing anyone
   else's credential or the shared associations.

## Import — GitHub issues → mykan items

The whole import reduces to: *pull open issues, drop any already imported, create the rest as
Not Started items under the repo's area.*

### Rules

- **Open issues only.** Closed issues are never imported.
- **Never re-import a live item** — dedupe by the item backlink `owner/repo#number`: if a mykan
  item with that backlink **currently exists**, skip it. "Never" is *relative*: if the item was
  **deleted** and the issue is **still open**, a later import brings it back (legitimate — the
  work is still open upstream).
- **Always → status `new` ("Not Started").** No open→status mapping table; every import lands in
  Not Started.
- **Routing:** issues land under the **area bound to their repo**.

This interlocks nicely with write-back: **Done→close** is what keeps *completed* work from
re-importing (finishing closes the issue; closed issues never import). Delete-without-done
re-surfaces open work; Done removes it permanently. No import ledger table is needed — the live
items' backlinks are the dedupe set.

### Field mapping

| GitHub issue | mykan item | Note |
|---|---|---|
| title + body (markdown) | item body (Tiptap JSONB) | markdown→Tiptap kept **basic** in v1 (paragraphs/lists); the name is computed from the first body line anyway |
| state (open) | status `new` | always Not Started; closed never imported |
| labels | tags | **auto-create** missing tags |
| — (type) | `task` (default) | imported issues default to type `task` |
| assignees | — | **dropped** — GitHub usernames won't match mykan's whitelist emails (`normalizeAssignees` would filter them out) |
| number/url | `items.github_issue` backlink (`owner/repo#number`) | the dedupe key |

## Write-back — Done ⇄ issue state

The other half of the loop, tied to the **Done boundary**:

- **Item enters Done** → **close** the linked issue.
- **Item leaves Done** (un-done) → **reopen** the issue.

Rules:

- **Actor = whoever performs the status change** (UI session user or MCP-authenticated user);
  their PAT does the write.
- **No PAT for that account?** Skip the GitHub write, **don't block the Done** in mykan, and
  surface a visible "GitHub not updated" state on the item. Never borrow another user's token.
- **Failure never rolls back the mykan change.** Expired/revoked PAT, network error, GitHub
  down → the item still moves; the write is a best-effort side-effect that surfaces a retry-able
  "not synced" state.
- Closing an already-closed issue / reopening an already-open one is a harmless no-op.

## MCP

Per the standing rule, new surfaces ship with MCP parity — **with one deliberate carve-out:**

- **Credential entry stays human-UI-only.** An agent must never be able to *set* a PAT. The
  Connect flow is not an MCP tool.
- **Associations** (project→account, area→repo) and **import** and **status changes** (which
  drive write-back) *do* get MCP tools / parity.

**MCP must become per-user authenticated.** Today MCP is a single `MYKAN_SERVICE_API_KEY`
identity, so it can't tell "David" from "Kenyon" — and therefore can't pick whose PAT to use.
Moving MCP to **per-user bearer tokens** (token → mykan user → that user's PAT) is a prerequisite
for MCP-driven import/write-back. It's valuable beyond GitHub (per-user attribution and
revocation), so it's treated as its own foundational piece, not part of the import feature.

## Phasing

- **Phase I — UI, full loop.** Connect GitHub + encrypted per-user PAT store + associations
  (project→account, area→repo) + **UI import** + **UI write-back** (Done→close, un-done→reopen).
  Needs **no** MCP change — the logged-in session *is* the identity.
- **Phase I.5 — per-user MCP authentication.** Foundational; unlocks the MCP half. Valuable on
  its own.
- **Phase II — MCP import + MCP write-back**, built on I.5.

Deliberately deferred: webhooks / live two-way sync (GitHub App territory), PR write-back,
`Contents` scope for code-level agent operations, rich markdown fidelity.

## Security considerations

- **First user-secret at rest.** Per-user PATs live in the DB and **must** be:
  encrypted at rest, write-only (never returned to the client), least-privilege in scope
  (Issues, not repo-wide), and lifecycle-managed (validate-on-connect, revocation detection,
  per-user reconnect).
- **Encryption mechanism — spec-time decision, not yet made:** Supabase Vault vs app-level AES
  with a KEK held in Vercel env. Either keeps the *user* secret out of plaintext and the *system*
  key (the KEK) in env — never a raw PAT in env, never a plaintext PAT in the DB.
- **Never store raw PATs in Vercel env** — env is global config and can't be per-user; per-user
  secrets belong in the (encrypted) DB.
- **Blast radius:** because tokens are Issues **read+write**, a leak can rewrite issues, not just
  read them. That is the explicit justification for the encrypt-at-rest + write-only discipline —
  it is the price of holding a write-capable token, accepted knowingly.

## Schema deltas (indicative)

- `github_accounts` — global registry: `id`, `login`, created-by/at.
- `github_credentials` — per-user secret: `id`, `user`, `account_id`, `encrypted_pat`,
  `status` (active/invalid), `expires_at?`, created/updated. Encrypted, write-only.
- `projects.github_account_id` — nullable FK to `github_accounts`.
- `categories.github_repo` — nullable `owner/repo` on the area node.
- `items.github_issue` — nullable backlink `owner/repo#number` (+ maybe url); the dedupe key
  and the write-back target.
