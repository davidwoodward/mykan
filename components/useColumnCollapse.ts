"use client";

import { useCallback, useSyncExternalStore } from "react";
import { type ItemStatus } from "@/lib/types";

/**
 * Per-viewer column-collapse state for the Board and status List.
 *
 * Collapsing a column is a *viewing* choice, not a project fact (mykan is a
 * shared pool), so it lives in localStorage, keyed globally per viewer — a
 * stable personal habit that follows you across every project. (Per-project
 * memory is a possible later refinement; the ticket leans global.)
 *
 * We store only explicit *overrides*, so a default can still apply to columns
 * the viewer has never touched: Done ships collapsed, everything else expanded.
 * Once you pop Done open it persists `done: false` and stays how you left it.
 *
 * Backed by useSyncExternalStore so the first client render matches the server
 * (defaults, i.e. Done collapsed) and then reconciles to the stored value with
 * no hydration mismatch — and so a change in one tab syncs to others.
 */
const STORAGE_KEY = "mykan:column-collapse";
const DEFAULT_COLLAPSED: Partial<Record<ItemStatus, boolean>> = { done: true };

type Overrides = Partial<Record<ItemStatus, boolean>>;

export interface ColumnCollapse {
  isCollapsed: (status: ItemStatus) => boolean;
  toggle: (status: ItemStatus) => void;
}

const EMPTY: Overrides = {};

// useSyncExternalStore loops if getSnapshot returns a fresh reference every
// call, so cache the parsed value and only re-parse when the raw string changes.
let cachedRaw: string | null = null;
let cachedValue: Overrides = EMPTY;

function readSnapshot(): Overrides {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return EMPTY; // private mode
  }
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    cachedValue = raw ? (JSON.parse(raw) as Overrides) : EMPTY;
  } catch {
    cachedValue = EMPTY; // corrupt JSON — fall back to defaults
  }
  return cachedValue;
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Cross-tab: another tab writing the key invalidates our cache and re-renders.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cachedRaw = null;
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export function useColumnCollapse(): ColumnCollapse {
  const overrides = useSyncExternalStore(subscribe, readSnapshot, () => EMPTY);

  const isCollapsed = useCallback(
    (status: ItemStatus) => overrides[status] ?? DEFAULT_COLLAPSED[status] ?? false,
    [overrides],
  );

  const toggle = useCallback((status: ItemStatus) => {
    const cur = readSnapshot();
    const curVal = cur[status] ?? DEFAULT_COLLAPSED[status] ?? false;
    const next: Overrides = { ...cur, [status]: !curVal };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* private mode — this session won't persist, but still re-render below */
    }
    // Same tab gets no `storage` event, so invalidate + notify our listeners.
    cachedRaw = null;
    for (const l of listeners) l();
  }, []);

  return { isCollapsed, toggle };
}
