# Master list (focus list) handoff

**Updated 2026-11-24.** Epic **KANBAN-74** (https://kanban.dbwoodward.com/KANBAN-74).
Cards KANBAN-75 to 83 are shipped, deployed and in **Testing**: David verifies them on prod.
KANBAN-84 to 88 are **not started**. Two of them have open questions for David that must be
answered before building. Start by running `epic_table KANBAN-74` and `get_item` on each open
card.

## What this is and why

David works across many mykan projects (Amos, Permit Saige, Perp, fPoon, Asset Relay, mykan,
personal). He wanted one **master list** of what matters right now, kept in front of him in the
app and in every Claude Code session. In mykan it is called the **focus list**.

Decisions David made (recorded on the cards):
- **First-class and owner-only.** Nobody but the owner can see a person's list, or that a card is
  on it. That rules out using a tag.
- **One global ranked list.** Forcing Amos vs PS vs Perp into one order is the point.
- **Opt-in per user, off by default.** David is the only cross-project user; for most people a
  project is a business.
- **No weekly reset.** Reviews are triggered instead: an entry completes, the list drops to the
  minimum, the daily review hour, or an entry goes stale. All thresholds are per-person settings.
- **Hard cap on entries.** Default 7, set in settings. When the list is full you must drop
  something before you can add.
- **Personal items live in a hidden personal project.** mykan creates it automatically (key ME,
  ME2, ...). It never shows in project lists and is reached only through the focus list.
- **Pushing a card takes only its title.** On the list the entry's title can be reworded without
  touching the card, and the entry still links to the card.

## What's shipped (all on prod)

| PR | Cards | What |
|---|---|---|
| #185 | 74–81 | Schema, on/off switch, Home list, tick-off, review triggers, MCP tools, `/api/focus/brief` + SessionStart hook |
| #186 | 75, 77 | Personal project can't be shared (no share control; API refuses); history shows "Nd on list" |
| #187 | 82 | `focus_entries.label` (the entry's own title); target icon on the card page; `edit_focus` MCP tool |
| #188 | 83 | Target icon on list rows and board cards |

Migrations applied to prod (each was rehearsed first in a transaction that was rolled back):
- `supabase/migrations/2026-11-24-1-focus-list.sql`: `projects.is_personal` (one per owner),
  `focus_settings`, `focus_entries`, and the `focus_entries_complete_on_done` trigger.
- `supabase/migrations/2026-11-24-2-focus-entry-label.sql`: `focus_entries.label`.

Rehearsals are in `supabase/rehearsals/2026-11-24-*.rehearsal.sql`.

David's state: his list is **on** (his personal project exists, key `ME`). His entries in the
screenshot he sent were ME-1, ASSET-230 and KANBAN-74.

## Code map

- `lib/focus-rules.ts` (pure, tested in `lib/focus-rules.test.ts`):
  - Settings validation; `capError`.
  - `dailyWindowStart`, which works in the person's IANA time zone.
  - `reviewReasons`.
  - `entryTitle` (label, else the card's title); `formatFocusText`, used by `get_focus` and the hook.
  - `displayProjects`, which hides personal projects; `personalKeyCandidates`.
- `lib/focus-core.ts` (server-only), every query filtered by the actor's email:
  - Settings: `getFocusSettings`, `updateFocusSettings`, `ensurePersonalProject`.
  - Reads: `loadFocus` (the full view, side-effect free), `focusCandidates`,
    `focusStateForItem` (card page), `activeFocusItemIds` (row targets).
  - Writes: `addFocusEntry`, `setFocusOrder`, `dropFocusEntry`, `completeFocusEntry`,
    `updateFocusEntry`, `confirmFocusReview`.
- `lib/focus-privacy.test.ts` reads the source and pins:
  - every focus query is scoped to the actor;
  - only focus-core touches the focus tables;
  - every focus route is gated;
  - personal projects are hidden from every list;
  - a personal project can't be shared.
- API routes, all under `app/api/focus/`:
  - `route.ts`: GET the list; POST to add.
  - `settings`, `order`, `entries/[id]` (PATCH to complete, label, why_now or target_date; DELETE to drop).
  - `review`, `candidates`, `ids`.
  - `brief`: plain text; takes an `mk_` bearer token or a session; empty when the list is off.
- UI:
  - `components/FocusList.tsx`: Home list, review banner, add typeahead, inline title + why-now edit, history.
  - `components/FocusSettingsPanel.tsx`: inside `ProfileMenu`.
  - `components/FocusPushButton.tsx`: card-page target; exports `TargetIcon`.
  - `components/FocusRowTarget.tsx`: `FocusRowProvider` (mounted in `ProjectDetailView` only when
    the viewer's list is on and the view isn't archived) and `FocusRowTarget`, used in `ItemList.tsx`
    and `Board.tsx`.
  - Home renders `FocusList` only when the setting is on (`app/page.tsx`).
  - `app/[ref]/page.tsx`: decides `focusState` (card page) and `focusOn` (board) server-side, and
    redirects a personal project's bare `/KEY` home.
- MCP (`lib/mcp-server.ts`, `registerFocusTools`): `get_focus`, `add_focus` (`item` or `text`,
  optional `label`), `edit_focus`, `set_focus_order`, `drop_focus`, `complete_focus`,
  `confirm_focus_review`. Server instructions are in `lib/mcp-entry-guards.ts`; docs in `docs/mcp-setup.md`.
- Hook:
  - Source: `scripts/focus-session-start.mjs`.
  - Installed copy: `~/.claude/hooks/mykan-focus.mjs`, registered under `hooks.SessionStart` in
    `~/.claude/settings.json` next to brainer's hook.
  - Reads the token by reference from `~/.config/mykan/mcp-token`.
  - The installed copy lives outside the repo, so a new machine needs it copied again.
- Design notes: `docs/DESIGN.md`, section "Focus list".

## What remains (build order)

1. **KANBAN-85: compact rows.**
   - One line per entry: `2 F ASSET-230 Inventory: add…`.
   - Type letters: F feature, E epic, T task, B bug, I idea ("Thought").
   - The letter is **blank for personal (ME) entries**.
   - Applies to the Home row's first line, the peek popover, the overlay, and `formatFocusText`
     (add a `T` column; update `lib/focus-rules.test.ts`).
   - Small and pure; do it first, since KANBAN-84 reuses it.
2. **KANBAN-86: ME entries show a status nobody can change.**
   - Blocked on its open question: (a) hide the status on ME entries; (b) a status menu on the
     focus row; (c) a status menu for every entry.
   - Don't build until it's answered (`answer_question`).
3. **KANBAN-84: focus peek in the top bar.** The biggest piece.
   - A target icon on the top bar of every page, for someone whose list is on (decide server-side
     in `app/page.tsx` and `app/[ref]/page.tsx`).
   - Hover shows the compact list in a popover (read-only).
   - Click opens the full `FocusList` in an overlay (dialog/sheet) **without leaving the page**:
     no navigation, URL, filters and scroll position kept.
   - Badge: entry count, plus an accent dot when a review is due.
   - On touch, a tap opens the overlay.
   - After a change in the overlay, the row targets underneath should update. Lift
     `FocusRowProvider`'s set, or have the overlay call a refresh on it.
   - It stays on the top bar on phones, even after KANBAN-87.
   - Overlays must close on Esc and on a press outside (`~/dev/me/standards/ui-ux.md` §1).
4. **KANBAN-87: mobile top bar.**
   - On the `compact:` layout, GitHub connect, MCP tokens and the theme toggle move into the
     profile menu, above "Keyboard-forward navigation".
   - Each opens its existing popup, as a sheet or centred dialog fitted to `visualViewport`.
   - Desktop is unchanged.
   - Components: `GithubConnect.tsx`, `McpTokenSettings.tsx`, `ThemeToggle.tsx`, `ProfileMenu.tsx`.
     Each popup's open state is local to its component today, so expose an "open" entry point.
5. **KANBAN-88: left side of the top bar.**
   - Icon-only brand (`Brand.tsx`); keep `<` for the project picker; remove the pencil; the project
     name opens the editor (`ProjectHeader.tsx`).
   - Open question: phones only, or desktop too.

When each card ships: progress note, move to **Testing**, and give David click-by-click checks.
Then reconnect MCP if tool shapes changed.

## Standing rules for this repo (read before building)

- `AGENTS.md`: ship end to end. Conventional commit, branch, PR, then
  `gh pr merge <n> --squash --admin --delete-branch` once CI `build` and Vercel pass. Merging
  deploys prod. Sync `main` after.
- **One environment.** The Supabase project is production; there is no dev DB.
- **Migration routine:**
  1. Write the migration plus a rehearsal (a DO block of PASS/FAIL cases that ends in a raised
     exception).
  2. Run them together and rolled back (`docs/_continue/master_list_tools/rehearse.mjs`).
  3. Confirm nothing persisted.
  4. `npm run db:migrate`.
  5. Merge.
  Migrations must be additive and safe for the code currently deployed.
- **Owner-only is app-enforced.** The service role bypasses RLS. Every focus query filters by the
  actor's email, and `lib/focus-privacy.test.ts` checks it. Keep it passing and extend it.
- **UI:** read `docs/DESIGN.md` and `~/dev/me/standards/ui-ux.md` first.
  - Tokens only, no hard-coded colours.
  - Icon buttons carry `title` + `aria-label`.
  - Enter is the primary action; Esc abandons or closes; overlays also close on a press outside.
  - Nothing browser-only may render on the first client pass.
- After any change to `proxy.ts`, the matcher, auth or headers: `npm run smoke:auth-gate`.
- Before shipping: `npx tsc --noEmit -p .`, `npx eslint .`, `npm test`.

## How to verify UI without David's Google sign-in

`docs/_continue/master_list_tools/`:

1. `npx next build`.
2. Copy `serve-signed-in.mjs` into the repo root (it must resolve `@auth/core`). Run
   `node --env-file=.env.local ./serve-signed-in.mjs <dir>/server.json &`, then delete the copy.
   - It starts `next start` on a free port with a throwaway `AUTH_SECRET`.
   - It writes `{base, cookie, pid}` for a made-up user, `focus-check@example.invalid`.
   - That user has no projects of its own; create a throwaway project through `/api/projects`.
3. Drive the API with `curl -b "authjs.session-token=<cookie>"`.
4. Take screenshots: `node cdp-shot.mjs <dir> '[{"name":"x","path":"/KEY","width":400,"mobile":true,"dark":true,"before":"<js>"}]'`.
   - Headless Chrome, throwaway profile, free port, closed by PID afterwards.
   - Never drive David's real Chrome.
5. **It talks to the production database.** Afterwards, delete every row for the fake email:
   `focus_entries`, `focus_settings`, and projects `created_by` it (which cascades to items).
   Confirm all three counts are zero.
   - Personal-project keys are taken in order: the first enable takes the next free `ME<n>`.
     `ME` is David's now.
6. Stop the server by its PID and confirm no Chrome is left on the throwaway profile.

Never print `.env*` or the token. `SUPABASE_ACCESS_TOKEN` is used only by reference, via
`--env-file`.

## Other open items

- KANBAN-32 (My Queue) is unrelated, per David. Leave it alone.
- Old card bodies for 74–83 match what shipped. Re-read a card with `get_item` before rewriting it.
