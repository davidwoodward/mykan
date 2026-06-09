import Link from "next/link";

/**
 * The app wordmark: the kanban icon + "MyKan", linking home. Shown in the top
 * bar of every page. The mark is inlined (no network request) and matches the
 * favicon exactly.
 */
export function Brand() {
  return (
    <Link
      href="/"
      aria-label="MyKan — home"
      className="flex items-center gap-2 text-[var(--color-ink)] transition-opacity hover:opacity-80"
    >
      <BrandMark className="h-5 w-5 shrink-0" />
      <span className="text-base font-semibold tracking-tight">MyKan</span>
    </Link>
  );
}

function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#5b58d6" />
      <g fill="#ffffff">
        <rect x="5" y="7" width="6" height="8" rx="1.7" />
        <rect x="5" y="17" width="6" height="8" rx="1.7" />
        <rect x="13" y="7" width="6" height="12" rx="1.7" />
        <rect x="21" y="7" width="6" height="6" rx="1.7" />
        <rect x="21" y="15" width="6" height="10" rx="1.7" />
      </g>
    </svg>
  );
}
