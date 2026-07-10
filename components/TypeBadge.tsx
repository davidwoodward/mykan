import { TYPE_LABEL, type ItemType } from "@/lib/types";

const styles: Record<ItemType, string> = {
  feature:
    "text-[var(--color-feature)] bg-[var(--color-feature-bg)] ring-[var(--color-feature-line)]",
  bug: "text-[var(--color-bug)] bg-[var(--color-bug-bg)] ring-[var(--color-bug-line)]",
  task: "text-[var(--color-task)] bg-[var(--color-task-bg)] ring-[var(--color-task-line)]",
  idea: "text-[var(--color-idea)] bg-[var(--color-idea-bg)] ring-[var(--color-idea-line)]",
};

export function TypeBadge({ type, className = "" }: { type: ItemType; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium tracking-tight ring-1 ring-inset ${styles[type]} ${className}`}
    >
      {TYPE_LABEL[type]}
    </span>
  );
}
