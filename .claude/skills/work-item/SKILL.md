---
name: work-item
description: Work a mykan item end to end — move it to In Progress, do the build/debug from its description, then move it to Done. Use when asked to "work", "pick up", "do", or "knock out" a mykan item/task, or to grab the next item in a project.
---

# Work a mykan item

Drives a mykan item through the board while you do the actual work. Requires the
`mykan` MCP (tools `mcp__mykan__*`); if they're absent, tell the user to run the
setup in `docs/mcp-setup.md`.

## Steps

1. **Identify the item.** If given a project + item, resolve it. Otherwise call
   `list_projects`, then `list_items` (optionally `status: new`) and ask the user
   which item — or take the one they named.
2. **Read it.** Call `get_item`; treat `body_text` as the task spec.
3. **Start.** Call `update_item_status` with `status: in_progress` so the card
   moves on the board.
4. **Do the work.** Build/debug/implement per the item. Follow the repo's own
   skills and conventions for the actual code.
5. **Record.** Call `append_item_note` with a one-line summary of what changed
   (include a PR link if there is one).
6. **Finish.** Call `update_item_status` with `status: done`. If the work is
   ambiguous or only partially complete, stop and confirm with the user before
   marking done — leave it `in_progress` otherwise.

Keep status honest: only `done` when the work is actually finished and verified.
