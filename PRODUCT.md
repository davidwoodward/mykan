# Mykan — Product

A personal project + item tracker. Two-user app (David + Matthew). Lightweight projects hold items (features, bugs, ideas), viewable as either a list or a kanban board.

## Register

`product` — design serves the work; the tool should disappear into the task.

## Users

- **David Woodward** (dawoodward@gmail.com) — primary user. Engineer/builder, captures ideas mid-flow, expects fast keyboard-friendly entry.
- **Matthew L.** (matthewL@experiencealign.com) — second user. Collaborator.

Both technical, both on macOS desktop. Authentication is gated to these two emails only; every other Google account is rejected at sign-in.

## Product Purpose

Capture and track work-in-progress across small personal projects.

- A **project** is a name + description.
- An **item** is a name, a **type** (feature / bug / idea), and a **status** (new / in progress / done).
- The **list view** groups items by status for fast scanning.
- The **kanban view** is per-project, three columns (New / In Progress / Done), drag-and-drop to change status.

Anti-goal: anything that feels like Jira. No sprints, estimates, comment threads, audit trails, notifications, or roles. Stay tight.

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
3. **Two users, zero ceremony.** Whitelisted Google sign-in via Auth.js v5; no roles or audit trail. The one visibility control: the owner can mark a project **private** (only they see it); everything else is shared. No other permissions.
4. **Light-first, dark-optional.** Light is the default — sunlit weekday capture, not a 2am ops dashboard — with a moon/sun toggle for those who want dark.

## Stack

Next.js 16 (App Router) + TypeScript + Tailwind v4 + Auth.js v5 (Google) + Supabase Postgres (service-role access, RLS off — auth is enforced in the app layer, not the database). Drag-and-drop via `@dnd-kit`; rich-text item bodies via Tiptap; light/dark theme. An MCP server at `/api/mcp` (bearer-gated) lets Claude Code work items. Deployed on Vercel.
