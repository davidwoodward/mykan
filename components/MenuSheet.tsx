"use client";

import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

/**
 * A top-bar popup opened from the profile menu on the touch layout (KANBAN-87):
 * the same panel the desktop icon opens, centred in a sheet over the page
 * instead of hanging off an icon that isn't there.
 *
 * The overlay tracks `visualViewport`, so when the on-screen keyboard opens the
 * sheet shrinks with the visible area and its own scroll keeps the focused
 * field (e.g. the token label) in view. The × in the corner, a press outside
 * the panel or Esc closes it; the owning component handles the last two
 * against `panelRef` (a mousedown outside it, Esc on the document). Each
 * panel's title row keeps `pr-9` clear in sheet mode so nothing sits under
 * the ×.
 */
export function MenuSheet({
  label,
  panelRef,
  onClose,
  children,
}: {
  label: string;
  panelRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const fit = () => setBox({ top: vv.offsetTop, height: vv.height });
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-x-0 z-50 flex items-center justify-center bg-black/40 p-3"
      style={box ? { top: box.top, height: box.height } : { top: 0, bottom: 0 }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        // The raised shade sets the sheet apart from the page in both themes;
        // fields inside sit on the page colour so they still read as fields.
        className="relative max-h-full w-full max-w-md overflow-y-auto overscroll-contain rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-raised)] p-3 text-sm shadow-2xl [&_input]:bg-[var(--color-canvas)]"
      >
        <button
          type="button"
          onClick={onClose}
          title="Close (Esc)"
          aria-label={`Close ${label}`}
          className="absolute right-1.5 top-1.5 grid h-8 w-8 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-ink)]"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
