"use client";

import { useEffect, useRef, useState } from "react";

/** Touch layouts — the same media as the `compact:` variant in `globals.css`. */
const TOUCH_QUERY = "(max-width: 63.999rem), (pointer: coarse)";

/**
 * The soft-delete (archive, restorable from the archived view) trash icon on a
 * list row or board card (KANBAN-12). Always last in its row, never beside the
 * pencil. `className` sets visibility (e.g. hover-only) on the wrapper.
 *
 * On touch layouts a tap asks first (KANBAN-59): the icon turns into an inline
 * **Delete** / Cancel pair, and only Delete archives. Cancel, Esc or a press
 * anywhere else backs out. With a mouse it stays one click.
 */
export function DeleteIconButton({
  onDelete,
  label,
  className = "",
}: {
  onDelete: () => void;
  /** Accessible name, naming the item, e.g. "Delete Fix the board". */
  label: string;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!confirming) return;
    confirmRef.current?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setConfirming(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setConfirming(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [confirming]);

  if (confirming) {
    // The hover-only visibility class is dropped while asking, so the pair
    // can't vanish mid-confirm when the row loses its (emulated) hover.
    return (
      <span
        ref={wrapRef}
        className="inline-flex shrink-0 items-center gap-3 self-center text-xs"
        role="group"
        aria-label={`Confirm: ${label}`}
      >
        <button
          ref={confirmRef}
          type="button"
          onClick={() => {
            setConfirming(false);
            onDelete();
          }}
          aria-label={`Confirm ${label}`}
          className="rounded py-1 font-medium text-[var(--color-bug)] outline-none transition-opacity hover:opacity-70 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          Delete
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded py-1 text-[var(--color-faint)] outline-none transition-colors hover:text-[var(--color-ink)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span ref={wrapRef} className={`inline-flex shrink-0 ${className}`}>
      <button
        type="button"
        onClick={() => {
          if (window.matchMedia(TOUCH_QUERY).matches) setConfirming(true);
          else onDelete();
        }}
        aria-label={label}
        title="Delete"
        className="grid h-6 w-6 place-items-center rounded text-[var(--color-faint)] outline-none transition-colors hover:text-[var(--color-bug)] focus-visible:text-[var(--color-bug)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </svg>
      </button>
    </span>
  );
}
