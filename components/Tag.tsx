"use client";

import { tagStyle } from "@/lib/types";

/**
 * An auto-coloured tag chip. Plain text by default; pass `onClick` to make it a
 * toggle (filter), `active` to show it selected (inverted fill), or `onRemove`
 * to show a ✕ (editor).
 */
export function Tag({
  label,
  onClick,
  active = false,
  onRemove,
  className = "",
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  onRemove?: () => void;
  className?: string;
}) {
  const c = tagStyle(label);
  const style = active
    ? { backgroundColor: c.color, color: "var(--tag-active-ink)", borderColor: c.color }
    : c;
  const base =
    "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs leading-4";

  const removeBtn = onRemove ? (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      aria-label={`Remove tag ${label}`}
      className="-mr-0.5 ml-0.5 leading-none opacity-60 transition-opacity hover:opacity-100"
    >
      ×
    </button>
  ) : null;

  // Clickable AND removable: the container is a non-interactive span holding two
  // SIBLING buttons (the label toggle + the ✕). A <button> must never nest inside
  // another <button> — that's invalid HTML and triggers a hydration error.
  if (onClick && onRemove) {
    return (
      <span style={style} className={`${base} ${className}`}>
        <button
          type="button"
          onClick={onClick}
          aria-pressed={active}
          className="leading-4 transition-colors"
        >
          {label}
        </button>
        {removeBtn}
      </span>
    );
  }

  // Clickable only: the whole chip is the toggle (no nested interactive content).
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        style={style}
        className={`${base} transition-colors ${className}`}
      >
        <span>{label}</span>
      </button>
    );
  }

  // Static (optionally removable).
  return (
    <span style={style} className={`${base} ${className}`}>
      <span>{label}</span>
      {removeBtn}
    </span>
  );
}
