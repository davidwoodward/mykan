import { localPart, timeAgo } from "@/lib/format";

export function Byline({
  createdBy,
  updatedBy,
  updatedAt,
  onCreatorClick,
  activeCreator,
  className = "",
}: {
  createdBy: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
  onCreatorClick?: (email: string) => void;
  activeCreator?: string | null;
  className?: string;
}) {
  const author = localPart(createdBy);
  const editor = updatedBy && updatedBy !== createdBy ? localPart(updatedBy) : null;
  const when = timeAgo(updatedAt);
  if (!createdBy && !when) return null;

  const isActive = !!createdBy && activeCreator === createdBy;
  const name =
    onCreatorClick && createdBy ? (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onCreatorClick(createdBy);
        }}
        title={isActive ? "Clear filter" : `Filter by ${author}`}
        className={`rounded transition-colors hover:underline ${
          isActive
            ? "font-medium text-[var(--color-accent-ink)]"
            : "hover:text-[var(--color-ink)]"
        }`}
      >
        {author}
      </button>
    ) : (
      <span className={isActive ? "font-medium text-[var(--color-accent-ink)]" : ""}>
        {author}
      </span>
    );

  return (
    <span className={`text-[10px] leading-none text-[var(--color-faint)] ${className}`}>
      {name}
      {editor ? <> · edited by {editor}</> : null}
      {when ? <> · {when}</> : null}
    </span>
  );
}
