# Mykan — Product

A personal project + item tracker. Small whitelisted team. Lightweight projects hold items (features, bugs, tasks, ideas), viewable as either a list or a kanban board.

## Register

`product` — design serves the work; the tool should disappear into the task.

## Users

- **David Woodward** (dawoodward@gmail.com) — primary user. Engineer/builder, captures ideas mid-flow, expects fast keyboard-friendly entry.
- **Matthew L.** (matthewL@experiencealign.com) — collaborator. Originates much of the feature list as SME, and verifies work. Not a builder — the board's machinery (columns, hierarchy, ordering) is overhead to him, not affordance.
- **Dustin** (dwoody55@gmail.com, shown as "Woody") — collaborator.

Authentication is gated to the whitelist in `lib/auth.ts` (overridable via `AUTH_ALLOWED_EMAILS`); every other Google account is rejected at sign-in.

**Users differ in altitude, not privilege.** David works the whole board; Matthew works at the level of *what we want* and *what's waiting on me*. Design for that difference with **defaults and views**, never with permissions — see "Preference, not permission" below.

## Product Purpose

Capture and track work-in-progress across small personal projects.

- A **project** is a name + description.
- An **item** is a rich-text **body** (no separate title — the first line reads as one), a **type** (feature / bug / task / idea), and a **status** (not started / in progress / blocked / testing / done).
- The **list view** groups items by status, by area, or flat.
- The **kanban view** is per-project, five columns, drag-and-drop to change status.

### The anti-goal, and where it now stands

> *Original (2026-05-19): "Anything that feels like Jira. No sprints, estimates, comment
> threads, audit trails, notifications, or roles. Stay tight."*

**That constraint was written for the initial build, and it did its job.** It is kept here
because the *instinct* behind it is still binding: ceremony is the enemy, and nothing gets
added because a competitor has it.

But mykan is now in daily heavy use across a dozen projects, and the literal list has been
overtaken (2026-07-18, KANBAN-32). What holds and what doesn't:

| Original prohibition | Now |
|---|---|
| Sprints, estimates | **Still out.** No appetite. |
| Notifications | **Still out.** |
| Audit trails | **Softened** — item history (KANBAN-10) exists for *recovery and rollback*, not for surveillance. It answers "get my words back", not "who did what when". |
| Comment threads | **Superseded** — tester feedback is a real need a single body field can't hold. Scoped as verification feedback, not general chatter. |
| Roles | **Superseded in letter, upheld in spirit** — a `tester` field and a landing-view preference are coming. Neither is a permission. See below. |

The replacement rule, which is stricter and more useful than a list of banned nouns:

> **Add nothing that makes a user ask "am I allowed to?" or "what am I supposed to do
> here?" Every addition must reduce what someone has to understand, not increase it.**

`docs/competitive-analysis.md` names sub-items, item relations, and comments as
table-stakes gaps. That is a map, not a mandate — the gaps get closed only where they pass
the rule above.

## Tone

Quiet, useful, unbranded. The chrome disappears; the items are visible.

## Anchor references (positive)

- **Linear** — restraint, density, keyboard-first.
- **Things 3** — capture-first calm.
- **Height** — kanban affordances done well.

## Anti-references

- Jira / Azure DevOps (ceremony-laden).
- Trello (over-playful, over-large cards).
- Asana (CRM sprawl).

## Strategic principles

1. **Capture is fast.** Adding an item is one keypress on the page. The name field is a textarea that starts at one line and grows; Enter is a newline; Cmd/Ctrl+Enter (or the explicit Save button) commits.
2. **Two views, one model.** List and kanban are different presentations of the same items.
3. **Small team, zero ceremony.** Whitelisted Google sign-in via Auth.js v5. The one visibility control: the owner can mark a project **private** (only they see it); everything else is shared. No other permissions.
5. **Preference, not permission.** Where users need different experiences, express it as a **default view** they can change — never as an access level. A per-user "Start me on" setting picks a landing filter; the filter is *visible and clearable*, and everyone can still see and do everything. Naming the **view** (`My Queue`, `Features`, `Everything`) rather than the **user** avoids creating a caste — nobody is labelled "a Tester", and nobody has to wonder what they're locked out of. A hidden filter is a bug report waiting to happen; a visible one is a lens.
6. **One order, several lenses.** A single per-project `position` float is the one order; List and Board are groupings of it (by status, area, feature, or flat). New grouping is a lens, not a second ordering system.
4. **Light-first, dark-optional.** Light is the default — sunlit weekday capture, not a 2am ops dashboard — with a moon/sun toggle for those who want dark.

## Stack

Next.js 16 (App Router) + TypeScript + Tailwind v4 + Auth.js v5 (Google) + Supabase Postgres (service-role access, RLS off — auth is enforced in the app layer, not the database). Drag-and-drop via `@dnd-kit`; rich-text item bodies via Tiptap; light/dark theme. An MCP server at `/api/mcp` (bearer-gated) lets Claude Code work items. Deployed on Vercel.
