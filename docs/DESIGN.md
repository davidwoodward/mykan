# mykan — design & UX conventions

These are the interaction patterns that define how mykan feels. They are **deliberate
choices for this app** — not universal defaults. When building or changing UI here, match
these unless explicitly told otherwise. (Project-specific; the cross-project defaults live
in `~/.claude/CLAUDE.md` → "UI behavior standards". Where the two conflict, **this file wins
for mykan** — see Autosave below.)

Verify any UI change by looking at the running app (screenshot), not just passing tests.

## Project page scroll model

Three layers, and getting this exactly right matters:

- **The whole page scrolls normally.** Never lock the viewport (`overflow-hidden` /
  forced `h-screen`) — a tall add form must be able to scroll so its **Add button stays
  reachable**. (This bit us once.)
- **The header (top nav) is pinned** — `sticky top-0` — so it stays put over everything.
- **The List/Board is its own scroll region** (≥lg only): a container capped to roughly the
  viewport (`lg:max-h-[calc(100svh-…)] lg:overflow-y-auto lg:overscroll-contain`). Scrolling
  *inside* it scrolls only the items, leaving the **add form + List/Board picker line (and
  everything above) static**. Scrolling *outside* it scrolls the whole page. **Below `lg`
  (1024px) the page is plain full-page scroll with only the top bar pinned** — the gate is
  `lg`, not `sm`, so a phone in *landscape* (~960px wide) scrolls the same as in portrait
  rather than trapping the list in a short contained region.

## Small-screen item rows (list view)

Below `sm` (640px) the list row stacks vertically — **status line → content → Areas/tags →
byline → controls** — so the description reads directly under the status. At `sm+` it returns
to the single fixed-column row (status · ref · content · controls). The transform is done with
`flex-col sm:flex-row` on the `<li>` plus `sm:contents` wrappers around the lead columns and
trailing controls, so the desktop row is byte-for-byte unchanged. (The hover-only Delete is
made tap-visible below `sm`, since touch has no hover.)

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

## Autosave & dismiss (item editing)

Editing in mykan is **implicit and forgiving** — you never hunt for a Save button, and
leaving the editor always keeps your work. This is core to the app's feel; preserve it.

- **Debounced autosave, no Save button.** The rich-text body saves automatically ~700ms
  after you stop typing (`RichTextEditor.tsx`). Each keystroke reschedules the timer.
- **Flush on close.** Any pending save is flushed immediately on unmount/close, so dismissing
  never loses the last edit.
- **Esc and click-off both commit + dismiss.** The item modal closes on **Esc**, on
  **backdrop click** (click outside the panel), or via the **✕** button — and because save is
  autosave-on-pause + flush-on-close, all three routes save. Esc here means "I'm done," not
  "discard."
- **Live save status.** Show "Saving… / Saved / Save failed" so the implicit save is visible
  (`ItemDetailModal.tsx` SaveIndicator). Don't remove this — it's what makes no-Save-button
  trustworthy.

**Enter exception (overrides the global "Enter = primary action" rule).** Item text is
multi-line: in the item-name input (`AutoGrowTextarea`) and the body editor, **Enter inserts
a newline**; **⌘/Ctrl+Enter** is the primary action (add/submit). Always show the hint
("Enter for newline · ⌘/Ctrl+Enter to add"). Esc still abandons an in-progress add.

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
  (`ProjectHeader`); the badge appears on rows, cards, and the item modal (`RefBadge`,
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

## Pickers (areas, tag filter, assignees)

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
