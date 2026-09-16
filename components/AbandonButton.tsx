"use client";

/**
 * The "Abandon changes" icon (KANBAN-42), one component for every editor.
 *
 * Editing saves implicitly (autosave, Esc and leaving the editor all keep your
 * work); this is the explicit way back: the editor restores what it was editing
 * to how it was when it opened, then closes. What "as opened" means is the
 * editor's call (see docs/DESIGN.md "Abandon changes"); this button only asks.
 *
 * - Icon only: a counter-clockwise arrow (revert), never a trash can or red, so
 *   it doesn't read as delete.
 * - `title` (hover tooltip) + `aria-label`, plus a styled tooltip shown on
 *   keyboard focus, where the native title never appears.
 * - The press does NOT take focus (mousedown/pointerdown are prevented), so a
 *   blur-commits field being edited doesn't save the very draft being abandoned.
 */
export function AbandonButton({
  onAbandon,
  size = "md",
  disabled = false,
  label = "Abandon changes",
  tooltipAlign = "right",
  className = "",
}: {
  onAbandon: () => void;
  /** md: 28px, for modal/panel headers. sm: 24px, beside an inline field. */
  size?: "md" | "sm";
  disabled?: boolean;
  label?: string;
  /** Which edge of the button the focus tooltip lines up with. */
  tooltipAlign?: "left" | "right";
  className?: string;
}) {
  const box = size === "md" ? "h-7 w-7" : "h-6 w-6";
  const icon = size === "md" ? "h-[18px] w-[18px]" : "h-4 w-4";
  return (
    <span className={`relative inline-flex shrink-0 ${className}`}>
      <button
        type="button"
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onAbandon}
        disabled={disabled}
        title={label}
        aria-label={label}
        className={`peer grid ${box} place-items-center rounded-md text-[var(--color-faint)] outline-none transition-colors hover:bg-[var(--color-canvas)] hover:text-[var(--color-ink)] focus-visible:text-[var(--color-ink)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:cursor-wait disabled:opacity-50`}
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
      <span
        role="presentation"
        aria-hidden="true"
        className={`pointer-events-none absolute top-full z-50 mt-1 hidden whitespace-nowrap rounded bg-[var(--color-ink)] px-1.5 py-0.5 text-[11px] font-normal normal-case tracking-normal text-[var(--color-surface)] shadow peer-focus-visible:block ${
          tooltipAlign === "right" ? "right-0" : "left-0"
        }`}
      >
        {label}
      </span>
    </span>
  );
}
