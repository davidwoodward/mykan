/**
 * The explicit "open this card" affordance on a row/card. The item text itself
 * is plain, selectable content (so it can be copied) rather than a link; this
 * green pencil (Feature green) is the click-to-open path, and double-clicking
 * the text opens the card too.
 *
 * With `href` (the card page, /KEY-N, KANBAN-44) it is a real link: the URL
 * shows on hover and Cmd/Ctrl/middle-click opens the card in a new tab, while a
 * plain click runs `onClick` (which remembers the board's scroll first).
 *
 * Tooltip: a plain `title`, shown promptly by the app-wide tooltip layer
 * (KANBAN-47); `className` goes on the wrapper.
 */
export function EditButton({
  onClick,
  href,
  label,
  className = "",
}: {
  onClick: () => void;
  href?: string;
  /** Item text, woven into the accessible name. */
  label?: string;
  className?: string;
}) {
  const icon = (
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
  );
  const cls = "shrink-0 text-[var(--color-feature)] transition-opacity hover:opacity-70";
  const tip = href ? "Open card" : "Edit";
  const wrap = `inline-flex shrink-0 ${className}`;
  if (href) {
    return (
      <span className={wrap}>
        <a
          href={href}
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            onClick();
          }}
          aria-label={label ? `Open ${label}` : "Open card"}
          title={tip}
          className={cls}
        >
          {icon}
        </a>
      </span>
    );
  }
  return (
    <span className={wrap}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label ? `Edit ${label}` : "Edit"}
        title={tip}
        className={cls}
      >
        {icon}
      </button>
    </span>
  );
}
