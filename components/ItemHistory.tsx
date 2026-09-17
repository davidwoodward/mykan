"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
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
      {/* `title` shows promptly via the app-wide tooltip layer; `className` is on the wrapper. */}
      <span className={`inline-flex shrink-0 ${className}`}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={label ? `History for ${label}` : "History"}
          title="History"
          className="inline-flex shrink-0 items-center text-xs text-[var(--color-faint)] transition-colors hover:text-[var(--color-accent)]"
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
      </span>
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
  // Esc closes the panel, unless a restore is awaiting confirmation: then the
  // list's own Esc cancels just that confirmation.
  const confirmingRef = useRef(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented || confirmingRef.current) return;
      onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
          <HistoryList item={item} onItemChange={onItemChange} confirmingRef={confirmingRef} />
        </div>
      </div>
    </div>
  );
}

/**
 * The item's version history as a plain list, no overlay: the History popover
 * on rows/cards wraps it, and the card page (KANBAN-44) shows it inline in its
 * History section. Each entry is the state BEFORE a change; Restore (confirmed)
 * brings it back, itself recorded in history. Reloads whenever
 * `item.updated_at` moves, so a save on the card page shows up here.
 */
export function HistoryList({
  item,
  onItemChange,
  confirmingRef,
}: {
  item: Item;
  onItemChange: (item: Item) => void;
  /** Mirrors "a restore is awaiting confirmation", for an enclosing Esc handler. */
  confirmingRef?: MutableRefObject<boolean>;
}) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Version id whose Restore is awaiting its confirm click. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    if (confirmingRef) confirmingRef.current = confirming !== null;
  }, [confirming, confirmingRef]);

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
  }, [item.id, item.updated_at]);

  // Esc cancels a pending confirmation, and marks the key handled so nothing
  // underneath (the popover, the card page) also acts on it.
  useEffect(() => {
    if (confirming === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setConfirming(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming]);

  async function restore(versionId: string) {
    setRestoring(versionId);
    try {
      const res = await fetch(`/api/items/${item.id}/history`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version_id: versionId }),
      });
      if (!res.ok) throw new Error(`(${res.status})`);
      // The restored item carries a new updated_at, which reloads this list.
      onItemChange((await res.json()) as Item);
    } catch {
      setError("Restore failed");
    } finally {
      setRestoring(null);
      setConfirming(null);
    }
  }

  if (error) {
    return <p className="py-6 text-center text-sm text-[var(--color-bug)]">{error}</p>;
  }
  if (entries === null) {
    return <p className="py-6 text-center text-sm text-[var(--color-faint)]">Loading…</p>;
  }
  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-[var(--color-faint)]">
        No history yet — changes to this item will appear here.
      </p>
    );
  }
  return (
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
  );
}
