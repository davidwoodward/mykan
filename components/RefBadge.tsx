"use client";

import { createContext, useContext } from "react";
import { itemRef } from "@/lib/format";

/**
 * Carries the current project's short key down to wherever item references are
 * rendered (rows, cards, the modal) without threading it through every layer.
 */
const ProjectKeyContext = createContext<string | null>(null);
export const ProjectKeyProvider = ProjectKeyContext.Provider;

/** The reference badge for an item: muted monospace "AMOS-12" / "#12". */
export function RefBadge({
  number,
  className = "",
}: {
  number: number | null | undefined;
  className?: string;
}) {
  const key = useContext(ProjectKeyContext);
  const ref = itemRef(key, number);
  if (!ref) return null;
  return (
    <span
      className={`shrink-0 font-mono text-[11px] leading-none text-[var(--color-faint)] ${className}`}
      title={`Item ${ref}`}
    >
      {ref}
    </span>
  );
}
