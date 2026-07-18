# Chief-of-Staff ↔ mykan MCP — a dependable task flow

**Status:** design proposal (not yet implemented). Captures the orchestration + automation
improvements needed so that work tracked in mykan moves through its lifecycle **reliably**, and
so a request can be triggered the way David already phrases it.

---

## 1. The problem this fixes

mykan tasks now have five columns: `new` → `in_progress` → `blocked` → `testing` → `done`
(this doc was written when there were three; the lifecycle argument below is unchanged, and
`testing` is a gate that passes to `done` or bounces back to `in_progress`). In practice agents have been
**skipping `in_progress`** — a task jumps straight from `new` to `done` when the work ships.

Why that matters: **In Progress is David's only live window into what's being worked on right now.**
On 2026-06-20, an autonomous pipeline did a whole "bundle emails" feature and merged it without ever
marking its card `in_progress` — so David had no way to see the work was happening until it was
already done. (Same session also left a mess of stale local git branches.) The fix isn't "remember
harder"; it's to make the lifecycle a **structural property of how work is dispatched**, not a thing
any worker has to remember.

Two distinct concerns, which need different mechanisms:

- **The *when*** — something must fire the `in_progress` transition at the moment work starts, and
  the `done` transition (with a note) at the moment it ships.
- **The *how*** — find/create the right card across several mykan projects, flip status, append
  well-formed notes. This is a reusable procedure.

---

## 2. The dependable lifecycle (canonical flow)

Every tracked piece of work follows these steps, in order:

| # | Step | mykan MCP call(s) | Rule |
|---|------|-------------------|------|
| 1 | **Resolve** the card from the request | `list_projects`, `list_items`, `get_item` | Identify the project, then fuzzy-match the request to one card. If ambiguous → ask. If none → offer to create (step 1b). |
| 1b | **Create** if no card exists | `create_item` | Only with a clear title; confirm with the user unless told to just-do-it. |
| 2 | **Transition to In Progress — BEFORE any work** | `update_item_status(in_progress)` | This is step *one of execution*, not an afterthought. Echo back: "Working **<title>** (`<id>`) → In Progress." |
| 3 | **Execute** the work | — | May delegate to specialists. The card stays `in_progress` the whole time. |
| 4 | **Progress notes** at meaningful checkpoints | `append_item_note` | e.g. "PR #61 opened", "merged + deploying", "deployed, verifying live". |
| 5 | **Complete — only after shipped + verified** | `update_item_status(done)` + `append_item_note` | Closing note must capture: PR number(s), deploy event, and verification evidence. |
| 6 | **Reconcile** if the flow was entered late | `update_item_status(in_progress)` | If you start work whose card isn't `in_progress`, fix that first, then continue. |

**Non-negotiable invariant:** a card must never go `new → done`. If it's `done`, it was `in_progress`
first, even if only briefly.

---

## 3. How a request is triggered

The goal is that **David keeps phrasing requests the way he already does** — the dependability comes
from the agent's resolution step, not from David adopting a new syntax.

### Mode A — Reference (the current, default mode)

David writes something like:

> **"implement the task - Disposals should be a Bundle type"**

The agent treats the text after "the task" as a **gist to resolve against mykan**:

1. Pick the project (by repo/context — e.g. cwd `…/asset-relay` → mykan project **"Asset Relay"**).
2. `list_items` and fuzzy-match the gist to a card title/body. ("Disposals should be a Bundle type"
   → the card *"Disposals are handled by Ed Tech … Disposals should be a Bundle type."*)
3. **One match** → state it and move it to `in_progress`. **Several plausible** → ask which.
   **None** → offer to create one.
4. Proceed through the lifecycle (§2).

This is exactly the flow David has been using informally — the doc makes the *resolve → In Progress*
half mandatory and explicit so it can't be skipped.

### Mode B — Explicit reference

David names the card directly (id, exact title, or "the disposals card"). Skip fuzzy-matching;
`get_item` to confirm, then §2 from step 2.

### Mode C — Ad-hoc (no card yet)

David describes work that isn't tracked. The agent **offers to create the card** (`create_item`),
then runs the full lifecycle. Nothing tracked-worthy should ship without a card.

> Optional convenience, not required: a short prefix like `track:` could force Mode A explicitly —
> but the point of this design is that **plain phrasing already triggers it**, so a prefix is sugar,
> not a dependency.

---

## 4. Architecture — who owns what

Layered so the *when* is structural and the *how* is reusable. No single layer is sufficient alone.

```
 request ──▶ Chief-of-Staff (intake)         ← owns the WHEN
                │  "is this a mykan task? → resolve + move to in_progress"
                ├──▶ task-tracker specialist / mykan skill   ← owns the HOW (the MCP calls)
                └──▶ division lead / specialist  ← does the actual work
              (on completion: → done + closing note)

 fallback net: global ~/.claude/CLAUDE.md rule  ← covers DIRECT, un-orchestrated work
```

- **Chief-of-Staff intake routine (the *when*).** The chief-of-staff is the single chokepoint that
  triages and routes every request. Make "resolve the card and move it to `in_progress`" **step 1 of
  its standard intake**, and "move to `done` + closing note" **step N of completion**. Then the
  lifecycle happens because it's the routine — not because anyone chose to. This is the strongest
  guarantee, but it only covers work that *flows through* the chief-of-staff.
- **Task-tracker specialist / `mykan` skill (the *how*).** A focused unit that owns the procedure:
  project discovery, find-or-create, status transitions, note + closing-note conventions, ambiguity
  handling. The chief-of-staff (or any agent) delegates the MCP mechanics to it. A *skill* if it's
  mostly procedure; a *subagent* if you want isolated context + a tool-restricted surface (just the
  mykan MCP). **Do not** build a subagent whose only job is flipping one card — that's over-engineered;
  it earns its keep only by owning the richer surface (resolve, dedup, "what's in progress?").
- **Global `~/.claude/CLAUDE.md` rule (the fallback net).** A 2–3 line always-in-context rule: "when
  you start work that maps to a mykan card, move it to `in_progress` first; notes while working;
  `done` only when shipped + verified." This catches **direct** work (David ↔ an agent, no crew
  involved) that the chief-of-staff never sees. mykan spans all his projects (Time, Kanban, Asset
  Relay, Amos Build), so this belongs in the global file, not a single project.
- **Project `CLAUDE.md` (the specifics).** Per-repo: which mykan project maps to this repo, and any
  local conventions. (Asset Relay's repo `CLAUDE.md` already carries the lifecycle + branch-hygiene
  rules; once the global home exists, point project files at it.)

### Why not a hook?

A hook can't enforce this: there's no deterministic event for "I'm starting work that maps to a
card" — that's a judgment moment. A hook could at most inject a generic reminder, which is weaker
than the always-in-context CLAUDE.md rule. So the mechanism is instructions + ownership, not hooks.

---

## 5. Rules every actor must follow (incl. autonomous pipelines)

The 2026-06-20 miss happened **inside an automated pipeline** — automation isn't automatically
compliant. So these bind *every* actor that can move work: the main session, forks, the chief-of-staff,
and any `lfg`/ship pipeline.

1. **Single owner per card.** One actor drives a card's lifecycle at a time. Don't let two agents race
   the same card (that's also how the stale-branch mess happened).
2. **In Progress before code, always.** No `new → done`.
3. **Notes are for the human.** Append at real checkpoints (PR opened, deployed, verifying) so David
   can watch progress without asking.
4. **Done means shipped + verified**, with evidence in the closing note (PR #, deploy result, live check).
5. **Branch hygiene travels with the task.** After merge: `git checkout main && pull`, then
   `git branch -D <branch>` so `main` stays the only local branch. (GitHub auto-deletes the *remote*
   branch; the leftovers are local squash-merge artifacts.)
6. **Reconcile on entry.** If you discover work in flight whose card isn't `in_progress`, fix it.

---

## 6. mykan MCP tool reference (current surface)

| Tool | Used in step | Notes |
|------|--------------|-------|
| `mcp__mykan__list_projects` | 1 | id, name, privacy. Pick the project for this repo/context. |
| `mcp__mykan__list_items` | 1 | `project` (name or id), optional `status` filter. Source for fuzzy-matching. |
| `mcp__mykan__get_item` | 1/1b | Full body (flattened) to confirm a match. |
| `mcp__mykan__create_item` | 1b | Ad-hoc/no-card path. |
| `mcp__mykan__update_item_status` | 2, 5, 6 | `new` \| `in_progress` \| `done`. The load-bearing call. |
| `mcp__mykan__append_item_note` | 4, 5 | Progress notes + the closing note. |
| `mcp__mykan__set_item_tags` | optional | Categorize on create/triage. |

---

## 7. Worked example (David's exact phrasing)

> **David:** "implement the task - Disposals should be a Bundle type"

1. cwd is `…/koa/koa-root/asset-relay` → project **"Asset Relay"**.
2. `list_items("Asset Relay")` → fuzzy-match "Disposals should be a Bundle type" → card
   `934309a3…` ("Disposals are handled by Ed Tech … Disposals should be a Bundle type.").
   **Single confident match.**
3. **`update_item_status(934309a3…, in_progress)`** → reply: "Working **Disposals → Bundle type**
   (`934309a3`) → In Progress." *(This is the step that has been getting skipped.)*
4. Build it (delegating as needed). `append_item_note`: "PR #61 opened"; later "merged, deploying".
5. After deploy + live verification: `update_item_status(done)` + closing note with PR #61, the
   `RuntimeSuccessful` deploy, migration 017, and the live 401/SPA checks.
6. Branch hygiene: delete the local feature branch; `main` is the only local branch again.

The only behavior change from today is that **steps 2–3 are mandatory and happen up front** — so
David sees the card move to In Progress the moment work begins, and a parallel/automated workstream
can never again run invisibly.

---

## 8. To build (roadmap)

1. Add the always-on **in_progress-at-start** rule to global `~/.claude/CLAUDE.md`. *(fixes the
   reported miss immediately; lowest effort, broadest coverage)*
2. Author the **`mykan` skill or task-tracker subagent** encoding §2–§3 (resolve, lifecycle, note
   conventions, ambiguity/create handling).
3. Wire the **chief-of-staff intake** to call it as a standard step (the structural *when*).
4. Ensure **autonomous pipelines** (`lfg`/ship) include the lifecycle step so automation is compliant.
5. Point project `CLAUDE.md` files (e.g. Asset Relay) at the global home once it exists.
