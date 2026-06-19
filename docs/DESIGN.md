# mykan — design & UX conventions

These are the interaction patterns that define how mykan feels. They are **deliberate
choices for this app** — not universal defaults. When building or changing UI here, match
these unless explicitly told otherwise. (Project-specific; the cross-project defaults live
in `~/.claude/CLAUDE.md` → "UI behavior standards". Where the two conflict, **this file wins
for mykan** — see Autosave below.)

Verify any UI change by looking at the running app (screenshot), not just passing tests.

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
