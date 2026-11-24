"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FocusList, TypeLetter } from "@/components/FocusList";
import { TargetIcon } from "@/components/FocusPushButton";
import { describeReason, entryTitle, type FocusEntryView, type ReviewReason } from "@/lib/focus-rules";
import { onFocusChange } from "@/lib/focus-events";

/**
 * The focus peek (KANBAN-84): a target in the top bar of every page, rendered
 * only for someone whose focus list is on (the page decides, server-side).
 *
 * - Hover (mouse or pen) or keyboard focus shows the list read-only in its
 *   compact one-line form, with the review line and "N of MAX".
 * - Click, Enter/Space or a tap opens the full FocusList in an overlay over the
 *   current page: no navigation, so the URL, filters and scroll stay put. Esc,
 *   the close button or a press outside closes it.
 * - The badge is the entry count, with an accent dot when a review is due.
 *
 * Changes made in the overlay are announced (lib/focus-events), so row targets
 * on the page underneath and the Home list follow.
 */

type Peek = { entries: FocusEntryView[]; max: number; reasons: ReviewReason[] };

const HOVER_DELAY_MS = 150; // the app tooltip's delay (lib/tooltip-layer.ts)

export function FocusPeek() {
  const source = useId();
  const popId = `${source}-peek`;
  const [peek, setPeek] = useState<Peek | null>(null);
  const [showPeek, setShowPeek] = useState(false);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/focus");
      if (!res.ok) return;
      const d = (await res.json()) as
        | { enabled: true; entries: FocusEntryView[]; settings: { max_entries: number }; reasons: ReviewReason[] }
        | { enabled: false };
      setPeek(d.enabled ? { entries: d.entries, max: d.settings.max_entries, reasons: d.reasons } : null);
    } catch {
      // Keep what we had; the next change or hover tries again.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/focus")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d?.enabled) return;
        setPeek({ entries: d.entries, max: d.settings.max_entries, reasons: d.reasons });
      })
      .catch(() => {});
    const off = onFocusChange(source, () => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, [source, load]);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => clearTimer, []);

  function hoverIn(e: React.PointerEvent) {
    if (e.pointerType === "touch" || open) return;
    clearTimer();
    timer.current = setTimeout(() => {
      setShowPeek(true);
      void load(); // fresh when you look, in case another tab changed it
    }, HOVER_DELAY_MS);
  }
  function hoverOut() {
    clearTimer();
    setShowPeek(false);
  }

  function openOverlay() {
    clearTimer();
    setShowPeek(false);
    setOpen(true);
  }
  const closeOverlay = useCallback(() => {
    setOpen(false);
    btnRef.current?.focus({ preventScroll: true });
  }, []);

  const count = peek?.entries.length ?? null;
  const due = !!peek?.reasons.length;
  const label =
    count === null
      ? "Focus list"
      : `Focus list: ${count} of ${peek!.max}${due ? ", review due" : ""}. Open it over this page`;

  return (
    <span className="relative inline-flex">
      <button
        ref={btnRef}
        type="button"
        onClick={openOverlay}
        onPointerEnter={hoverIn}
        onPointerLeave={hoverOut}
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible") && !open) setShowPeek(true);
        }}
        onBlur={() => setShowPeek(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && showPeek) {
            e.preventDefault();
            setShowPeek(false);
          }
        }}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={showPeek ? popId : undefined}
        className="relative grid h-8 w-8 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-ink)]"
      >
        <TargetIcon filled={!!count} />
        {count ? (
          <span
            aria-hidden="true"
            className="absolute -bottom-0.5 -right-1 min-w-[15px] rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-1 text-center text-[9px] font-semibold leading-[13px] text-[var(--color-ink)] tabular-nums"
          >
            {count}
          </span>
        ) : null}
        {due ? (
          <span
            aria-hidden="true"
            className="absolute right-0 top-0 h-2 w-2 rounded-full border border-[var(--color-canvas)] bg-[var(--color-accent)]"
          />
        ) : null}
      </button>

      {showPeek && !open ? <PeekPopover id={popId} peek={peek} /> : null}
      {open ? <FocusOverlay onClose={closeOverlay} /> : null}
    </span>
  );
}

/** The read-only hover preview: one compact line per entry. */
function PeekPopover({ id, peek }: { id: string; peek: Peek | null }) {
  return (
    <div
      id={id}
      role="tooltip"
      className="pointer-events-none absolute right-0 top-full z-40 mt-2 w-[min(92vw,26rem)] rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-2 text-sm shadow-lg"
    >
      {!peek ? (
        <p className="px-1 py-1 text-xs text-[var(--color-faint)]">Loading your focus list…</p>
      ) : (
        <>
          <div className="mb-1 flex items-baseline gap-2 px-1">
            <span className="text-xs font-medium text-[var(--color-muted)]">Focus</span>
            <span className="text-[11px] text-[var(--color-faint)]">
              {peek.entries.length} of {peek.max}
            </span>
            <span className="ml-auto text-[10px] text-[var(--color-faint)]">Click to open</span>
          </div>
          {peek.reasons.length ? (
            <p className="mb-1 rounded bg-[var(--color-accent-soft)] px-1.5 py-1 text-[11px] text-[var(--color-accent-ink)]">
              Review due: {peek.reasons.map(describeReason).join(" · ")}
            </p>
          ) : null}
          {peek.entries.length === 0 ? (
            <p className="px-1 py-1 text-xs text-[var(--color-faint)]">Nothing on your focus list yet.</p>
          ) : (
            <ol>
              {peek.entries.map((e, i) => (
                <li key={e.id} className="flex items-baseline gap-2 px-1 py-0.5">
                  <span className="w-4 shrink-0 text-right text-xs font-semibold tabular-nums text-[var(--color-accent)]">
                    {i + 1}
                  </span>
                  <TypeLetter e={e} />
                  {e.visible ? (
                    <>
                      <span className="shrink-0 font-mono text-[11px] text-[var(--color-faint)]">{e.ref}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-ink)]">
                        {entryTitle(e) ?? ""}
                      </span>
                    </>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-[13px] italic text-[var(--color-faint)]">No access</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The full list over the current page. A portal on <body>, so it sits above
 * the sticky header and every scroll region; the page underneath is never
 * touched. aria-modal marks it so page-level shortcuts (the board's j/k, "/")
 * ignore keys typed inside it.
 */
function FocusOverlay({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    // Window, bubble phase: runs after the list's own handlers (an inline
    // edit, the add box, a keyboard drag), which claim their Esc with
    // preventDefault.
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-2 pb-2 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] sm:px-4 sm:pt-[8vh]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Focus list"
        tabIndex={-1}
        className="relative max-h-[calc(100dvh-1rem)] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-xl border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 pb-6 pt-3 shadow-2xl outline-none sm:max-h-[84dvh] sm:px-4"
      >
        <button
          type="button"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close the focus list"
          className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-ink)]"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
        <FocusList className="" />
      </div>
    </div>,
    document.body,
  );
}
