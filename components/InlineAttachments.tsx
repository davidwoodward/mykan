"use client";

import { useEffect, useRef, useState } from "react";
import { Attachments } from "@/components/Attachments";
import type { Item } from "@/lib/types";

/**
 * Inline attachments affordance for list rows and board cards — the minimal
 * analog of InlineTags. Shows a paperclip + count (or just the clip on hover
 * when empty); clicking opens a small popover with the Attach button and the
 * View/Download/Rename/Remove list. No modal required.
 */
export function InlineAttachments({
  item,
  onItemChange,
}: {
  item: Item;
  onItemChange: (item: Item) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const count = item.attachments.length;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative self-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={count ? `${count} attachment${count > 1 ? "s" : ""}` : "Attach a file"}
        aria-label={count ? `${count} attachments` : "Attach a file"}
        className={`inline-flex shrink-0 items-center gap-0.5 text-xs transition-colors hover:text-[var(--color-accent)] ${
          count > 0
            ? "text-[var(--color-faint)]"
            : "invisible text-[var(--color-faint)] group-hover:visible"
        }`}
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
          <path
            d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {count > 0 ? count : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-6 z-30 w-80 max-w-[80vw] rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-2.5 shadow-lg">
          <Attachments item={item} onItemChange={onItemChange} />
        </div>
      ) : null}
    </div>
  );
}
