import { localPart, timeAgo } from "@/lib/format";

export function Byline({
  createdBy,
  updatedBy,
  updatedAt,
  className = "",
}: {
  createdBy: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
  className?: string;
}) {
  const author = localPart(createdBy);
  const editor = updatedBy && updatedBy !== createdBy ? localPart(updatedBy) : null;
  const when = timeAgo(updatedAt);
  if (!createdBy && !when) return null;
  return (
    <span className={`text-[10px] leading-none text-[var(--color-faint)] ${className}`}>
      {author}
      {editor ? <> · edited by {editor}</> : null}
      {when ? <> · {when}</> : null}
    </span>
  );
}
