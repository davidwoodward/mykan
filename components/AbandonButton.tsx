"use client";

/**
 * The "Abandon changes" icon (KANBAN-42), one component for every editor.
 *
 * Nothing is written while editing, and finishing (Esc, click-off, leaving)
 * saves once; this is the explicit way out without saving: the editor discards
 * its draft and closes, writing nothing. What the draft covers is the editor's
 * call (see docs/DESIGN.md "Abandon changes"); this button only asks.
 *
 * - Icon only: a counter-clockwise arrow (revert), never a trash can or red, so
 *   it doesn't read as delete.
 * - `aria-label` plus `title`, which the app-wide tooltip layer shows ~150ms
 *   after hover and at once on keyboard focus (KANBAN-47).
 * - The press does NOT take focus (mousedown/pointerdown are prevented), so a
 *   blur-commits field being edited doesn't save the very draft being abandoned.
 */
export function AbandonButton({
  onAbandon,
  size = "md",
  disabled = false,
  label = "Abandon changes",
  className = "",
}: {
  onAbandon: () => void;
  /** md: 28px, for modal/panel headers. sm: 24px, beside an inline field. */
  size?: "md" | "sm";
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  const box = size === "md" ? "h-7 w-7" : "h-6 w-6";
  const icon = size === "md" ? "h-[18px] w-[18px]" : "h-4 w-4";
  return (
    // A disabled button fires no pointer events, so its tip sits on the wrapper
    // (the tooltip layer walks up to it).
    <span
      className={`inline-flex shrink-0 ${className}`}
      title={disabled ? "Nothing to abandon" : undefined}
    >
      <button
        type="button"
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onAbandon}
        disabled={disabled}
        aria-label={label}
        title={disabled ? undefined : label}
        className={`grid ${box} place-items-center rounded-md text-[var(--color-faint)] outline-none transition-colors hover:bg-[var(--color-canvas)] hover:text-[var(--color-ink)] focus-visible:text-[var(--color-ink)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent disabled:hover:text-[var(--color-faint)]`}
      >
        <svg
          className={icon}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8.28" />
          <path d="M3 3v5.28h5.28" />
        </svg>
      </button>
    </span>
  );
}
