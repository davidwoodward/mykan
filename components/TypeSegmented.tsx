"use client";

import { ITEM_TYPES, TYPE_LABEL, type ItemType } from "@/lib/types";

/** Inline segmented control for picking an item's type (feature/bug/idea). */
export function TypeSegmented({
  value,
  onChange,
}: {
  value: ItemType;
  onChange: (v: ItemType) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Item type"
      className="inline-flex rounded-md border border-[var(--color-line)] p-0.5 text-xs"
    >
      {ITEM_TYPES.map((t) => {
        const active = t === value;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(t)}
            className={`rounded px-2 py-1 transition-colors ${
              active
                ? "bg-[var(--color-ink)] text-[var(--color-canvas)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            {TYPE_LABEL[t]}
          </button>
        );
      })}
    </div>
  );
}
