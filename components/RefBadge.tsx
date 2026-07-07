"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { itemRef } from "@/lib/format";

/**
 * Carries the current project's short key down to wherever item references are
 * rendered (rows, cards, the modal) without threading it through every layer.
 */
const ProjectKeyContext = createContext<string | null>(null);
export const ProjectKeyProvider = ProjectKeyContext.Provider;

/**
 * The reference badge for an item: muted monospace "AMOS-12" / "#12".
 * Clicking it copies the reference to the clipboard, with a floating
 * "Copied" confirmation (overlay — no layout shift).
 */
export function RefBadge({
  number,
  className = "",
}: {
  number: number | null | undefined;
  className?: string;
}) {
  const key = useContext(ProjectKeyContext);
  const ref = itemRef(key, number);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!ref) return null;

  async function copy() {
    if (!ref) return;
    try {
      await navigator.clipboard.writeText(ref);
    } catch {
      return; // clipboard unavailable (permissions/insecure context) — no feedback
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={`relative shrink-0 cursor-pointer font-mono text-[11px] leading-none transition-colors ${
        copied
          ? "text-[var(--color-accent)]"
          : "text-[var(--color-faint)] hover:text-[var(--color-muted)]"
      } ${className}`}
      title={`Copy ${ref}`}
      aria-label={`Copy item reference ${ref}`}
    >
      {ref}
      {copied && (
        <span
          role="status"
          className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 py-1 text-[10px] font-sans text-[var(--color-muted)] shadow-sm"
        >
          Copied
        </span>
      )}
    </button>
  );
}
