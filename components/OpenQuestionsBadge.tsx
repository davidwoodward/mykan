"use client";

import { createContext, useContext } from "react";
import { openQuestionsLabel } from "@/lib/entry-panels";

/**
 * Open questions per item id (KANBAN-38), from the board's items fetch. Held in
 * its own state rather than on each Item, because the many item PATCH
 * responses that replace rows on the board don't carry the count.
 */
const OpenQuestionsContext = createContext<Record<string, number>>({});

export const OpenQuestionsProvider = OpenQuestionsContext.Provider;

/** Pull the per-row counts the items API adds into a map (absent = 0). */
export function openQuestionCounts(rows: { id: string; open_questions?: number }[]) {
  const out: Record<string, number> = {};
  for (const r of rows) if (r.open_questions) out[r.id] = r.open_questions;
  return out;
}

/**
 * "N open questions" on a board card / list row: what's waiting on David,
 * visible without opening the card. Hidden at 0. Display only (not a button),
 * so pressing it selects the card like any other part of it.
 */
export function OpenQuestionsBadge({ itemId, className = "" }: { itemId: string; className?: string }) {
  const n = useContext(OpenQuestionsContext)[itemId] ?? 0;
  if (n <= 0) return null;
  const label = openQuestionsLabel(n);
  return (
    <span
      title={`${label} waiting for an answer`}
      aria-label={label}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-accent-soft)] px-1.5 py-px text-[11px] font-medium tabular-nums text-[var(--color-accent-ink)] ${className}`}
    >
      <svg
        className="h-3 w-3"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.3-2.5 3.9" />
        <path d="M12 17h.01" />
      </svg>
      {label}
    </span>
  );
}
