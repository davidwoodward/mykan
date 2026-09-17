// Getting back to the board from a card page (KANBAN-44).
//
// Filters, grouping and search live in the board's URL (lib/board-state.ts).
// This module keeps the rest, per browser tab (sessionStorage, every access
// try/catch'd so a private window just doesn't remember):
//  - where the board was scrolled (the desktop list/board is its own scroll
//    box, which the browser's own scroll restoration never touches) and which
//    card was opened, so the board comes back as it was;
//  - whether the card page was opened from the board in this tab, so Esc can
//    go Back (one history entry) instead of stacking a new board entry;
//  - card saves still in flight when the card page unmounts (browser Back), so
//    the board waits for them before it loads and never shows the old text.

type BoardScroll = {
  listTop: number;
  windowY: number;
  /** The card that was opened, to reselect on return. */
  number: number | null;
  at: number;
};

const scrollKey = (key: string) => `mykan:board-scroll:v1:${key}`;
const FROM_BOARD = "mykan:card-from-board:v1";
/** A remembered scroll older than this is ignored (a stale visit). */
const SCROLL_TTL_MS = 30 * 60 * 1000;

function ss(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Remember the board's scroll and the opened card, just before opening it. */
export function rememberBoardScroll(key: string, s: Omit<BoardScroll, "at">): void {
  try {
    ss()?.setItem(scrollKey(key), JSON.stringify({ ...s, at: Date.now() }));
  } catch {
    // Not remembered; the board still opens at the top.
  }
}

/** Take (read and forget) the remembered scroll for a board, if recent. */
export function takeBoardScroll(key: string): BoardScroll | null {
  try {
    const store = ss();
    const raw = store?.getItem(scrollKey(key));
    store?.removeItem(scrollKey(key));
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<BoardScroll>;
    if (typeof s.at !== "number" || Date.now() - s.at > SCROLL_TTL_MS) return null;
    return {
      listTop: typeof s.listTop === "number" ? s.listTop : 0,
      windowY: typeof s.windowY === "number" ? s.windowY : 0,
      number: typeof s.number === "number" ? s.number : null,
      at: s.at,
    };
  } catch {
    return null;
  }
}

/** Mark: the next card page in this tab sits directly on top of `key`'s board. */
export function markCardFromBoard(key: string): void {
  try {
    ss()?.setItem(FROM_BOARD, key);
  } catch {
    // Esc falls back to navigating to the board.
  }
}

/**
 * Take the mark: true when the card page was opened from this project's board
 * (so history Back returns there). Consumed on read, so a later unrelated visit
 * to a card can't go Back to somewhere else.
 */
export function takeCardFromBoard(key: string): boolean {
  try {
    const store = ss();
    const v = store?.getItem(FROM_BOARD);
    store?.removeItem(FROM_BOARD);
    return v === key;
  } catch {
    return false;
  }
}

/** Forget the mark (the board itself mounted: nothing sits on top of it). */
export function clearCardFromBoard(): void {
  try {
    ss()?.removeItem(FROM_BOARD);
  } catch {
    // Nothing to do.
  }
}

const pending = new Set<Promise<unknown>>();

/** Track a card save that may still be in flight after its page unmounts. */
export function trackPendingSave(p: Promise<unknown>): void {
  const done = p.then(
    () => undefined,
    () => undefined,
  );
  pending.add(done);
  void done.then(() => pending.delete(done));
}

/** Resolves once tracked saves settle, or after `capMs`, whichever is first. */
export function pendingSavesSettled(capMs = 4000): Promise<void> {
  if (pending.size === 0) return Promise.resolve();
  return Promise.race([
    Promise.all([...pending]).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, capMs)),
  ]);
}
