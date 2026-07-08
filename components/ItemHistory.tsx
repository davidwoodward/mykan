"use client";

import { useEffect, useState } from "react";
import { displayName, timeAgo } from "@/lib/format";
import type { Item } from "@/lib/types";

/** Mirrors HistoryEntry in app/api/items/[id]/history/route.ts. */
type HistoryEntry = {
  id: string;
  created_at: string;
  created_by: string | null;
  source: "web" | "mcp" | "telegram" | "recovery";
  changes: string[];
  body_text: string;
};

/**
 * Inline history affordance for list rows and board cards: a clock icon that
 * opens the item's version history in an overlay. Each entry is the state
 * BEFORE a change; Restore brings that state back (itself recorded in history,
 * so restoring is reversible).
 */
export function ItemHistory({
  item,
  onItemChange,
  label,
  className = "",
}: {
  item: Item;
  onItemChange: (item: Item) => void;
  /** Item text, woven into the accessible name. */
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="History"
        aria-label={label ? `History for ${label}` : "History"}
        className={`inline-flex shrink-0 items-center text-xs text-[var(--color-faint)] transition-colors hover:text-[var(--color-accent)] ${className}`}
      >
        <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M12 7.5V12l3 2"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <HistoryPanel
          item={item}
          onClose={() => setOpen(false)}
          onItemChange={onItemChange}
        />
      ) : null}
    </>
  );
}

function HistoryPanel({
  item,
  onClose,
  onItemChange,
}: {
  item: Item;
  onClose: () => void;
  onItemChange: (item: Item) => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Version id whose Restore is awaiting its confirm click. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  /** Bumped after a restore to refetch the list. */
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/items/${item.id}/history`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`(${res.status})`);
        const data = (await res.json()) as HistoryEntry[];
        if (!cancelled) {
          setEntries(data);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't load history");
      });
    return () => {
      cancelled = true;
    };
  }, [item.id, reloadKey]);

  // Close on Escape (a pending confirm is cancelled first).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setConfirming((c) => {
        if (c === null) onClose();
        return null;
      });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function restore(versionId: string) {
    setRestoring(versionId);
    try {
      const res = await fetch(`/api/items/${item.id}/history`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version_id: versionId }),
      });
      if (!res.ok) throw new Error(`(${res.status})`);
      onItemChange((await res.json()) as Item);
      setReloadKey((k) => k + 1);
    } catch {
      setError("Restore failed");
    } finally {
      setRestoring(null);
      setConfirming(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[10vh]"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-[var(--color-line)] px-4 py-2.5">
          <h2 className="text-sm font-medium text-[var(--color-ink)]">History</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded p-1 text-[var(--color-faint)] transition-colors hover:text-[var(--color-ink)]"
          >
            ✕
          </button>
        </header>

        <div className="max-h-[65vh] overflow-y-auto px-4 py-2">
          {error ? (
            <p className="py-6 text-center text-sm text-[var(--color-bug)]">{error}</p>
          ) : entries === null ? (
            <p className="py-6 text-center text-sm text-[var(--color-faint)]">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--color-faint)]">
              No history yet — changes to this item will appear here.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)]">
              {entries.map((e) => (
                <li key={e.id} className="flex items-start gap-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="text-[var(--color-ink)]">
                      <span className="font-medium">{displayName(e.created_by)}</span>{" "}
                      <span className="text-[var(--color-muted)]">
                        {e.changes.join(" · ")}
                      </span>
                    </p>
                    {e.changes.includes("body edited") && e.body_text ? (
                      <p
                        className="mt-0.5 overflow-hidden whitespace-pre-wrap break-words text-xs leading-5 text-[var(--color-faint)]"
                        style={{
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                        }}
                        title="The body as it was before this change"
                      >
                        {e.body_text}
                      </p>
                    ) : null}
                    <p className="mt-0.5 text-xs text-[var(--color-faint)]">
                      <span title={new Date(e.created_at).toLocaleString()}>
                        {timeAgo(e.created_at)}
                      </span>
                      {e.source !== "web" ? (
                        <span className="ml-2 font-mono text-[10px] uppercase tracking-wider">
                          {e.source}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  {confirming === e.id ? (
                    <span className="flex shrink-0 items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => void restore(e.id)}
                        disabled={restoring !== null}
                        className="font-medium text-[var(--color-accent)] transition-opacity hover:opacity-70 disabled:opacity-50"
                      >
                        {restoring === e.id ? "Restoring…" : "Confirm restore"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        disabled={restoring !== null}
                        className="text-[var(--color-faint)] transition-colors hover:text-[var(--color-ink)]"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirming(e.id)}
                      title="Restore the item to how it was before this change"
                      aria-label="Restore this version"
                      className="shrink-0 text-xs text-[var(--color-faint)] transition-colors hover:text-[var(--color-accent)]"
                    >
                      Restore
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
