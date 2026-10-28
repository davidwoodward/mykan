// Ordering and batch-linking for the epic pickers and children list
// (KANBAN-41 follow-up), and the epic's own child order (KANBAN-68). Pure — no
// React, no database.
import { computePosition } from "./position.ts";
import { ITEM_STATUSES, type ItemStatus } from "./types.ts";

/** The fields the epic ordering reads. */
export type StatusNumbered = { status: ItemStatus; number: number };

/**
 * Board column rank of a status (new → in_progress → blocked → testing → done).
 * Derived from ITEM_STATUSES so it follows the board. An unknown status sorts
 * after Done rather than ahead of Not started.
 */
export function statusRank(status: string): number {
  const i = (ITEM_STATUSES as readonly string[]).indexOf(status);
  return i === -1 ? ITEM_STATUSES.length : i;
}

/**
 * Epic list order: status in board column order, then item number ascending.
 * Board position is deliberately ignored.
 */
export function compareStatusThenNumber(a: StatusNumbered, b: StatusNumbered): number {
  return statusRank(a.status) - statusRank(b.status) || a.number - b.number;
}

/** A sorted copy (the input is left untouched). */
export function sortByStatusThenNumber<T extends StatusNumbered>(items: readonly T[]): T[] {
  return [...items].sort(compareStatusThenNumber);
}

/** One failed link in a batch: the item id and why. */
export type LinkFailure = { id: string; error: string };

/**
 * Link several items one after another (never in parallel, so each PATCH meets
 * the database guards exactly as a single link would). `link` resolves to null
 * on success or an error message; a throw counts as a failure too. Every id is
 * attempted; the failures come back in input order.
 */
export async function linkSequentially(
  ids: readonly string[],
  link: (id: string) => Promise<string | null>,
  onProgress?: (done: number, total: number) => void,
): Promise<LinkFailure[]> {
  const failures: LinkFailure[] = [];
  let done = 0;
  for (const id of ids) {
    let error: string | null;
    try {
      error = await link(id);
    } catch (e) {
      error = (e instanceof Error ? e.message : String(e)) || "Failed";
    }
    if (error !== null) failures.push({ id, error });
    done += 1;
    onProgress?.(done, ids.length);
  }
  return failures;
}

/** A child as the epic's own order reads it (KANBAN-68). */
export type EpicPositioned = {
  id: string;
  status: string;
  number: number;
  epic_position: number | null;
};

/** The epic's own sequence: epic_position ascending (unset last), then number. */
export function compareEpicPosition(a: EpicPositioned, b: EpicPositioned): number {
  const pa = a.epic_position ?? Infinity;
  const pb = b.epic_position ?? Infinity;
  if (pa !== pb) return pa < pb ? -1 : 1;
  return a.number - b.number;
}

/** A copy in the epic's own sequence (the input is left untouched). */
export function sortByEpicPosition<T extends EpicPositioned>(items: readonly T[]): T[] {
  return [...items].sort(compareEpicPosition);
}

/** Where a moved card goes: next to a sibling, or to an end of its status group. */
export type EpicMoveTarget = { before: string } | { after: string } | { to: "top" | "bottom" };

/** One epic_position to write. */
export type EpicWrite = { id: string; epic_position: number };

export type EpicPlan =
  | { ok: true; writes: EpicWrite[]; skipped: string[] }
  | { ok: false; error: string };

const DONE_FIXED = "done cards keep the order they were completed in";

/** Every card renumbered 1024 apart in `seq` order; only the changes are written. */
function renumber(seq: readonly EpicPositioned[]): EpicWrite[] {
  return seq.flatMap((c, i) =>
    c.epic_position === (i + 1) * 1024 ? [] : [{ id: c.id, epic_position: (i + 1) * 1024 }],
  );
}

/** True when every child has its own, distinct epic_position. */
function wellNumbered(seq: readonly EpicPositioned[]): boolean {
  const seen = new Set<number>();
  for (const c of seq) {
    if (c.epic_position == null || seen.has(c.epic_position)) return false;
    seen.add(c.epic_position);
  }
  return true;
}

/**
 * Move one child within its status group. A done card can't move, and the
 * sibling it moves next to must share its status. Writes one position (the
 * midpoint of its new neighbours in the epic's sequence), or renumbers the
 * whole epic when positions are missing, shared or too close to split. `refOf`
 * names cards in error messages.
 */
export function planEpicMove(
  children: readonly EpicPositioned[],
  id: string,
  target: EpicMoveTarget,
  refOf: (c: EpicPositioned) => string,
): EpicPlan {
  const seq = sortByEpicPosition(children);
  const me = seq.find((c) => c.id === id);
  if (!me) return { ok: false, error: "That card is not a child of this epic" };
  if (me.status === "done") return { ok: false, error: `${refOf(me)} is done; ${DONE_FIXED}` };

  const group = seq.filter((c) => c.status === me.status && c.id !== me.id);
  let anchor: EpicPositioned | undefined;
  let after: boolean;
  if ("to" in target) {
    if (group.length === 0) return { ok: true, writes: [], skipped: [] };
    after = target.to === "bottom";
    anchor = after ? group[group.length - 1] : group[0];
  } else {
    after = "after" in target;
    const anchorId = "after" in target ? target.after : target.before;
    anchor = seq.find((c) => c.id === anchorId);
    if (!anchor) return { ok: false, error: "The card to move next to is not a child of this epic" };
    if (anchor.id === me.id) return { ok: false, error: `${refOf(me)} can't move next to itself` };
    if (anchor.status !== me.status) {
      return {
        ok: false,
        error: `${refOf(me)} is ${me.status} and ${refOf(anchor)} is ${anchor.status}; a card moves only within its own status group`,
      };
    }
  }

  const rest = seq.filter((c) => c.id !== me.id);
  const at = rest.indexOf(anchor) + (after ? 1 : 0);
  const next = [...rest.slice(0, at), me, ...rest.slice(at)];
  if (next.every((c, i) => c === seq[i])) return { ok: true, writes: [], skipped: [] };
  if (!wellNumbered(seq)) return { ok: true, writes: renumber(next), skipped: [] };

  const lo = next[at - 1]?.epic_position ?? undefined;
  const hi = next[at + 1]?.epic_position ?? undefined;
  const pos = computePosition(lo, hi);
  if ((lo != null && pos <= lo) || (hi != null && pos >= hi)) {
    return { ok: true, writes: renumber(next), skipped: [] };
  }
  return { ok: true, writes: [{ id: me.id, epic_position: pos }], skipped: [] };
}

/**
 * Put the listed children in the given order. The listed cards take over the
 * places they already hold in the epic's sequence, in list order, so cards left
 * off the list stay where they are and the list can cover one status group or
 * several. Done cards are skipped (returned in `skipped`): they keep their
 * completion order. Ids must be children; a repeated id counts once.
 */
export function planEpicOrder(children: readonly EpicPositioned[], ids: readonly string[]): EpicPlan {
  const seq = sortByEpicPosition(children);
  const byId = new Map(seq.map((c) => [c.id, c]));
  const listed: EpicPositioned[] = [];
  const skipped: string[] = [];
  for (const id of new Set(ids)) {
    const c = byId.get(id);
    if (!c) return { ok: false, error: "A listed card is not a child of this epic" };
    if (c.status === "done") skipped.push(id);
    else listed.push(c);
  }
  // Slots are positions in the sequence; renumbered first if they aren't usable.
  const base = wellNumbered(seq)
    ? seq.map((c) => c.epic_position as number)
    : seq.map((_, i) => (i + 1) * 1024);
  const slots = listed.map((c) => seq.indexOf(c)).sort((a, b) => a - b);
  const pos = new Map(seq.map((c, i) => [c.id, base[i]]));
  listed.forEach((c, k) => pos.set(c.id, base[slots[k]]));
  const writes = seq.flatMap((c) => {
    const p = pos.get(c.id) as number;
    return p === c.epic_position ? [] : [{ id: c.id, epic_position: p }];
  });
  return { ok: true, writes, skipped };
}
