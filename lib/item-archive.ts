// Archive / unarchive a card over MCP (KANBAN-72). Archiving is the UI trash
// icon's soft delete: it sets archived_at, which drops the card off the board,
// list_items and the epic/tag tables; clearing it brings the card back where it
// was. Pure: decides the patch, so the no-op case is unit-tested without a DB.

export type ArchivePlan =
  | { change: true; patch: { archived_at: string | null } }
  | { change: false; message: string };

/**
 * The write that puts a card in the wanted archive state, or a no-op message
 * when it is already there. `now` is injected so tests are deterministic.
 */
export function planArchive(
  currentArchivedAt: string | null | undefined,
  archived: boolean,
  ref: string,
  now: Date = new Date(),
): ArchivePlan {
  const isArchived = Boolean(currentArchivedAt);
  if (archived === isArchived) {
    return {
      change: false,
      message: archived ? `${ref} is already archived` : `${ref} is not archived`,
    };
  }
  return {
    change: true,
    patch: { archived_at: archived ? now.toISOString() : null },
  };
}
