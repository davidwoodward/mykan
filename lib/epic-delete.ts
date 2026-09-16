// Permanent delete of an item that has children (an epic), with history on
// every child (KANBAN-41). Pure orchestration: the database steps are injected,
// so the ordering and failure handling are unit-tested without a database.
//
// Order: unlink each child through the history chokepoint FIRST, then delete
// the epic. The FK (on delete set null) stays as a backstop for a child linked
// between the listing and the delete, which would be un-linked without history.
//
// Failure handling, chosen so a failed delete leaves the board as it was:
//  - a child fails to unlink → re-link the children already unlinked and do
//    NOT delete the epic.
//  - the epic delete fails after every child was unlinked → re-link them all.
// Re-linking also goes through the chokepoint, so each affected child's
// history truthfully shows "removed" then "→ epic" again. A re-link that itself
// fails is reported by id (the child is left unlinked, never half-written).

/** One step's outcome: null on success, else a message. */
export type StepResult = string | null;

export type EpicDeleteSteps = {
  /** Every child of the item being deleted (archived included), in any order. */
  childIds: string[];
  /** Clear one child's parent through the history chokepoint. */
  unlink: (childId: string) => Promise<StepResult>;
  /** Put one child's parent back (compensation) through the chokepoint. */
  relink: (childId: string) => Promise<StepResult>;
  /** Delete the item row itself. */
  deleteItem: () => Promise<StepResult>;
};

export type EpicDeleteOutcome =
  | { ok: true; unlinked: string[] }
  | {
      ok: false;
      /** What went wrong, suitable to show the user. */
      error: string;
      /** Whether the item row was deleted (always false on failure). */
      deleted: false;
      /** Children whose compensating re-link also failed (left unlinked). */
      relinkFailed: string[];
    };

/** Postgres error code for check_violation (raised by the delete guard). */
const CHECK_VIOLATION = "23514";

/**
 * What to tell the user when the row delete itself fails. The database's delete
 * guard (items_guard_delete_with_children) refuses to delete an item that still
 * has children; after the app has un-linked every child it knew about, that can
 * only mean a card was added to the epic in the meantime — a conflict (409),
 * not a server fault.
 */
export function describeDeleteFailure(
  code: string | undefined,
  message: string,
): { message: string; status: 409 | 500 } {
  if (code === CHECK_VIOLATION) {
    return {
      message:
        "another card was added to this epic while it was being deleted; try again",
      status: 409,
    };
  }
  return { message, status: 500 };
}

async function relinkAll(
  ids: string[],
  relink: EpicDeleteSteps["relink"],
): Promise<string[]> {
  const failed: string[] = [];
  for (const id of ids) {
    if ((await relink(id)) !== null) failed.push(id);
  }
  return failed;
}

export async function deleteWithChildHistory(
  steps: EpicDeleteSteps,
): Promise<EpicDeleteOutcome> {
  const unlinked: string[] = [];
  for (const id of steps.childIds) {
    const err = await steps.unlink(id);
    if (err !== null) {
      const relinkFailed = await relinkAll(unlinked, steps.relink);
      return {
        ok: false,
        deleted: false,
        error: `Could not remove a child item from the epic (${err}); nothing was deleted`,
        relinkFailed,
      };
    }
    unlinked.push(id);
  }
  const delErr = await steps.deleteItem();
  if (delErr !== null) {
    const relinkFailed = await relinkAll(unlinked, steps.relink);
    return {
      ok: false,
      deleted: false,
      error: `Delete failed (${delErr}); its child items were linked back to it`,
      relinkFailed,
    };
  }
  return { ok: true, unlinked };
}
