// Ordering and batch-linking for the epic pickers and children list
// (KANBAN-41 follow-up). Pure — no React, no database.
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
