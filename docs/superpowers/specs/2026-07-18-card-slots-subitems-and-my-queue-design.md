# Card slots, sub-items, and My Queue

**Date:** 2026-07-18
**Card:** KANBAN-32
**Status:** design / noodled — not yet planned, not yet built
**Supersedes:** the "no roles / no comment threads" line in `PRODUCT.md:25`
**Builds on:** KANBAN-18 (deferred-but-named tester field), KANBAN-8 (title vs content)

---

## The problem

A mykan item has exactly one content field. `body` (Tiptap JSONB) is the title *and*
the description *and* the notes — the `name` column was deliberately dropped
2026-06-30, and the title is now the first line of `body`, computed on read via
`richDocText`.

That worked when a card held one thought. It no longer does. A card now carries three
kinds of content written by three different authors:

1. **What we want** — written by David or by Matthew as SME.
2. **How we'll build it** — technical approach, usually written by Claude Code or Codex.
3. **Tester feedback** — verification results, inherently chronological.

They are textually indistinguishable. `append_item_note` glues a bare paragraph onto
the end of the same document — no separator, no author, no timestamp, no type. (The
2026-06-15 MCP spec called for a separating horizontal rule; it was never implemented.)
`set_item_body` replaces the whole document, so today's answer to "the agent writes the
technical plan" is *overwrite the SME's words and trust `item_versions` to have caught
them*.

The distinction already exists as **convention** — `CHIEF_MCP_FLOW.md` and the
`work-item` skill both say "treat `body_text` as the task spec, append progress notes at
checkpoints." It has zero representation in the data model. It is prose etiquette,
enforced by nothing.

Separately: work now arrives at a size that needs splitting into several cards that
work together — a controlling card and the cards that deliver it — while staying
orderable both by feature and by task.

---

## Decision 1 — Three owned slots; ownership sets the history policy

A card is read as **current state**, not as a conversation. `item_versions` supplies
history and rollback.

| Slot | Owner | Shape | History |
|---|---|---|---|
| **Intent** — what we want | David / Matthew (SME) | Rewritten in place | Versioned, rollback-able |
| **Approach** — how we'll build it | Agent (Claude Code / Codex) | Rewritten in place; always current truth | **Not** versioned — disposable |
| **Feedback** — tester / QA | Anyone | Append-only rows, separate table | Never versioned — entries immutable |

The organizing principle is **ownership**, and the history policy falls out of it rather
than being bolted on. David's constraint — *"I really only want `item_versions` for UI
modified content"* — stops being a special case: Intent is the only human-owned
rewritable slot, so versioning Intent *is* versioning his edits.

Two consequences worth stating:

- Agent overwrites of Approach being unrecoverable is **fine by design**. That slot is
  the agent's scratch space: always current, never precious.
- The agent can no longer reach Intent at all, which removes the failure mode this whole
  design starts from.

Each person owns one slot. Matthew writes Intent; Claude writes Approach; Matthew writes
Feedback; David moves between all three.

**Feedback is a separate table**, not a slot on the item — it is the one content kind
that is genuinely chronological ("round 3 failed, here's why"). Entries are immutable and
never versioned.

## Decision 2 — Sub-items are real items

A sub-item is a **real `KANBAN-N` item**: own number, own status, board presence,
independently movable. Not a checklist row inside a parent.

**Parent Feature status is independent**, not derived from children. It is set by hand
and may disagree with its children, but the card shows a quiet child roll-up
(`3/5 done`) so drift is visible without being enforced.

Rejected: deriving the Feature's status from its children. It is more honest and
self-maintaining, but it removes the ability to drag a Feature between columns, which
fights how the board works today — and a Feature whose status silently jumped because an
agent moved a sub-task is exactly the kind of surprise this design exists to prevent.

**Group-by-Feature is a fourth lens, not a new ordering system.** `docs/DESIGN.md:52`
already establishes "one global order; several lenses" — the List groups the single
per-project `items.position` float by Status, Area, or Flat; the Board groups the same
order into columns. Grouping by Feature joins that set. Ordering *by feature* and
ordering *by task* are two lenses over one `position`, so the existing flat global float
is not the obstacle it first appears to be.

## Decision 3 — Matthew never sees the tree

Hierarchy is an authoring tool for David. Showing it to Matthew makes his experience
strictly worse.

Matthew has **two hats at different altitudes, used at different times** — and neither
needs the tree:

| Hat | Sees | Ordering |
|---|---|---|
| **Authoring** | Flat list of **Features only** — parents, never children | The feature order |
| **Verifying** | Flat list of **what's assigned to him in Testing** — any depth, level never shown | His queue |

Filtering Matthew *by level* is the trap, and it does not survive contact with reality: a
sub-item may be exactly the thing that needs testing. The rung has nothing to do with
whether it is his. The two views are unrelated — a sub-task reaches him through the
queue and never appears in his feature list.

Hiding children from the authoring view is correct, not a compromise: sub-items are the
implementation decomposition, downstream of his intent.

**No new screens.** Both hats are the existing List/Board with a filter applied. The
authoring lens (`type = feature AND no parent`, grouped Flat, drag-reorderable) is the
only one that needs new capability, and only because there is no parent concept to filter
on yet.

Side benefit: the authoring view is where Matthew would reorder features — genuine
priority signal from the SME that there is currently no clean way to collect.

## Decision 4 — My Queue, and the tester field

> **My Queue** = `tester = me AND status = testing`

One condition per hat. Nothing inferred, nothing conflated — which is why the queue can
be a plain visible filter rather than special logic.

This **requires the tester field** that KANBAN-18 deferred but named:

> "a 'tester' role is a genuine second role, distinct from 'who built it.' … it becomes
> its own **NULLABLE field on the item — NOT another entry in the flat assignees list**
> (that would permanently blur builder vs tester). Shown as its own chip, maybe defaulted
> by item type. Safe to defer because nothing about the column depends on it — adding it
> later is purely additive (one field, one chip)."

Without it the only expressible query is `assignees contains matthew`, which conflates
*"I built this"* with *"I need to check this"* — precisely the ambiguity that makes the
board hard for him today.

KANBAN-18's deferral trigger ("when the team grows past eyeball-size") has now fired, and
its additive-cost prediction held: still one field, one chip.

**Pull forward "maybe defaulted by item type."** KANBAN-18 recorded the interim human
rule — *technical items → David, everything else → Matthew* — and `type`
(feature/bug/task/idea) approximates that axis. A queue that must be hand-populated goes
stale.

The tester field also composes with Decision 2 without extra machinery: set
`tester = matthew` on a sub-item three levels down and it surfaces in his queue at full
size, with no hint of the tree. The field is what makes depth irrelevant to him.

## Decision 5 — Defaulted, visible filters; the view is named, not the user

**Same front door.** Everyone lands on the same app; a per-user preference decides which
filter is pre-applied.

> **Start me on:** `My Queue ▾` — values: `My Queue` · `Features` · `Everything`

**Name the view, not the user.** A profile that says *"You are a: Tester"* creates a
caste — it reads as a rank, invites "what am I not allowed to do?", and re-opens the
"roles" door `PRODUCT.md` shut. It is also less true: Matthew writes features *and* tests
them. Naming the destination is self-describing, carries no identity, and changes freely.
`Everything` makes it obvious nothing is withheld.

**The filter is defaulted, not hidden.** It appears as set, clearable chips in the
toolbar — Matthew sees `Testing ×` and `Mine ×` already applied. This is the difference
between a lens and a smaller app, and it is the escape hatch: clearing a chip *is* the
escape, so no separate exit concept is needed. Mouse-driven throughout, per the
pointer-complete-first rule in the UI standard.

The failure mode this prevents: opening mykan, seeing 6 cards instead of 40, and either
not knowing why or — worse — not noticing, and assuming that is everything.

**This is a preference, not a permission.** Everyone still sees and can do everything.
Stated explicitly because the setting sits adjacent enough to "roles" that future readers
will otherwise assume an access model behind it. There is none.

Matthew's whole conceptual model becomes two sentences: *"Here's what I want"* and
*"Here's what's waiting on me."* No columns to reason about, no levels, no tree.

---

## Lineage and reconciliation

**`PRODUCT.md:25` is superseded.** It names as anti-goal: *"No sprints, estimates, comment
threads, audit trails, notifications, or roles."* That constraint was written for the
initial build and was satisfied by it. mykan is now in daily heavy use, and
`docs/competitive-analysis.md:133` (2026-07-12) already lists **sub-items**, **item
relations**, and **comments** as table-stakes gaps worth closing. The two documents have
been in unresolved tension since July; this design resolves it in favour of the newer
one. `PRODUCT.md` should be updated to say so, and to record that the anti-goal did its
job rather than deleting it.

**KANBAN-8 is reconciled, not reversed.** That card concluded: *"the editor is still a
single rich-text body field (there is no separate title input) — that is now the
intended, consistent model."* Recorded explicitly so this does not read as quietly
overturning a settled decision:

- KANBAN-8 rejected splitting **one thought into two fields** — a title and a description
  of the same thing. Genuinely annoying; correctly rejected.
- Slots split **different authors writing different things** — your intent vs the agent's
  plan.

Different problem, opposite answer.

**KANBAN-18** supplies the tester field and the Testing gate this builds on.

---

## Open questions — not yet decided

- **Migration of `body` → Intent.** The title is currently `body`'s first line via
  `richDocText`. Slots mean deciding where the title comes from — almost certainly
  Intent's first line, but it migrates a load-bearing assumption.
- **The Feedback table shape** — columns, whether entries are typed, whether they can be
  resolved/dismissed.
- **Is Approach agent-write-only**, or may a human edit it?
- **MCP tool parity.** Every UI surface here needs matching MCP tools —
  `set_item_intent` / `set_item_approach` / `add_feedback`, parent/child on `create_item`
  and `list_items`, and tester on assignment. `append_item_note` and `set_item_body` both
  need rethinking against the slot model.
- **Where `Start me on` is stored.** Existing per-user prefs (keyboard-nav gate, column
  collapse) use `localStorage`, which is per-device; a landing view likely wants to be
  server-side against the user, since Matthew may open it on a phone.
- **Scope/sequencing.** This is at least three shippable pieces (tester + My Queue;
  sub-items; slots). Tester + My Queue is the smallest and highest-value first slice, and
  is independent of the other two.

## Unrelated hygiene note

`done_at` exists in the live Supabase DB and is referenced in `lib/types.ts:337` and
`lib/item-history.ts`, but appears in neither `schema.sql` nor any migration — it was
applied via the Management API without a committed migration. A rebuild from `schema.sql`
would come up missing it. Surfaced while researching this design; unrelated to it.
