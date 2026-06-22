# mykan — item references, categories, status & assignees

**Date:** 2026-06-22
**Status:** Design approved, pending plan

## Context

Matthew built a spreadsheet to track the Amos product build — a grid of screens
with columns for a row number, a "Zone / Page" location, a description, an
"in prototype?" flag, an owner, and a status. David wants that information to
live in mykan instead of the spreadsheet, modelled with proper kanban/scrum/dev
concepts, and **generic enough to reuse on any project** (not Amos-specific
naming).

This spec covers the data-model and UI changes needed, and the order they ship.

## Goals

- Give items a **stable, human-facing reference** (`AMOS-12`).
- Replace the spreadsheet's "Zone / Page" with a proper **hierarchical Category
  (Area)** that supports **rename-that-ripples** and **filter-by-subtree**.
- Add a **Blocked** status and align status labels with how the team talks.
- Let items have **assignees** (multiple), drawn from a shared project's members.
- Keep everything **project-specific** and **generically named**.

## Non-goals (deliberately deferred)

- A drag-to-reparent / reorderable / collapsible **tree-management canvas**.
  Phase 1 of Categories uses a humble inline-editable list instead.
- A real per-project **membership** system. Access today is the global whitelist
  (David + Matthew); assignee options are those members for now.
- An "in prototype" field — this is just a normal **tag**, no build.
- Using the project's **display name** as the reference prefix — rejected;
  renames would churn it. The short `key` is its own field. (The `KEY-` prefix
  itself *is* in scope — see Decisions.)

## Decisions

| Piece | Decision |
|---|---|
| **Reference** | `AMOS-12` = a per-project short **key** (`AMOS`) + an **immutable per-project counter**. Key defaults from the project name, editable (short, uppercase), lives in the project-edit panel. The number is stamped at creation and **never changes or is reused** (deleting an item never renumbers). |
| **Category / Area** | A per-project **tree** of category nodes, **max depth 5**. An item is filed at **one node, at any level**. Items reference a node **by id** (not by storing its name), so **renames ripple** automatically. **Filtering by a node returns that node and all descendants** (subtree roll-up). |
| **"Page"** | Not a separate field — it folds into the Area path as a deeper level. |
| **"What it is"** | The existing rich-text **body**. No change. |
| **Status** | Add **Blocked**. Relabel the existing `new` status to **"Not started"** (label only; internal value stays `new`). Order: Not started → In Progress → Blocked → Done. |
| **Assignees** | **Multiple**, chosen from the project's members (the whitelist for now). The assignee control appears **only on shared projects** (a private project is just you). |
| **In prototype** | A normal tag. No build. |

## Data-model changes

These are the intended shapes; exact migration mechanics belong to the plan
(mykan applies DDL via the Supabase Management API).

- **Project key:** `projects.key text` — short, uppercase, per project.
- **Item reference number:** `items.number int` — immutable, per-project
  monotonic, assigned server-side at creation. Displayed as `{project.key}-{number}`.
- **Status:** add `blocked` to the `item_status` enum. Label map: `new` →
  "Not started", `blocked` → "Blocked".
- **Categories:** new table `categories (id, project_id, parent_id nullable,
  name, position)`. Self-referential `parent_id` gives the tree; depth capped at
  5 (enforced app-side). `items.category_id uuid nullable` references a node.
- **Assignees:** `items.assignees text[]` — member emails; values constrained to
  whitelist members; surfaced only when the project is shared.

## Category interactions (the substantial piece)

- **Entry:** type/pick a path like a tag — e.g. `Coach / Program` — with
  **typeahead from paths already used in the project**; missing nodes are
  **find-or-created** implicitly. Reuses mykan's existing inline, keyboard-first
  tag UX. An item carries **one** category.
- **Display:** the node renders as a **breadcrumb** chip on the item
  (`Coach › Program`).
- **Rename (ripple):** a humble **inline-editable list** of the project's
  categories — edit a name, every item pointing at it updates. (No tree canvas
  in Phase 1.)
- **Filter:** selecting a node shows items filed at that node **or any
  descendant**.
- **Delete:** guarded — block while in use, or reassign to "Uncategorised".
  (Exact rule decided in the Categories plan.)

## The view

The reference number, status pill, and assignee chips are **decorations on the
existing List and Board** — no new view is required for them. **Only Categories
forces a view decision**, because subtree-filtering and grouping need a home.
That decision (enrich the existing List/Board vs add a new grouped/filterable
lens) is **owned by the Phase 3 plan**, constrained to: must support
**filter-by-subtree** and **grouping by Area**. It is intentionally not resolved
here so Phases 1–2 can ship first.

## Phasing & checkpoints

Each phase is independently shippable (its own PR → deploy), matching mykan's
ship-each-change flow.

- **Phase 1 — Reference (`AMOS-12`).** Project `key` field (in the project-edit
  panel) + the immutable per-project item number + show it on items.
  **→ Deploy, then STOP.** David sets short keys on his projects. He says "go"
  before Phase 2 starts. *(This is the hard checkpoint David requested.)*
- **Phase 2 — Quick decorations.** Add **Blocked** status + relabel
  New → "Not started"; add **Assignees**. Both land on the existing List/Board.
- **Phase 3 — Categories / Area.** The tree (records + `items.category_id`),
  path-autocomplete entry, breadcrumb display, inline-rename list (the ripple),
  and subtree filtering — including the view decision noted above.

David's stated constraint: after Phase 1's build, **deploy and stop** so he can
set the keys, then he will tell us to continue.
