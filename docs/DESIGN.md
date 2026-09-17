# mykan — design & UX conventions

These are the interaction patterns that define how mykan feels. They are **deliberate
choices for this app** — not universal defaults. When building or changing UI here, match
these unless explicitly told otherwise. (Project-specific; the cross-project defaults live
in `~/.claude/CLAUDE.md` → "UI behavior standards". Where the two conflict, **this file wins
for mykan** — see Save on finish below.)

Verify any UI change by looking at the running app (screenshot), not just passing tests.

## Project page scroll model

Three layers, and getting this exactly right matters. The behaviour differs by breakpoint:

**Desktop (≥lg): the viewport is locked to one screen; only the board/list scrolls.**
- The page wrapper is `lg:h-[100svh] lg:overflow-hidden` and a flex column; `<main>` is
  `lg:flex lg:flex-col lg:min-h-0`.
- **Header pinned** (`sticky top-0`), **add form + toolbar are `lg:shrink-0`** (static,
  natural height), and the **List/Board is the only scroll region** — sized by flex
  (`lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain`) so it fills *exactly* the
  leftover height. There is **no whole-page scroll** — flex-fill replaced the old
  `lg:max-h-[calc(100svh-13rem)]` magic constant, which under-reserved the real chrome height
  and left a small residual page scroll *on top of* the board scroll (two scrollbars).
- **Don't reintroduce a guessed height constant** for the scroll region — let flex measure it.
- **The "tall add form" guarantee still holds** (this bit us once when the viewport was first
  locked): the add-form textarea (`AutoGrowTextarea maxHeight={240}`) caps its growth and
  scrolls internally, so a long draft never pushes the **Add button** past the locked
  viewport. Don't put `overflow` on the add-form `<section>` itself — it would clip the
  floating tag/area typeahead overlays; cap the textarea instead.

**Below `lg` (phones/tablets, incl. landscape ~960px): plain full-page scroll**, only the top
bar pinned — the wrapper stays `min-h-screen` (no lock), and the board/list is *not* a
contained scroller. The gate is `lg`, not `sm`, so a phone in *landscape* scrolls the same as
in portrait rather than trapping the list in a short contained region.

## Small-screen item rows (list view)

Below `sm` (640px) the list row stacks vertically — **status line → content → Areas/tags →
byline → controls** — so the description reads directly under the status. At `sm+` it returns
to the single fixed-column row (status · ref · content · controls). The transform is done with
`flex-col sm:flex-row` on the `<li>` plus `sm:contents` wrappers around the lead columns and
trailing controls, so the desktop row is byte-for-byte unchanged. (The hover-only Delete is
made tap-visible below `sm`, since touch has no hover.)

**Row actions sit up by the type pill (KANBAN-12).** At `sm+` the trailing controls are no longer
`sm:contents`: they are one cluster pinned to the top of the row (`sm:self-start`), level with
the first line of text, in this order: open pencil · GitHub not-synced flag (when present) ·
attachments clip · history clock (hover) · **type pill** · **delete trash icon** (hover). Delete
is an icon, not the word, and stays last (after the pill, never beside the pencil) so it isn't
easy to hit by accident; it is the same one-click soft delete (archive, restorable from the
archived view) and stays tap-visible below `sm`. Every icon in the cluster uses the prompt
styled tooltip (below), not a native `title`. The archived view's Restore / Delete forever
words are unchanged.

## Paragraph spacing on list rows and board cards (KANBAN-15, 2026-09-17)

Card text on list rows and board cards honors paragraph breaks with a **small gap
(0.4em)** so longer descriptions read more easily. Rules:

- The gap goes **between top-level blocks only** (paragraphs, headings, a code block, a
  whole list). A **hard break** (Shift+Enter) stays a plain new line, and a **list stays
  tight** (its items on consecutive lines, no gap between bullets).
- **Blank paragraphs are kept** as a blank line (plus the gap), so empty lines typed to
  separate sections still separate them; the spaced text is exactly the old text, only
  with gaps added.
- **Where:** every List view row, and every Board column **except Done**, which stays
  compact (the old single flattened text, blank lines and all) because Done piles up.
- **Unchanged:** the first line (title) sits exactly where it did (no gap above it); the
  line clamp and Show more/less still count lines across the blocks (margins don't use up a
  line); text stays plain and selectable; single click selects, double-click / pencil /
  Enter opens. The card page editor is not affected.
- **How:** `richDocBlocks` in `lib/types.ts` splits the rich body into block strings;
  `ClampedText` takes them as an optional `blocks` prop and renders each as its own `div`
  with the gap above all but the first. Leave `blocks` off for compact text.

## Header & nav

- **One app-shell width, every page.** This is an **app layout, not per-page** — every page's
  header *and* content use the **same** `mx-auto w-full px-3 sm:w-[95%] sm:px-4` container
  (wide so the multi-column Board has room; narrow margins on mobile). The home/projects page
  and the project page must match exactly, so the wordmark/nav never shifts when you navigate.
  When adding a page, reuse that same container — do not invent a per-page width.
- **Toolbar is organised by function**, left→right: **View** (List/Board + Group Status/Area)
  · **Filter** (area, tags, creator) · **Actions** (refresh, Areas manager, archived), with a
  thin divider between the view and filter clusters. Actions sit on the right; the **Areas**
  button is an action (folder icon, accent hover), not a filter.
- **One global order; several lenses.** `items.position` is a single per-project order (not
  per-status) — and it follows creation order by default (`position ≈ number × 1024`). The
  List groups it by **Status** or **Area**, or shows it **Flat** (no grouping, status as a
  pill); the **Board** groups the same order into status columns. **Every list section and
  the board are drag-reorderable** (a grip on each row; drag within a group reorders within
  it) — the archived view is the only non-draggable list. Dragging anywhere edits the one
  `position` via `computePosition` (`lib/position.ts`), so all lenses stay in sync. Status is
  also a **filter** (multi-select), independent of grouping. New items append to the global end.
- **Project identity lives in the nav.** Wordmark on the left, then a back-to-projects `←`
  arrow *beside the project name* (not left of the wordmark), the project title, and the
  byline (creator · age); the description is the title's hover tooltip. Account controls
  (email, theme toggle, sign out) sit on the right.
- **Alignment rule (this bit twice):** keep icon affordances (back arrow, brand mark) in the
  `items-center` row; reserve baseline alignment for the *text* cluster (title + byline) only.
  Don't put an icon inside a baseline-aligned cluster — it ends up vertically off.

## Save on finish & dismiss (item editing)

Editing in mykan is **implicit and forgiving**: you never hunt for a Save button, and
finishing the editor keeps your work. Since David's decision of 2026-09-16 (KANBAN-42)
it is also **quiet while you type**: nothing is written to the card until you finish, so
other sessions reading the card over MCP never see half-typed text, and a kept edit is one
history entry.

> **Since KANBAN-44 the item editor is the card page (`/KEY-N`), not a modal.** The rules
> below were written for the modal and hold unchanged; read "the modal closes" as "the
> edit finishes" and see **Card pages and clean URLs** for what finishing and leaving
> mean on a page (Esc in a field saves and settles, Esc again returns to the board;
> abandon reloads the editor and stays).

- **Nothing is written while typing.** Changes live in a local draft in the browser. The
  rich-text body (`RichTextEditor.tsx`) never saves; it reports its document to the
  editor's draft (debounced ~250ms, local only).
- **Finishing saves once.** **Esc**, a **click outside the panel**, the **✕**, or following
  a link to another card sends **one** save with only the fields that changed (body and
  tags together in one PATCH), so a kept edit is **one history entry**. **If nothing
  changed, nothing is written.** Esc here means "I'm done," not "discard."
- **A failed save keeps you editing.** The modal stays open with the text intact and says
  "Save failed (reason). Still editing, nothing lost. Esc to retry." Esc or click-off
  again retries.
- **Honest status.** The footer says "Unsaved changes · Esc or click away to save" while the
  draft differs, "Saving…" during the close save, and the failure message above. There is
  no "Saved" line: the modal closes when the save lands, and nothing claims saved while it
  isn't.
- **Crash safety: the draft is kept in the browser.** As you type, the draft is mirrored to
  `localStorage` under `mykan:draft:v1:item:<id>:<field>` (one key per field; every access
  in try/catch, so private windows just don't persist). It is cleared after a successful
  save and on abandon.
- **Restore prompt.** Opening a card that has a leftover draft differing from what's
  stored shows a small bar above the body: "You have unsaved changes to this card from
  3:42 PM." with **Restore** (primary, focused) and **Discard**. **Enter** = Restore,
  **Esc** = Discard; both buttons work by pointer/touch. Until you answer, the editing
  area is inert, so nothing typed can overwrite the draft. Restore puts the draft back
  as unsaved changes (the close then saves it); Discard forgets it without writing.
  Closing the card without answering keeps the draft for next time. A leftover draft
  that already matches the stored value (its save landed) is forgotten silently.
- **Stale drafts say so.** Each field draft records the stored value it was edited from.
  If that value has changed on the server since (another tab, an MCP write), the prompt
  adds "The card's description changed since then. Restoring replaces the newer
  description when you close." Compared per field, not by `updated_at`, which also moves on
  status or drag changes that don't touch the draft.
- **Leaving the page.** On `pagehide` (tab closed, reload, navigation) the modal sends a
  best-effort save as a `fetch` **keepalive** PATCH to the normal item route (not
  `sendBeacon`, which can only POST). Unmounting with unsaved changes for another reason
  (client-side navigation) does the same. Switching tabs (`visibilitychange` → hidden)
  only flushes the draft to storage; it doesn't write the card. If the keepalive save
  doesn't land (keepalive bodies cap at ~64KB; images are URL references, so that's rare),
  the local draft is offered back next time.
- **Edit sessions still coalesce.** Each modal open mints an `edit_session` and sends it
  with its save. Normally there is one save per open; in the rare case of two (a tab-close
  save lands, the page comes back from the back/forward cache, then the modal is closed),
  body-only saves of the same session fold into one history entry
  (`coalescesWith`, `lib/item-snapshot.ts`).
- **Two tabs on the same card:** last close wins for the card, as before. The browser draft
  is per item and field, not per tab, so two tabs on one card in the same browser share it:
  the last keystroke owns the draft, and one tab's successful save clears it.

**Enter exception (overrides the global "Enter = primary action" rule).** Item text is
multi-line: in the item-name input (`AutoGrowTextarea`) and the body editor, **Enter inserts
a newline**; **⌘/Ctrl+Enter** is the primary action (add/submit). Always show the hint
("Enter for newline · ⌘/Ctrl+Enter to add"). Esc still abandons an in-progress add.

### Abandon changes (KANBAN-42, David 2026-09-16)

Every editor has one explicit way out without saving: the **Abandon changes** icon.

- **What it does:** discards the draft and closes the editor. **No write, no history
  entry.** Because nothing is written while editing, there is nothing to revert. (The first
  version, #118, wrote the as-opened value back after autosave, which left two history
  entries per abandoned edit; that revert path, its `abandon: true` flag and the
  "abandoned edit reverted" history label are gone.)
- **The icon:** `AbandonButton` (`components/AbandonButton.tsx`), a counter-clockwise revert
  arrow, icon only, never a trash can and never red (it must not read as delete). `title` +
  `aria-label` "Abandon changes", plus a styled tooltip on keyboard focus (where a native title
  never shows). Muted ink, hover/focus to full ink with a canvas wash and an accent focus ring;
  28px in modal/panel headers and action rows, 24px beside an inline field. It sits **next to
  the ✕** in a modal header, in the action row of a panel, and **right after the field** for
  an inline editor. Its press doesn't take focus, so a blur-commits field (tags, area path,
  renames) doesn't save the very draft being abandoned.
- **One mechanism for editors of saved data:** `useAbandonable`
  (`components/useAbandonable.ts`) over the pure, tested draft session in `lib/abandon.ts`
  (`createDraftSession`, `dirtyPatch`, `restoreDecision`, `readFieldDraft`). It captures the
  as-opened values on mount, holds and persists the draft, `close(save)` sends the one save
  (or none), `abandon()` drops the draft, and it surfaces the restore prompt's decision.
  Entry editors (KANBAN-38) and the card page (KANBAN-44) reuse it.
- **Keyboard:** Esc is unchanged everywhere (finish = save, on the card page and in the
  assignee/sharing lists). The icon is pointer/touch-first; in inline fields that commit on
  blur, tabbing away commits (as before), so Esc remains the keyboard route to cancel those.

#### Editor audit (every place you edit something)

| Editor | Icon | While editing → finish → abandon |
|---|---|---|
| Card page (`CardPage`; the item detail modal until KANBAN-44): rich-text body, tags (`TagEditor`) | Card header, right end | Draft only (was: body autosaved ~700ms after typing paused, each tag add/remove saved at once) → one PATCH of the changed fields on Esc in a field / click-off / leaving the page (Esc again, back arrow, a card link, browser Back, tab close), none if unchanged; a typed-but-unconfirmed tag is included → abandon discards, no write, and reloads the editor (you stay on the page). |
| Parent epic row on the card page (`ParentRow`) | Not covered | A pick (or Remove parent) is its own immediate, recorded write, not part of the draft: the epic guards answer at pick time rather than at close. Undo by relinking. Deliberate scope line. |
| Epic's Child items on the card page (Add child, remove from epic) | Not covered | These change *other* cards' `parent_id` through explicit actions (Add N, remove icon), each its own recorded write on the child. |
| Attachments on the card page (upload, remove) | Not covered | File operations, not field edits, and not tracked by item history. Pasted body images upload at once (they need a URL) but only enter the card through the body save. |
| Attachment rename (inline, on the card page) | After the field | Commits on Enter/blur; abandon keeps the old name. Nothing written mid-edit. |
| Add Item modal (`AddItemModal`): body, type, area, parent, tags | Header, left of ✕ | Nothing saved until Add: discard the draft and close. No browser-storage draft (there is no card yet). |
| Project edit panel (`ProjectHeader`): name, description, key, GitHub account, sharing | Action row, beside ✓ | Drafts seeded on open, committed once by Esc/click-off/✓: abandon drops the drafts and closes. |
| New project form (`ProjectsView`) | Beside Create | Nothing saved until Create: discard and close. |
| Areas manager: rename (`CategoryRow`) | After the field | Commits on Enter/blur; abandon keeps the old name. |
| Areas manager: GitHub repo binding (`RepoPicker`) | After the field | Commits on Enter/pick/blur; abandon keeps the old binding. |
| Areas manager: Add field (`PathInput` builder mode) | After the field, only while it has text | Enter creates the area (an explicit add); abandon clears the draft. |
| Area picker on a row/card and in Add Item (`ItemCategory`, `DraftCategory` → `PathInput`) | After the field | Commits on Enter/pick/blur; abandon closes without changing the area. |
| Inline tag add on a row/card (`InlineTags`) | After the field | Commits on Enter/blur; abandon drops the draft tag. (A chip's ✕ is a one-click action, not an editor.) |
| Assignees list on a row/card (`ItemAssignees`) | List header | Toggles change a local list (was: each toggle saved at once) → closing the list (Esc, click-off, the trigger) saves once if the set changed → abandon closes, no write. Buffered so abandon truly means no write and a session of toggles is one write. No browser-storage draft: losing a few unsaved clicks to a crash is cheap. |
| Sharing checklist on the projects list (`ProjectShareControl saveOnClose`) | List header | Same as assignees (was: each toggle saved at once): one save on close if changed; abandon closes, no write. |
| Sharing checklist inside the project panel and new-project form (`ProjectShareControl`) | List header | Toggles stage the form's own draft at once (no DB write; staging immediately lets the form's click-off commit see the last toggle); abandon puts back the list as it was when the checklist opened. The form saves once. |
| Status picker and type picker on a row/card | None | One choice commits and closes the menu, so the menu never holds a change to abandon; choose the old value to undo (recorded in history). |
| Parent epic picker and Add child picker (`ItemTypeahead`) | None of their own | Esc and click-off close without picking; a pick is the commit. |
| MCP tokens and GitHub connect popovers | None | Action forms, not editors of saved data: nothing is written until Generate/Connect, and there is no saved value to revert to. |
| History panel, and the card page's History section (Restore) | None | Restore is a confirmed action, itself recorded in history. |
| Search, tag filter, area and status filters, view toggles | None | View state, not data. |
| Item entry editors (KANBAN-38): editing a progress note, question or decision on the card page | After the textarea, in the editor footer | Built: draft only (`localStorage` key `entry:<entryId>`) → one PATCH on Esc, ⌘/Ctrl+Enter, a press outside the editor, or leaving the page (one version; `edit_session` per open) → abandon discards, no write. Details under **Entry panels** below. |
| Entry composers (KANBAN-38): new progress note, question, decision; answer a question; supersede a decision | In the composer footer, beside Add | Same as any edit (David, 2026-09-17): draft only (its own key per item+kind, or per question/decision) → ONE post on Esc, ⌘/Ctrl+Enter, the Add button, a press outside the composer, or leaving the page; an empty or whitespace-only composer posts nothing and just closes → abandon ("Discard this draft") drops it, no write. |
| Entry actions (delete, restore a deleted entry, link an existing decision as the answer, restore a version) | None | One-click recorded writes; delete is soft and restorable from the collapsed Deleted group, version restore asks for a confirm and is itself versioned. |

## Card pages and clean URLs (KANBAN-44, David 2026-09-16)

Every card has its own page, and no user-facing URL carries a GUID.

- **URLs.** A project's board is its key at the root: `/FPOON`. A card is its ref at the
  root: `/FPOON-42`. Keys match case-insensitively and redirect to the canonical form
  (`/fpoon-42` and `/FPOON-042` both 308 to `/FPOON-42`, board query kept). `/KEY-0`, a bad
  format, a reserved word, an unknown key or card, and a project you can't see are all the
  same **404** with a real status (every decision happens before rendering; there is no
  `loading.tsx` or Suspense in `app/[ref]`, so nothing streams first). Old
  `/projects/<id>` links 308 to `/KEY`. The rules are pure and tested in `lib/card-url.ts`.
- **Keys are required.** 2 to 10 uppercase letters and digits, starting with
  a letter, unique, and never a reserved word (every top-level route in `app/`: api, mcp,
  projects, signin, icon; plus auth, login, logout, signout, settings, admin, new, home,
  static, public, favicon, robots, sitemap). The database backs it all
  (`2026-09-16-4-project-keys.sql`). The new-project form requires a key (a blank field
  uses the suggestion from the name).
- **Keys can be renamed; old keys keep working (KANBAN-45, David 2026-09-17).** KANBAN-44
  made keys permanent; that was reversed. The key field in the project edit panel is
  editable. Finishing the panel with a changed key (Esc, click-off, ✓) never saves it
  silently: an inline **warning** appears in the panel (the same inline-confirm pattern
  as History's Restore) saying what changes (every card ref becomes `NEW-N`, the board
  moves to `/NEW`) and what keeps working (`/OLD`, `/OLD-N` and `OLD-N` over MCP). **Enter**
  or **Rename key** confirms and saves; **Esc**, **Keep OLD** or a press outside the
  warning drops just the key change and leaves the panel open (Esc again then saves the
  other fields as usual). The panel lists the project's old keys. The old key is kept as
  an alias (`project_key_aliases`, `2026-09-17-1-project-key-aliases.sql`): `/OLD` and
  `/OLD-N` 308 to `/NEW` and `/NEW-N` (query kept, after the case-normalising redirect, and
  only once the viewer is known to see the project: an old key of a hidden project is the
  same 404), and MCP tools accept `OLD-N` and the old key as a project, always answering
  with the current key and url. Renaming back to one of the project's own old keys makes
  it current again. An old key can never be taken by another project (rename or create);
  deleting a project frees its old keys. After a rename the page moves to the new URL.
- **One layout, no modal.** The item modal is gone. The card page puts the **description
  in the main column** (tags, parent epic and GitHub provenance under it) and the other
  sections **beside it as tabs**: Child items (epics), Attachments, History. Below `lg`
  they stack under the description and the page scrolls. At `lg+` the page is locked to
  the viewport like the board, and the description and the tab panel **each scroll on
  their own**, so a long card never pushes anything off screen. KANBAN-38's **Progress**
  and **Decisions & Questions** join the `PANELS` list in `components/CardPage.tsx`;
  nothing else about the layout changes.
  *Built (KANBAN-38, 2026-09-17):* the tabs are now Child items (epics) · Progress ·
  Decisions & Questions · Attachments · History. A non-epic card still opens on
  **Attachments** (David, 2026-09-17) and an epic on Child items. Progress shows its live-note
  count and Decisions & Questions an accent pill with the open-question count. The
  header is a grid row across the page and the tab column is a sibling of the
  description editor, **outside** its remount (abandon, a change underneath), so an open
  entry editor is never torn down by the description's abandon. On a phone the grid is
  one `minmax(0,1fr)` column so long entries never widen the page.
- **Header.** Back-to-board arrow (title "Back to board (Esc)"), the ref as the heading
  with a **Copy link** icon (copies the full `https://…/KEY-N`), type, status, the save
  state, and the **Abandon changes** icon.
- **Opening a card.** The pencil on a row/card is a real link to `/KEY-N` (Cmd/Ctrl-click
  opens a tab); a plain click, a double-click on the text, or **Enter** on the selected
  card (keyboard navigation on) goes to the page. Epic chips and child rows are links to
  `/KEY-N` too.
  *Clarified 2026-09-17 (David, answering KANBAN-44's question):* a **single click selects**
  a board card or list row; it does not open it. The pencil, a double-click on the text,
  or **Enter** on the selected card opens the page. Keep it exactly that way.
- **Getting back to the same board.** View, grouping, status/tag/area/creator filters and
  search live in the board URL (`?view=board&status=blocked&q=…`; defaults omitted; the
  area is written as its path, never an id), updated with `replaceState` so filter
  changes don't add history entries (`lib/board-state.ts`). Before opening a card the
  board remembers its scroll (the desktop list is its own scroll box, which the browser
  never restores) and the opened card in `sessionStorage`; on return it restores both and
  reselects that card (`components/boardReturn.ts`).
- **Esc and Back.** Esc while editing a field (description, tag input, any text field)
  **finishes that edit**: one save if something changed, and the field settles. Esc when
  nothing is being edited **saves anything still unsaved, then returns to the board**. A
  failed save stays on the page. Esc that a picker or confirmation handled itself does
  nothing more; with the restore prompt up, Esc is Discard (`cardEscAction`). "Return to
  the board" is history Back when the page was opened from that board in this tab (so Esc
  and the browser's Back land in the same place), else a navigation to `/KEY`. Following a
  link to another card finishes the edit first and **replaces** the history entry, so
  Back from the next card is still the board.
- **Editing is the save-on-finish model below, unchanged**, with the page as the editor:
  finishing is Esc in a field, a press outside the description and tags while editing
  them, or leaving (Esc, the back arrow, a card link, browser Back, closing the tab). A
  browser Back that unmounts the page mid-save sends the keepalive save, and the board
  waits for it before loading, so it never shows the old text. **Abandon** discards the
  unsaved changes with no write and reloads the editor with the stored card; you stay on
  the page. Each finished edit is one history entry (the page mints a new edit session
  after each save). If the card changes underneath with nothing unsaved (History
  Restore, GitHub Refresh), the editor reloads with the new values; with unsaved changes
  they are kept and the next save wins, as with two tabs.
- **Leaving finishes every open editor (KANBAN-38).** The description and each open entry
  editor register a finisher with the page (`components/cardFinish.ts`); Esc-to-board, the
  back arrow and card links await all of them and stay on the page if any save fails.

## Entry panels: Progress, and Decisions & Questions (KANBAN-38, 2026-09-17)

A card's running record lives in versioned entries (`item_entries`), not the description.
The card page shows them in two tabs beside the description
(`components/EntryPanels.tsx`; pure rules in `lib/entry-panels.ts`, tested).

- **Progress:** a timeline, **newest first**. Superseded notes sit in a collapsed
  **Superseded (N)** group and soft-deleted ones in a collapsed **Deleted (N)** group
  (native `<details>`: pointer, touch, Enter/Space). Empty groups are hidden.
- **Decisions & Questions:** **open questions** on top (accent border and tint, the heading
  reads "N open questions"), then **active decisions**, both newest first. Below, collapsed:
  **Answered questions**, **Superseded decisions**, **Deleted**. An answered question shows
  "Answered by decision: …" and a superseded decision "Superseded by: …".
- **What David can do, all from the web:** add a progress note, ask a question, record a
  decision (the "+" buttons at the top of each panel); on any entry **edit** (pencil),
  **delete** (trash; soft, restorable), **history** (clock); on a deleted entry **Restore**;
  on an open question **answer** (reply arrow: write a new decision that is recorded and
  linked, or **Link** one of the card's active decisions); on an active decision
  **supersede** (swap arrows: a new decision replaces it, the old one is kept as
  superseded). Every icon has `title` + `aria-label`.
- **Every entry editor is the card body's model exactly** (Save on finish, KANBAN-42 as
  revised), editing an existing entry and writing a new one alike (`DraftEditor`):
  nothing written while typing; **Esc**, **⌘/Ctrl+Enter**, a **press outside the
  editor**, the composer's **Add/Ask/Record/Supersede** button, or **leaving the page**
  writes once (a PATCH for an edit, a POST for a new entry), then the editor closes; the
  **abandon** icon discards with no write; a failed write keeps the editor open with the
  text ("Save failed (…) / Not added (…). Nothing lost. Esc to retry.").
  - **New entries (David, 2026-09-17):** Esc or click-off **posts** a composer, like any
    edit. An **empty or whitespace-only** composer posts nothing and just closes. (The
    first build made Esc keep the text instead; David reversed that.)
  - An existing entry can't be emptied: finishing blank says "Text is required. Abandon
    changes to keep the old text."
  - **One edit, one write.** Each open mints an `edit_session` (edits coalesce). While a
    write is in flight nothing else is sent: a second finish (Esc then click-off, tab
    close during a save) shares it. Tab close or reload finishes with a `keepalive`
    request; an unmount that wasn't preceded by a finish (browser Back) does too, but
    only for text **typed in this open** (so a restored draft isn't posted by a
    StrictMode remount). Every write is passed to `trackPendingSave`, so the board
    waits for it and its badge isn't stale.
  - **Switching editors, tabs or pages finishes first.** Opening another editor on an
    entry (e.g. Answer while an edit is saving) awaits the open editor's finish; if it
    fails, you stay in it and see why, and a late finish never closes the newer editor.
    Switching card-page tabs goes through the same `finishAll` as leaving.
- **Draft keys, one per editor** (several can be open on one page). All go through
  `draftKey(scope, id, field)` from `lib/abandon.ts`, with the scope/id from
  `entryDraftScope`: editing `mykan:draft:v1:entry:<entryId>:body`; composers
  `entry-new:<itemId>:<kind>`, `entry-answer:<questionId>`, `entry-supersede:<decisionId>`.
  The card's own description stays `item:<itemId>:<field>`, so nothing collides.
- **Leftover drafts resolve per entry.** Storage is read with `useSyncExternalStore`
  (nothing on the server render, so no hydration mismatch). A composer's leftover whose
  text already exists as the entry it would have created (a keepalive post that landed
  before the page could clear its draft) is forgotten silently (`composerDraftLanded`),
  so it is never posted twice. A row checks storage for its own editors (edit,
  and answer/supersede where they apply) and shows a small prompt **in that row**:
  "Unsaved edit to this entry from 3:42 PM" with **Discard** and **Restore** (plus the
  stale warning when the entry changed since). A composer's leftover shows under its "+"
  button. Restore opens that editor with the draft applied (`useAbandonable`'s
  `restoreOnOpen`); Discard forgets just that draft. With focus in a prompt, Esc =
  Discard and Enter activates the focused button. Several prompts can be up at once, so
  none of them steals Enter globally, and the description's own restore prompt ignores
  Enter inside the entry panels.
- **Plain textarea with a count.** Entries are stored as **plain text** capped at
  **2,000 characters** (`ENTRY_MAX_CHARS` in `lib/item-entries-rules.ts`, the one number MCP
  and the web routes both enforce; over it nothing is saved, never truncated). The footer
  shows `N / 2,000` (red past the cap) and the hint "Enter for newline · Esc, ⌘/Ctrl+Enter
  or click away to save/add" (the Enter exception above).
- **Rendered as markdown, safely.** Bodies are displayed with `react-markdown` +
  `remark-gfm` (`components/EntryMarkdown.tsx`): bold, italics, lists, inline and fenced
  code, links, bare-URL autolinks, strikethrough, task lists, tables. **No raw HTML**
  (`skipHtml`, no rehype-raw), unsafe URL protocols are blanked by react-markdown's default
  `urlTransform`, links open in a new tab with `rel="noopener noreferrer nofollow"`, images
  are not rendered (an image renders as nothing), and headings render as bold lines. Identifiers like
  `edit_session` stay literal (CommonMark's intraword-underscore rule), which is why the
  in-house `lib/markdown-tiptap.ts` (GitHub import only) was not reused. Styles: `.entry-md`
  on top of `.prose-mykan` in `globals.css`.
- **Per-entry history** (clock icon) opens inline under the entry and looks and behaves
  like the card's History: newest first, who, what changed ("text edited", "marked
  answered", "deleted", "restored"), a two-line preview of the earlier text, time, source;
  **Restore** → **Confirm restore** / Cancel, Esc cancels a pending confirm; the restore is
  itself a version (`GET/POST /api/items/[id]/entries/[entryId]/versions`).
- **Keyboard namespace.** The card page binds no navigation letters, and every entry key
  handler lives on the editor itself: typing `j k l h 0 G / u d o` in an entry only types.
  An editor's Esc is marked handled, so the card page doesn't also finish the description
  or leave.
- **Loading.** The first page always carries **every** live open question and active
  decision, however old (`isPinnedEntry`), plus the newest 100 of everything else
  (progress, superseded, answered, deleted) and any entry those link to (answered by /
  superseded by). A **Load older entries** button at the bottom of either panel fetches
  the next 100 (`?before=<cursor>`).
- **Web write path:** `app/api/items/[id]/entries` (GET paged as above, POST add),
  `…/[entryId]` (PATCH text with `edit_session`, DELETE soft), `…/restore`, `…/answer`,
  `…/supersede`, `…/versions`. Each checks the session, the entry's visibility through its
  item, and that the entry belongs to the item in the URL; writes are `source: 'web'`
  (version restores `recovery`). Answering with a `decision_id` from another item is the
  same "Entry not found" 404 as a missing id (web and MCP), so it reveals nothing.

## Open-questions badge on board cards and list rows (KANBAN-38)

- A card or row with open questions shows **"N open questions"** (accent-soft pill with a
  question-mark icon) next to the type/epic badges, so what is waiting on David is
  visible without opening the card. Hidden at 0. It is display only, not a button:
  **clicking works exactly as before** (single click selects; pencil, double-click or
  Enter opens).
- **One query, no N+1.** `GET /api/projects/[id]/items` runs one extra query in parallel
  with the items: open, non-deleted questions joined to the project's items
  (`items!inner`), counted per item by `countOpenQuestions`, and added to each row as
  `open_questions`. The board keeps the counts in their own state (`OpenQuestionsProvider`),
  because item PATCH responses replace rows without them. A failed count logs and shows no
  badges rather than failing the board. Counts refresh with the board (load, Refresh,
  returning from a card page).

## Tags

Tags are lightweight, inline, and keyboard-first — never a separate management screen.

- **Inline, minimal, on the row.** Put tagging right on the item row/card (like the existing
  tag chips), not buried in a modal. New item features should follow this same inline-minimal
  instinct rather than defaulting to the modal.
- **Add:** type then **Enter** or **comma**; **blur commits** the draft text as a tag;
  **Backspace** on an empty field removes the last tag; **✕** on a chip removes it.
- **Esc** clears/closes the inline add field without committing.
- **Typeahead, not a dump.** Suggestions appear only after you type, filter by case-insensitive
  substring, exclude tags already applied, and cap the list ("+N more — keep typing").
- **Normalization:** lowercase, trimmed, whitespace-collapsed, ≤32 chars, ≤20 tags/item, deduped
  (`normalizeTags` in `lib/types.ts`).
- **Stable per-tag color.** A tag's hue is hashed deterministically from its text
  (`tagHue`/`tagStyle`), never random — the same tag is always the same color. Lightness/chroma
  come from theme tokens (`--tag-l-*`) so chips read well in both themes; the active/selected
  state inverts (filled hue + light ink).
- **Filtering is AND.** Selecting multiple tags shows items carrying **every** selected tag.
  Clicking a chip toggles it as a filter; a "clear" affordance removes all.

## Item references

- Every item has an immutable, per-project **number** (stamped on insert by a DB trigger, never
  reused). Shown as a muted monospace badge — `{project.key}-{number}` (e.g. `AMOS-12`) when the
  project has a short **key**, else `#{number}`. The key is set inline in the project-edit panel
  (`ProjectHeader`); the badge appears on rows, cards, and the card page header (`RefBadge`,
  `itemRef` in `lib/format.ts`). Don't surface raw UUIDs to users.

## Categories (Areas)

A per-project **hierarchical** area tree (`categories`: `parent_id` self-reference, depth ≤ 5).
An item is filed at **one** node; items reference it **by id**, which is what makes the rest work.

- **Rename ripples; filter is by subtree.** Because items point at a node id, renaming a node
  updates every item instantly, and filtering by a node includes **that node and all
  descendants** (`subtreeIdSet`). Deleting reparents children up and un-files items.
- **Entry is a path, find-or-create.** Type `Coach / Program` and missing segments are created;
  existing ones are reused (case-insensitive). One node per item.
- **Manager is humble, not a canvas.** The **Areas** panel shows the indented tree with inline
  rename / add / delete — no drag-reparent. The add field stays open and **trims back to the
  last `/` immediately on Enter** so you can rattle off siblings without waiting for the insert.

## Epics (parent/child links)

`epic` is an item type (KANBAN-41). The link lives **once, on the child** (`items.parent_id`);
an epic's children are derived, so the child's parent link and the epic's children list
always agree. Rules (enforced by a DB trigger and mirrored in `parentLinkError` /
`typeChangeError`): one level only, same project only, the parent must be an epic, no
self-parent, and an epic can't change type while it has children. Deleting an epic un-links
its children.

- **Epics are ordinary cards** on the board and list, with the Epic type badge plus an
  "N/M done" count over their **non-archived** children.
- **Cards show links; the card page edits them** (the detail modal until KANBAN-44). A
  child's board card / list row shows an epic-coloured chip (ref + title), a link to the
  epic's page `/KEY-N`, and an epic shows "N/M done". The link *controls* live on the card
  page, deliberately not inline on every card: an inline
  "+ epic" put a control on every card of any project with an epic, and linking is an
  occasional, deliberate act, unlike tagging. (This is a considered exception to the
  inline-minimal instinct under Tags.)
- **Both sides, explicitly labelled.** A non-epic card's page has a **Parent epic** row:
  **Add parent** (opens the picker), or the chip with **Change parent** (pencil) and
  **Remove parent** (unlink) icon actions. An epic's page lists its children in its Child
  items section (ref, title,
  status; each opens the child) with a remove-from-epic icon per child and an **Add child**
  typeahead over cards that can join (non-epic, non-archived, not already its child); a card
  already in another epic is listed with "in KEY-N · moves here" and picking it moves it.
  The **Add Item** modal has the same **Add parent** picker, hidden and cleared when the type
  is Epic. Following a link goes to that card's page (`/KEY-N`), finishing the current
  edit first and replacing the history entry, so Back still returns to the board.
- **The pickers** follow the picker rules below: open on focus, ↑/↓, Enter picks, Esc closes
  just the picker, Tab moves on; the parent picker is seeded with the current parent's ref
  (selected, so typing replaces it) and offers only non-archived epics in the project.
- **Order: status, then number** (David, 2026-09-16). The epic's children list, the **Add
  child** picker, and both parent pickers (card page and Add Item) list cards by status in
  board column order — Not started, In Progress, Blocked, Testing, Done — and within a status
  by item number ascending. Board position is deliberately ignored here. Every picker row shows
  its status (the same small uppercase label as the children list) so the order is legible;
  per-row labels rather than group headers keep ↑/↓ a flat list. The rule lives in
  `lib/epic-order.ts` (`sortByStatusThenNumber`, tested), derived from `ITEM_STATUSES` so it
  follows the board.
- **Add child is multi-select** (David, 2026-09-16); the parent pickers stay single-select (a
  card has one parent). Each row has a checkbox: **click/tap** toggles it, and **Space**
  toggles the highlighted row while the filter is empty or straight after ↑/↓ (once you type,
  Space types, since titles have spaces). The typed filter stays while you select, and
  selections survive filter changes. The footer shows "N selected" and an **Add N** primary
  button. **Enter** (or Cmd/Ctrl+Enter) adds the selection; with nothing selected, Enter adds
  just the highlighted card, as before. **Esc** closes and drops the selection; **Tab** reaches
  Add N, and the picker closes once focus leaves it.
- **Multi-add is one PATCH per card, one at a time** (never in parallel, so each card meets
  the DB guards exactly as a single link would, and each card's history records its own
  link). The footer shows "Adding 2 of 5…". If every link succeeds the picker closes. If some
  are refused, the list is re-fetched so it shows the real state, the failed cards **stay
  selected**, and the footer lists each failed ref with the server's reason; the picker stays
  open to retry or Esc.
- **History:** every link change goes through the history chokepoint, including deleting an
  epic — each child (archived too) is un-linked first and its history reads
  "parent KEY-N removed (epic deleted)".
- **Archived:** an archived child keeps its link but drops out of the list and count; an
  archived epic keeps its children's links (the chip says "archived") but can't be picked as
  a new parent.

## Pickers (areas, tag filter, assignees, parent epic)

The cross-project picker rules (`~/.claude/CLAUDE.md`) apply, with these app specifics:

- **Drop down on focus; keyboard-first.** The tag filter and area pickers open their list on
  focus, highlight the first row, move with **↑/↓**, select/apply with **Enter**, close on
  **Esc**; the overlay floats (never pushes content) and **scrolls** (no hard item cap).
- **Slash-insensitive matching.** Area paths display as `coach / program` but match what you
  type (`coach/`, `coach /`) — both sides are normalised by collapsing spacing around `/`
  (`normPath`). Editing an item's area **seeds the field with its current path** (despaced).
- **Pick existing = instant.** Choosing an existing suggestion assigns by id optimistically (no
  create round-trip); only a genuinely new typed path shows a brief `saving…` spinner.
- **Assignees** appear only on **shared** projects, drawn from the whitelist members.

## Theming (light/dark) & icons

- **Class-based dark mode.** The `dark` class on `<html>` drives the theme. An inline script in
  `layout.tsx` sets it **before paint** from `localStorage.theme`, falling back to OS
  `prefers-color-scheme` (wrapped in try/catch for private mode). `ThemeToggle` flips the class
  and persists the choice. Storage key: `theme` (`"dark"`/`"light"`).
- **Tokens, never hardcoded colors.** All color comes from CSS variables defined in
  `globals.css` for both `:root` and `html.dark`. Use these — don't introduce raw hex/oklch in
  components. Main tokens: `--color-canvas`, `--color-surface`, `--color-ink`, `--color-muted`,
  `--color-faint`, `--color-line`, `--color-line-strong`, `--color-accent`,
  `--color-accent-soft`, `--color-accent-ink`; per-type `--color-{feature|bug|idea}[-bg|-line]`;
  tag lightness `--tag-l-{bg|fg|bd}`. Add a token in both themes rather than branching in JSX.
- **Smooth theme transition** (`background-color`/`color` ~0.3s) is set on `<html>` — keep it.
- **Icons are inline SVGs**, `viewBox="0 0 24 24"`, sized `h-[18px] w-[18px]` (or `h-4 w-4`),
  stroke `1.6–1.8` with `currentColor` (or filled `currentColor`). No icon fonts or image
  files. Color via Tailwind text classes bound to tokens.
- **Every icon is labeled.** Decorative SVGs get `aria-hidden="true"`; the icon **button** gets
  both `title` (hover tooltip) and `aria-label` (accessible name). Row/control actions are
  icons, not text labels.
- **Prompt tooltips where the icon isn't self-evident** (David, 2026-09-17: the native `title`
  tooltip is far too slow, and the entry panels' Answer ↶ icon read as Undo). The entry-panel icon
  buttons and the abandon icon drop `title` and show a styled tooltip ~150ms after hover and at
  once on keyboard focus (`IconTip` in `components/EntryPanels.tsx`, the same styling in
  `components/AbandonButton.tsx`). They keep `aria-label`. Don't show both a native and a styled
  tooltip on one button.
- **`IconTip` is shared** (`components/IconTip.tsx`, KANBAN-12): wrap the button in a `relative`
  span, give the button `peer`, put `<IconTip label="…" />` after it. The tooltip text is short
  ("Delete", "Open card"); the `aria-label` can be longer and name the item. Also used by the
  row/card pencil (`EditButton`), attachments clip (`InlineAttachments`, hidden while its
  popover is open), history clock (`ItemHistory`) and the list row's delete icon.

## In-app help: the "?" dialog (KANBAN-28, 2026-09-17)

Setup that is easy to get wrong gets a **"?" icon where the configuring happens**, not a
separate doc. First use: GitHub setup (`GithubHelpButton`, `components/GithubHelp.tsx`).

- **Where:** beside the "GitHub connections" heading in the Connect popover (`GithubConnect`),
  beside the **GitHub account** field in the project edit panel (`ProjectHeader`), and in
  the **Areas** panel header next to ✕ (`CategoryManager`; one per panel, not per row).
- **One content source.** The words live as typed data in `lib/github-help.ts` (sections of
  steps and bullets, the permissions table, the pre-filled GitHub token URL), tested in
  `lib/github-help.test.ts`. Every "?" renders the same content, and there is no parallel
  `docs/` how-to to drift from it. Keep it matched to the code (`lib/github*.ts`) and to
  GitHub's current docs.
- **The trigger** is a 24px icon button (circle with a question mark): `aria-label`, the prompt
  styled tooltip (~150ms after hover, at once on keyboard focus: the shared `IconTip`), no
  native `title`. Click, tap, Enter or Space opens.
- **The dialog** is modal (`role="dialog"`, `aria-modal`), centred, `max-w-lg`, capped at
  `88svh` with its body scrolling, token colours only, fine at phone width. Focus starts on
  its ✕, Tab stays inside, and every close (Esc, ✕, a press on the backdrop) returns focus to
  the "?". External links open in a new tab with `rel="noopener noreferrer"`.
- **It closes itself only, never the surface it sits in.** Those surfaces own Esc and
  click-off (the popover, the project panel, the Areas modal, the card page), so the dialog
  takes Esc in the window's **capture** phase and stops it, and is portaled into its **own
  container** on `<body>` whose native listeners stop pointer, mouse, touch, click and key
  events from bubbling on. A React `stopPropagation` alone is not enough: the App Router's
  React root is `document`, the same node those click-off listeners are on. React events
  are also stopped at the backdrop, since they bubble to the portal's React parents (the
  Areas backdrop closes on mousedown). Reuse this component's approach for any future help
  dialog that opens from inside another overlay.
