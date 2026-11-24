// The focus list's "something changed" signal (KANBAN-84). The list can now be
// open in two places at once (Home and the top-bar overlay), next to row
// targets and the card-page target. Whatever changes the list announces it on
// `window`, and every other view of it refetches its own data. `source` lets a
// view skip the echo of its own change. Browser-only: call these from effects
// and event handlers, never during render.

export const FOCUS_CHANGED = "mykan:focus-changed";

type Detail = { source: string };

/** Tell every other focus view on the page to refresh. */
export function announceFocusChange(source: string): void {
  window.dispatchEvent(new CustomEvent<Detail>(FOCUS_CHANGED, { detail: { source } }));
}

/** Run `fn` when another view changes the focus list. Returns the unsubscribe. */
export function onFocusChange(source: string, fn: () => void): () => void {
  const handler = (e: Event) => {
    if ((e as CustomEvent<Detail>).detail?.source !== source) fn();
  };
  window.addEventListener(FOCUS_CHANGED, handler);
  return () => window.removeEventListener(FOCUS_CHANGED, handler);
}
