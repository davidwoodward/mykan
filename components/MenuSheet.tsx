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
 * field (e.g. the token label) in view. A press outside the panel or Esc
 * closes it; the owning component already does both against `panelRef`
 * (a mousedown outside it, Esc on the document), so this only lays it out.
 */
export function MenuSheet({
  label,
  panelRef,
  children,
}: {
  label: string;
  panelRef: RefObject<HTMLDivElement | null>;
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
        className="max-h-full w-full max-w-md overflow-y-auto overscroll-contain rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-sm shadow-2xl"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
