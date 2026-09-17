"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** The gap between paragraphs when `blocks` is given: "just a bit". */
const PARAGRAPH_GAP = "0.4em";

/**
 * The item label (plain text from the rich body) shown on a card/row. The text
 * is plain, **selectable** content so it can be copied — it is NOT a link.
 * **Double-clicking** it opens the item editor; the explicit green pencil
 * (`EditButton`) on the row/card is the single-click path to edit.
 *
 * `clampLines` limits the body to that many lines with a Show more/less toggle
 * (shown only when the text actually overflows). 0 disables the clamp entirely.
 *
 * `blocks` (KANBAN-15), when given, renders the body as its top-level blocks
 * (`richDocBlocks`) with a small gap between paragraphs instead of the single
 * flattened `text`. The line clamp still counts lines across the blocks, and
 * the first line (the title) sits exactly where it did. Omit it to keep the
 * compact rendering (the Board's Done column).
 */
export function ClampedText({
  text,
  blocks,
  onOpen,
  clampLines,
  className,
}: {
  text: string;
  blocks?: string[];
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

  const content = !text ? (
    <span className="italic text-[var(--color-faint)]">No description</span>
  ) : blocks && blocks.length > 1 ? (
    blocks.map((block, i) => (
      <div key={i} style={i > 0 ? { marginTop: PARAGRAPH_GAP } : undefined}>
        {/* A blank paragraph still takes a line, as it did before. */}
        {block || "\u00a0"}
      </div>
    ))
  ) : (
    text
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
        title="Double-click to open"
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
