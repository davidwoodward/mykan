"use client";

import { useLayoutEffect, useRef, useState } from "react";

type DragProps = Record<string, unknown>;

/**
 * The item label (plain text from the rich body) shown on a card/row. When
 * `clamp` is set — currently for Done items, whose descriptions pile up — the
 * text is limited to the first 5 lines and a Show more/less toggle appears,
 * but only when the text actually overflows that height.
 *
 * The clickable text opens the item; the toggle is a separate control so
 * expanding never triggers an open (or, on the board, a drag).
 */
export function ClampedText({
  text,
  onOpen,
  clamp,
  className,
  dragProps,
}: {
  text: string;
  onOpen: () => void;
  clamp: boolean;
  className: string;
  /** dnd-kit attributes + listeners; when present the text renders as a div. */
  dragProps?: DragProps;
}) {
  const ref = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  const collapsed = clamp && !expanded;

  // Measure overflow while collapsed; re-measure on width changes. When
  // expanded we keep `overflowing` so the toggle stays available to collapse.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || collapsed === false) return;
    const check = () =>
      setOverflowing(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsed, text]);

  const content = text || (
    <span className="italic text-[var(--color-accent)]">View content</span>
  );

  // Inline so it beats any `display` utility in `className` (e.g. the list
  // view's `block`), which would otherwise cancel out the `-webkit-box`
  // that `-webkit-line-clamp` needs.
  const clampStyle: React.CSSProperties | undefined = collapsed
    ? {
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: 5,
        overflow: "hidden",
      }
    : undefined;

  return (
    <>
      {dragProps ? (
        <div
          ref={ref as React.RefObject<HTMLDivElement>}
          {...dragProps}
          onClick={onOpen}
          title="Open"
          className={className}
          style={clampStyle}
        >
          {content}
        </div>
      ) : (
        <button
          ref={ref as React.RefObject<HTMLButtonElement>}
          type="button"
          onClick={onOpen}
          title="Open"
          className={className}
          style={clampStyle}
        >
          {content}
        </button>
      )}
      {clamp && overflowing && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-0.5 text-xs font-medium text-[var(--color-muted)] transition-colors hover:text-[var(--color-accent)]"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}
