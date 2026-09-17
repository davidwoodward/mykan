"use client";

/**
 * The soft-delete (archive, restorable from the archived view) trash icon on a
 * list row or board card (KANBAN-12). Always last in its row, never beside the
 * pencil. `className` sets visibility (e.g. hover-only) on the wrapper.
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
  return (
    <span className={`inline-flex shrink-0 ${className}`}>
      <button
        type="button"
        onClick={onDelete}
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
