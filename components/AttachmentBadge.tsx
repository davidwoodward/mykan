"use client";

/** Minimal paperclip + count shown on rows/cards when an item has attachments. */
export function AttachmentBadge({
  count,
  onClick,
}: {
  count: number;
  onClick: () => void;
}) {
  if (count <= 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${count} attachment${count > 1 ? "s" : ""}`}
      aria-label={`${count} attachment${count > 1 ? "s" : ""}`}
      className="inline-flex shrink-0 items-center gap-0.5 self-center text-xs text-[var(--color-faint)] transition-colors hover:text-[var(--color-accent)]"
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
      {count}
    </button>
  );
}
