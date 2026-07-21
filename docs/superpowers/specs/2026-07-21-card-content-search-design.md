# Card content search on List & Board — design

**Date:** 2026-07-21
**Status:** Approved (David), implementing

## Problem

The List and Board views already filter by Area, Tags, Type, Status, and Creator, but
there is no way to search a card by its **content**. On a busy project you often know a
word from the card's body (or its ref number) and want to jump straight to it.

## Scope

Add a free-text search that filters cards by their **content only** — the body text and
the reference number. Area / tags / type deliberately stay out of the haystack because
they each have a dedicated filter. Search composes as **AND** with all existing filters.

Explicitly out of scope: MCP parity (declined by David for this feature), result
highlighting, URL/localStorage persistence, and searching archived items outside the
current pool.

## Design

Everything lives in `components/ProjectDetailView.tsx`, which owns all filter state and
the single `visibleItems` useMemo that both List and Board consume — so one predicate
covers both views.

### Match semantics (case-insensitive substring)

A per-item lowercased haystack is precomputed as `richDocText(body) + " " + itemRef(key, number)`:

- `align` → any card whose body contains "align"
- `12` → ref #12 (bare number, no prefix) **and** any body containing "12" — because the
  ref string (`amos-12` / `#12`) is in the haystack and contains the digits
- `AMOS-12` → that card's ref

The haystack is memoized in a `Map<id, string>` keyed on the item pool + project key, so
each keystroke is only a `.includes()` — no re-flattening of bodies per keystroke.

### UI

A compact magnifier + single-line `<input>` leads the toolbar's Filter cluster
(placeholder "Search cards…"), with a ✕ clear button when non-empty. Tokens only; icon
button carries `title` + `aria-label`. Live-filters as you type (no debounce needed for an
in-memory `.includes`). State is transient: shared across the List/Board toggle, resets on
reload.

### Keyboard

- `/` (currently unbound) focuses the search input from anywhere on the page, independent
  of the vim-nav toggle, and yields when focus is already in an input/textarea/editor so a
  literal "/" still types.
- `Esc` inside the box clears the query and blurs (matches the inline-field Esc convention).

### Empty state

When a query is active and nothing matches, show a quiet "No cards match your search."
line instead of empty columns/sections.

## Verification

- `tsc --noEmit` + `eslint` clean.
- Visual check in the running app (debug Chrome): input renders in the Filter cluster in
  both themes; typing a body word filters both List and Board; `12` matches the ref;
  `/` focuses; `Esc` and ✕ clear; empty-state note shows for a no-match query.
