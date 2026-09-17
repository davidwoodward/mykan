/**
 * A prompt tooltip for an icon button (David, 2026-09-17: the native `title`
 * takes a second or more to appear). Put it right after the button, inside a
 * `relative` wrapper, and give the button the `peer` class: the tip shows ~150ms
 * after hover and at once on keyboard focus. The button keeps its `aria-label`
 * (which may be longer, e.g. include the item text); never also set a native
 * `title` on it.
 */
export function IconTip({
  label,
  align = "right",
}: {
  label: string;
  /** Which edge of the button the tip lines up with. */
  align?: "left" | "right";
}) {
  return (
    <span
      role="presentation"
      aria-hidden="true"
      className={`pointer-events-none absolute top-full z-50 mt-1 whitespace-nowrap rounded bg-[var(--color-ink)] px-1.5 py-0.5 text-[11px] font-normal normal-case tracking-normal text-[var(--color-surface)] opacity-0 shadow transition-opacity duration-100 peer-hover:opacity-100 peer-hover:delay-150 peer-focus-visible:opacity-100 ${
        align === "right" ? "right-0" : "left-0"
      }`}
    >
      {label}
    </span>
  );
}
