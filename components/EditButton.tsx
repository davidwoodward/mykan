/**
 * The explicit "edit this item" affordance on a row/card. The item text itself
 * is now plain, selectable content (so it can be copied) rather than a link —
 * this green pencil (Feature green) is the click-to-edit path; double-clicking
 * the text opens the editor too.
 */
export function EditButton({
  onClick,
  label,
  className = "",
}: {
  onClick: () => void;
  /** Item text, woven into the accessible name. */
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Edit"
      aria-label={label ? `Edit ${label}` : "Edit"}
      className={`shrink-0 text-[var(--color-feature)] transition-opacity hover:opacity-70 ${className}`}
    >
      <svg
        className="h-[18px] w-[18px]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
      </svg>
    </button>
  );
}
