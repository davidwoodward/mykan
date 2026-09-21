# mykan continuation handoff

**Updated 2026-09-21. KANBAN-50 is in Testing and needs an MCP reconnect before it can be
verified (see below). Next: KANBAN-39 (convert BRAIN-8), then KANBAN-40. KANBAN-32 has three
open questions waiting on David and must not be built before they are answered.**

**Updated 2026-09-18. Everything that was in Testing is Done (David verified on prod).**

## At a glance

- **The epic in flight is KANBAN-34, "Clean cards".** Cards worked by Claude Code were bloating
  because progress was appended to the description (BRAIN-8 reached a 98K-character body). The
  description is now a clean living spec; progress, questions and decisions live in their own
  versioned entries. Epic: https://kanban.dbwoodward.com/KANBAN-34 — 4 of 6 children done.
- **Work order (David, 2026-09-16), one card at a time by subagents; David is told after each
  card and decides when to continue:**
  1. KANBAN-35 — Done (PR #113)
  2. KANBAN-41 — Done (PRs #114, #115). Not a child of the epic.
  3. KANBAN-36 — Done (PR #116)
  4. KANBAN-37 — Done (PR #117)
  5. KANBAN-42 — Done (PRs #118, #119). Not a child.
  6. KANBAN-44 — Done (PR #120). Not a child. (Was Testing; David confirmed 2026-09-17.)
  7. KANBAN-45 — Done (PRs #121, #122). Not a child.
  8. KANBAN-38 — Done (PRs #124, #126)
  9. **KANBAN-39 — next**
  10. KANBAN-40
- **Shipped and confirmed 2026-09-18** (all Done): KANBAN-12 (row actions by the type pill,
  trash icon on list rows and board cards), KANBAN-13 (a tall list row pins its whole strip:
  grip, status, ref, actions), KANBAN-15 (paragraph gaps on cards, Done cards stay compact),
  KANBAN-28 (GitHub "?" help), KANBAN-38 (entry panels + open-questions badge), KANBAN-46 (Esc in
  a card's text saves and returns; green save icon), KANBAN-47 (one app-wide prompt tooltip
  layer), KANBAN-48 (MCP steers open questions into ask_question), KANBAN-49 (dark mode survives
  a reload).
- **In Testing 2026-09-21: KANBAN-50** (PR #145, deployed to prod) — MCP card reads no longer
  repeat the title. `get_item` used to return `name` (the title) and `body_text` (the whole body,
  title line included), so `name` was always a strict prefix of `body_text` and every agent
  reported it as a duplication bug. Responses now carry `name` + `body_after_title` (the
  description with its title line removed); `body_text` stays on `ItemDetail` for the web and
  Telegram and is stripped in `json()` by `forMcp()`, so every tool returning an item detail is
  covered, not only `get_item`. `set_item_body` gained an optional `title` matching that pair —
  without it a rewrite would have to reassemble the body from a title capped at 200 chars, which
  would silently truncate long titles. No migration; the stored model is unchanged. A stored title
  column was considered and rejected (decision on KANBAN-50): it needs a migration, does not remove
  the overlap on its own, and brings back the two-field editing confusion from KANBAN-8.
  - **Every MCP session must reconnect** (`/mcp` → mykan → Reconnect): both a response shape and an
    arg schema changed, so a session on the cached schema sees `body_text` disappear.
  - **To verify after reconnecting:** `get_item` on any card — the response should show
    `body_after_title` and no `body_text`, and the title should NOT reappear inside
    `body_after_title`. Then a mutator (`update_item_status`, or `create_item` on a throwaway
    card): those return an item detail too and must also come back without `body_text`.
  - `~/.claude/skills/work-item/SKILL.md` was updated to match; it lives outside this repo, so a
    fresh machine needs that edit reapplied.
- **Closed without building:** KANBAN-11, 17, 27 (already delivered elsewhere) and KANBAN-33
  (dev environment: won't do, one environment).
- **Waiting on David:** KANBAN-32's three questions (auto-fill the tester on Testing? My Queue per
  project or global? keep a "Features only" start view?). KANBAN-29 (Notes) is a Thought: leave it
  Not started.

## How this project runs (standing rules)

- **One environment, by David's choice.** The Supabase project is production; merging to `main`
  deploys https://kanban.dbwoodward.com. No dev or staging, and don't propose one.
- **The system you change is the system you're tracked in.** Other Claude sessions use the mykan
  MCP at the same time. Re-read a card with `get_item` immediately before rewriting it.
- **Sessions only see new or changed MCP tools and descriptions after reconnecting** (`/mcp` →
  mykan → Reconnect). Changing a tool's behaviour (as KANBAN-37 did for `append_item_note`) needs a
  quiet moment and a reconnect of every session.
- **Migration routine** (used for #114, #116, #120, #121):
  1. The agent writes the migration plus a rehearsal file in `supabase/rehearsals/` (one DO block,
     labelled PASS/FAIL cases, ends with `raise exception 'REHEARSAL RESULTS (rolled back): …'`)
     and stops at an open PR.
  2. Run migration + rehearsal together against production through the Management API, so the
     final exception rolls everything back. Fix any FAIL, then confirm nothing persisted.
  3. Wait for CI and Vercel on the **exact PR head SHA**.
  4. Apply with `npm run db:migrate` (from a worktree: set `SUPABASE_PROJECT_REF` from
     `supabase/.temp/project-ref` and `--env-file` the main checkout's `.env.local`), then merge
     immediately.
  5. Wait for the Vercel status on the merge commit, sync `main`, delete the branch and worktree.
  - Migrations must be additive and safe for the code that's currently deployed. Never print
    `.env*` contents.
- **UI verification:** sign-in is Google-only, so agents can't drive the signed-in app. David
  verifies on production after deploy. Give him exact steps to click.
- **Refer to cards by full ref.** KANBAN-42 and FPOON-42 are different cards.

## What the card model looks like now

- **Description** = objective, scope, current plan, acceptance. Edited in place; `item_versions`
  keeps history.
- **Entries** (`mykan.item_entries`, versioned in `item_entry_versions`, restorable soft delete):
  - `progress` (current / superseded)
  - `question` (open / answered, linked to the decision that answered it)
  - `decision` (active / superseded)
  - David, 2026-09-16: entries are editable and versioned, never immutable.
- **MCP** (`lib/mcp-server.ts`):
  - `append_item_note` writes a **progress entry**, not body text.
  - Also: `record_decision` (optional `supersedes`), `ask_question`, `answer_question`,
    `update_item_entry`, `list_item_entries`, `delete_item_entry` / `restore_item_entry`,
    `list_item_entry_versions` / `restore_item_entry_version`, `set_item_type`, `set_item_parent`.
  - Each entry is capped at 2,000 characters; over the cap it's rejected, never truncated.
  - `set_item_body` warns past 8,000 characters.
  - The server sends `instructions` on connect describing the model (`MCP_SERVER_INSTRUCTIONS` in
    `lib/mcp-entry-guards.ts`).
  - `get_item` returns the title once, the body once, active decisions, open questions, a progress
    summary, parent/children, and `url`. `list_items` returns titles only, plus `url`.
- **Epics** (KANBAN-41):
  - `items.parent_id` links a child to its epic. One level only, same project.
  - Guards are enforced in the DB.
  - Deleting an epic writes history on each child.
  - Epic lists sort by status (Not started → In progress → Blocked → Testing → Done), then by
    number. Add child is multi-select.
- **Editing** (KANBAN-42, revised by David):
  - Nothing is written while typing; changes are a localStorage draft.
  - Esc, click-off or leaving saves once (one history entry).
  - The abandon icon (header, top-right) discards with no write.
  - A leftover draft offers Restore/Discard.
  - Parent-epic picks still save at pick time.
- **URLs** (KANBAN-44/45):
  - A project is `/KEY`, a card is `/KEY-N`. Each card has its own page; there's no modal.
  - Lower case redirects to upper case.
  - `/projects/<guid>` redirects to the clean URL.
  - Keys are 2–10 uppercase letters/digits, not a reserved route word.
  - Keys **are renameable** with a warning. Old keys are stored in `project_key_aliases` and keep
    redirecting and resolving over MCP.
  - Standards is `STD`.
- **Boundary:** the card holds the work, decisions and status. lobe holds durable lessons.
  `docs/_continue/` holds handoffs (linked from cards, never copied into them).

## Next: KANBAN-39 — convert BRAIN-8 to the new model

- **What it is:** BRAIN-8's description is ~98K characters of appended session log. Rewrite it as
  a clean spec with every reversal applied (hybrid retrieval reversed, repo-scoped retrieval, one
  lobe deployment with no ps-lobe, step 6 done including arming and teardown, steps 7-9 left),
  extract roughly 20 decisions (linking reversed ones with `supersedes`), turn dated updates into
  progress entries, and file the open questions (14 unresolved scope_proposal rows, the owed PII
  pass, the step-7 approvals) with `ask_question`.
- **Show David the rewritten description before replacing it.** The original stays in item
  history either way.
- "Traps" and "process learning" sections go to lobe, not the card.
- Then list cards across projects whose body is over a size threshold and propose which to
  convert.
- **Then KANBAN-40:** record the card / lobe / handoff boundary in
  `~/dev/me/standards/crew-conduct.md` (dated), the work-item skill, and any agent that writes
  card notes. KANBAN-48 already shipped the MCP half of this.

## Board sweep, 2026-09-17 (outside the epic)

- **Closed:**
  - KANBAN-17: card links, delivered by KANBAN-44.
  - KANBAN-11: RLS was already on.
  - KANBAN-27: Areas Esc-save, covered by KANBAN-42.
  - KANBAN-33: dev environment, won't do (one environment, rehearsal routine instead).
- **KANBAN-32 rewritten** to what's left: a tester field, a My Queue filter and a "Start me on"
  preference. Three open questions on the card for David; don't build before they're answered.
- **KANBAN-29** (Notes / meeting log) is a Thought; leave it Not started.
- **Shipped, in Testing (David verifies on prod):**
  - KANBAN-12 (#128, #132): row actions by the type pill, and a trash icon on list rows and
    board cards (`components/DeleteIconButton.tsx`). `IconTip` is now shared,
    `components/IconTip.tsx`.
  - KANBAN-15 (#129, #132): paragraph gaps on list/board cards, except Done cards in both views.
  - KANBAN-28 (#130): GitHub "?" help (`components/GithubHelp.tsx`, content in
    `lib/github-help.ts`). Unconfirmed: whether the pre-filled new-token link selects Issues
    read and write.
  - KANBAN-13 (#131): the list card's ref pins while its tall row scrolls (sm and up).
- **Prompt tooltips:** David finds native `title` tooltips too slow. New icon buttons use
  `IconTip`.

## Decisions and corrections from David worth carrying forward

- Records he can see must be editable and versioned; never propose immutable ones.
- Don't take away an ability to protect references to something (keys were briefly made
  permanent in #120; reversed in #121). Keep it editable, warn, and keep old values working.
- `list_items` returning titles only is fine as long as Claude knows to call `get_item` for
  content.
- One environment: `main` is prod, period.
- **Prod check steps must be followable:** start from a screen he can find and use the words on
  it, never internal names ("the pinned ref" cost a round trip). A static harness with copied
  markup is not verification of layout — reproduce with the real component tree (KANBAN-13
  shipped twice on harness evidence and failed twice on prod).
- **Tooltips must appear promptly** — the native `title` delay is unusable. One app-wide layer
  does this now (KANBAN-47); a tip on something the pointer rests on constantly is noise and gets
  removed.
- **Agents must not kill processes by name** (`pkill -f "next start"` killed a sibling session's
  server). Kill your own by explicit PID, as with Chrome.
