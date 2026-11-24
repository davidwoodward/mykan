"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from "react";
import { announceFocusChange, onFocusChange } from "@/lib/focus-events";
import { itemRef } from "@/lib/format";
import { useProjectKey } from "@/components/RefBadge";
import { TargetIcon } from "@/components/FocusPushButton";

/**
 * The focus target on list rows and board cards (KANBAN-83). The board page
 * mounts FocusRowProvider only when the viewer's own focus list is on (decided
 * server-side), so for anyone else the context is null and no row renders a
 * target. The provider loads which of the viewer's cards are already on their
 * list, once, from their own /api/focus/ids.
 */
type Ctx = { onList: Set<string>; add: (itemId: string, ref: string) => Promise<string | null> };
const FocusRowContext = createContext<Ctx | null>(null);

export function FocusRowProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const [onList, setOnList] = useState<Set<string>>(() => new Set());
  const source = useId();

  // Load once, and again whenever the list changes elsewhere on the page (the
  // top-bar overlay, KANBAN-84), so a dropped or added card's target follows.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () =>
      fetch("/api/focus/ids")
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { item_ids?: string[] } | null) => {
          if (!cancelled && d) setOnList(new Set(d.item_ids ?? []));
        })
        .catch(() => {});
    void load();
    const off = onFocusChange(source, () => void load());
    return () => {
      cancelled = true;
      off();
    };
  }, [enabled, source]);

  const add = useCallback(async (itemId: string, ref: string): Promise<string | null> => {
    const res = await fetch("/api/focus", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item: ref }),
    });
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.ok || /already on your focus list/.test(d.error ?? "")) {
      setOnList((s) => new Set(s).add(itemId));
      announceFocusChange(source);
      return null;
    }
    return d.error ?? `HTTP ${res.status}`;
  }, [source]);

  const value = useMemo(() => (enabled ? { onList, add } : null), [enabled, onList, add]);
  return <FocusRowContext.Provider value={value}>{children}</FocusRowContext.Provider>;
}

/**
 * The row's target icon: outline = "Add to your focus list"; filled = already
 * on it (a link to Home). Renders nothing when the viewer's list is off.
 * `className` places it (e.g. hover-only at sm+); the filled state always shows.
 */
export function FocusRowTarget({
  itemId,
  number,
  className = "",
}: {
  itemId: string;
  number: number;
  className?: string;
}) {
  const ctx = useContext(FocusRowContext);
  const key = useProjectKey();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = itemRef(key, number);
  if (!ctx || !ref) return null;

  const base =
    "grid h-6 w-6 shrink-0 place-items-center rounded transition-colors hover:bg-[var(--color-accent-soft)]";

  if (ctx.onList.has(itemId)) {
    return (
      <Link
        href="/"
        title="On your focus list"
        aria-label={`${ref} is on your focus list; open the list`}
        onClick={(e) => e.stopPropagation()}
        className={`${base} self-center text-[var(--color-accent)]`}
      >
        <TargetIcon filled small />
      </Link>
    );
  }

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        setError(await ctx.add(itemId, ref));
        setBusy(false);
      }}
      title={error ?? "Add to your focus list"}
      aria-label={`Add ${ref} to your focus list`}
      className={`${base} ${error ? "text-[var(--color-bug)]" : "text-[var(--color-faint)] hover:text-[var(--color-accent-ink)]"} disabled:opacity-50 ${className}`}
    >
      <TargetIcon small />
    </button>
  );
}
