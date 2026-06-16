# Project privacy (admin-only private projects)

**Date:** 2026-06-15
**Status:** Approved (design)

## Problem

mykan is currently a fully shared pool: every whitelisted user (David, Matthew)
sees every project and item. David needs to keep some of his projects private
(e.g. Asset Relay) while others stay shared (e.g. Amos Build). Matthew should be
unaware the feature even exists.

## Goals

- David can mark a project he created as **Private** (visible only to him) or
  **Public** (visible to all whitelisted users). Public is the default.
- Matthew (any non-owner user) sees only public projects and their items. He
  never sees private projects, never sees the Private/Public control, and never
  sees a "Private" badge. Everything he creates is public.
- Enforcement is real (server-side), not cosmetic.

## Non-goals

- No per-user sharing / ACL table. With two users a single boolean suffices
  (YAGNI). A future multi-user model can replace the boolean without data loss.
- No per-item privacy. Items inherit their project's visibility.

## Roles

- **Owner / admin:** a single configured email, `ownerEmail()`, defaulting to
  `dawoodward@gmail.com`, overridable via the `OWNER_EMAIL` env var. Mirrors the
  existing whitelist pattern in `lib/auth.ts`. Only the owner sees the
  Private/Public toggle in the UI.
- **Everyone else:** regular viewer. Sees only public projects.

## Data model

Add one column to `projects`:

```sql
alter table projects add column if not exists is_private boolean not null default false;
create index if not exists projects_is_private_idx on projects (is_private);
```

Public is the default, so all existing projects remain shared. David flips Asset
Relay to private with one click after deploy — no data migration needed. Items
are unchanged; they inherit visibility from their parent project.

## Access-control rules (server-side, the security surface)

The access rule is **general and does not hardcode the owner**: a private
project is visible only to its creator (`created_by`). Because only the owner
can create private projects (only they get the toggle), private rows always
belong to the owner — but the enforcement code compares `created_by` to the
requester, which is safe regardless.

- `GET /api/projects`: return rows where `is_private = false OR created_by =
  <requester email>`. (Owner sees all; others see only public.)
- `GET / PATCH / DELETE /api/projects/[id]`: if `is_private` and `created_by !=
  requester`, respond **404** (not 403 — don't reveal existence).
- `GET / POST /api/projects/[id]/items`: same project visibility check before
  listing or creating items.
- Item-level routes — `GET/PATCH/DELETE /api/items/[id]`,
  `/api/items/[id]/attachments` (+ `/sign`, `/[attId]`), `/api/items/[id]/images`:
  currently perform **no** project check. Add a shared guard
  `assertItemAccess(itemId, email)` that loads the item's parent project and
  returns a 404 NextResponse when a non-creator hits a private project's item.
  This closes the direct-by-ID access hole.
- Setting `is_private` via `PATCH /api/projects/[id]` is allowed **only** when
  the requester is the owner (`ownerEmail()`) and is the project's creator.

## UI

- `app/page.tsx` (server component, already has the session) passes
  `isOwner={session.user.email === ownerEmail()}` into `ProjectsView`.
- `ProjectsView` (client): for each project card, show a small **Private/Public**
  toggle **only** when `isOwner && project.created_by === <viewer email>`
  (i.e. the owner's own projects). The viewer email is also passed from the
  server component. Private cards show a subtle "Private" badge next to the name.
- The toggle calls `PATCH /api/projects/[id]` with `{ isPrivate: boolean }`,
  optimistic update with rollback on failure (matching the existing item-tag and
  item-patch optimistic patterns in `ProjectDetailView`).
- Matthew's UI is unchanged: no toggle, no badge, no private projects in the list.

## Type changes

- `lib/types.ts`: add `is_private: boolean` to the `Project` interface.

## Testing / verification

- `tsc --noEmit` clean.
- Manual / browser verification on `localhost:3005`:
  - As owner: toggle a self-created project to Private → badge appears; it stays
    in the owner's list.
  - Simulate non-owner (via `OWNER_EMAIL` swap or a second account): private
    project absent from `GET /api/projects`; direct `GET /api/projects/[id]`,
    `/items`, and `/api/items/[id]` for that project return 404.
- Confirm no regression for public projects (default path unchanged).

## Rollout

1. Run the `is_private` migration in Supabase (idempotent; add to `schema.sql`).
2. Deploy. All projects start public.
3. David flips Asset Relay → Private in the UI.
