/**
 * Vim-style count prefix for the board/list keyboard navigation (KANBAN-66):
 * digits typed before `G` pick a card by its number, so `125G` selects
 * AMOS-125. A count can't start with 0, which keeps a bare `0` meaning "top".
 *
 * Returns the extended pending count when `key` is a count digit, or null when
 * it isn't one (the caller then treats the key normally and drops the count).
 */
export function extendCount(pending: string, key: string): string | null {
  if (key.length !== 1 || key < "0" || key > "9") return null;
  if (key === "0" && pending === "") return null;
  // Cap the length so a held-down key can't grow it without bound.
  return (pending + key).slice(0, 9);
}
