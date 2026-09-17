# mykan continuation handoff

**Updated 2026-09-17, after KANBAN-45 (renameable project keys) and its project-panel abandon
follow-up were confirmed by David and moved to Done. Next: KANBAN-38 (entry panels on the card
page), once KANBAN-44 is confirmed and its open question is answered.**

## At a glance

- **The epic in flight is KANBAN-34, "Clean cards".** Cards worked by Claude Code were bloating
  because progress was appended to the description (BRAIN-8 reached a 98K-character body). The
  description is now a clean living spec; progress, questions and decisions live in their own
  versioned entries. Epic: https://kanban.dbwoodward.com/KANBAN-34 — 3 of 6 children done.
- **Work order (David, 2026-09-16), one card at a time by subagents; David is told after each
  card and decides when to continue:**
  1. KANBAN-35 — Done (PR #113)
  2. KANBAN-41 — Done (PRs #114, #115). Not a child of the epic.
  3. KANBAN-36 — Done (PR #116)
  4. KANBAN-37 — Done (PR #117)
  5. KANBAN-42 — Done (PRs #118, #119). Not a child.
  6. **KANBAN-44 — Testing** (PR #120). Not a child.
  7. KANBAN-45 — Done (PRs #121, #122). Not a child.
  8. **KANBAN-38 — next**
  9. KANBAN-39
  10. KANBAN-40
- **Open before KANBAN-38:**
  - David verifies the KANBAN-44 card pages and answers its open question entry: should a single
    click on a board/list card open its page, or keep select-then-open (pencil, double-click,
    Enter)?
  - Confirm `/ZZZZ-1` returns a real **404 status** when signed in (only checked signed out, where
    every URL redirects to sign-in). If it's 200, drop the DB lookup from the page's
    `generateMetadata`.
  - Throwaway smoke-test card **KANBAN-43** can be deleted in the UI (MCP has no delete tool).

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

## Next: KANBAN-38 — entry panels on the card page

- **Scope:**
  - Progress, and Decisions & Questions, panels on the card page.
  - Add/edit/delete/restore entries.
  - Answer a question.
  - Supersede a decision.
  - Per-entry history with restore.
  - An "N open questions" badge on board/list cards.
- **Where it plugs in:** the `PANELS` list in `components/CardPage.tsx`.
- **Reuse:** the core functions in `lib/item-entries.ts` (rules in `lib/item-entries-rules.ts`),
  and the save-on-finish + abandon mechanism (`lib/abandon.ts`, `components/useAbandonable.ts`,
  `components/AbandonButton.tsx`).
- **Entry body is plain text**; markdown rendering is probably wanted.
- Read `docs/DESIGN.md` and `~/dev/me/standards/ui-ux.md` first.

## After that

- **KANBAN-39:** convert BRAIN-8 to the new model (clean description with reversals applied,
  roughly 20 decisions, progress entries, open questions; show David the rewritten description
  before replacing it), then find other bloated cards.
- **KANBAN-40:** record the card / lobe / handoff boundary in
  `~/dev/me/standards/crew-conduct.md` (dated), the work-item skill, and any agent that writes
  card notes.

## Decisions and corrections from David worth carrying forward

- Records he can see must be editable and versioned; never propose immutable ones.
- Don't take away an ability to protect references to something (keys were briefly made
  permanent in #120; reversed in #121). Keep it editable, warn, and keep old values working.
- `list_items` returning titles only is fine as long as Claude knows to call `get_item` for
  content.
- One environment: `main` is prod, period.
