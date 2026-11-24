"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * The card header's "Add to focus list" icon (KANBAN-82). Rendered only for a
 * person whose focus list is on (the page decides, server-side), so nobody
 * else sees it or any sign of anyone's list. Adds the card with its current
 * title as the entry's own title, which can then be reworded on the list
 * without touching the card. Once on the list it becomes a filled icon that
 * opens Home, where the list is.
 */
export function FocusPushButton({ cardRef, initialOnList }: { cardRef: string; initialOnList: boolean }) {
  const [onList, setOnList] = useState(initialOnList);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cls =
    "grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-[var(--color-accent-soft)]";

  if (onList) {
    return (
      <Link
        href="/"
        title="On your focus list (open it)"
        aria-label={`${cardRef} is on your focus list; open the list`}
        className={`${cls} text-[var(--color-accent)]`}
      >
        <TargetIcon filled />
      </Link>
    );
  }

  async function push() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/focus", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item: cardRef }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok || res.status === 409 && /already on your focus list/.test((d as { error?: string }).error ?? "")) {
        setOnList(true);
      } else {
        setError((d as { error?: string }).error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => void push()}
        title="Add to your focus list"
        aria-label={`Add ${cardRef} to your focus list`}
        className={`${cls} text-[var(--color-muted)] hover:text-[var(--color-accent-ink)] disabled:opacity-50`}
      >
        <TargetIcon />
      </button>
      {error ? (
        <span role="alert" className="max-w-[16rem] text-[11px] leading-snug text-[var(--color-bug)]">
          {error}
        </span>
      ) : null}
    </span>
  );
}

function TargetIcon({ filled = false }: { filled?: boolean }) {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1.2" fill={filled ? "currentColor" : "none"} />
      {filled ? <circle cx="12" cy="12" r="4.5" fill="currentColor" fillOpacity="0.25" /> : null}
    </svg>
  );
}
