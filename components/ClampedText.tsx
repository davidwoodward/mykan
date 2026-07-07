"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * The item label (plain text from the rich body) shown on a card/row. The text
 * is plain, **selectable** content so it can be copied — it is NOT a link.
 * **Double-clicking** it opens the item editor; the explicit green pencil
 * (`EditButton`) on the row/card is the single-click path to edit.
 *
 * `clampLines` limits the body to that many lines with a Show more/less toggle
 * (shown only when the text actually overflows). 0 disables the clamp entirely.
 */
export function ClampedText({
  text,
  onOpen,
  clampLines,
  className,
}: {
  text: string;
  onOpen: () => void;
  clampLines: number;
  className: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  const clamp = clampLines > 0;
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
    <span className="italic text-[var(--color-faint)]">No description</span>
  );

  // Inline so it beats any `display` utility in `className` (e.g. the list
  // view's `block`), which would otherwise cancel out the `-webkit-box`
  // that `-webkit-line-clamp` needs.
  const clampStyle: React.CSSProperties | undefined = collapsed
    ? {
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: clampLines,
        overflow: "hidden",
      }
    : undefined;

  return (
    <>
      <div
        ref={ref}
        onDoubleClick={onOpen}
        title="Double-click to edit"
        className={`cursor-text select-text ${className}`}
        style={clampStyle}
      >
        {content}
      </div>
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
