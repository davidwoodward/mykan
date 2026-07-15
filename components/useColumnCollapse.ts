"use client";

import { useCallback, useSyncExternalStore } from "react";
import { type ItemStatus } from "@/lib/types";

/**
 * Per-viewer, per-project column-collapse state for the Board and status List.
 *
 * Collapsing a column is a *viewing* choice, not a project fact (mykan is a
 * shared pool), so it lives in localStorage. It's keyed per project — how you
 * like Amos laid out isn't how you like Kanban laid out — under
 * `mykan:column-collapse:<projectId>`. On first visit to a project with nothing
 * stored yet, we fall back to the pre-per-project global key
 * (`mykan:column-collapse`) so an existing habit carries over once instead of
 * snapping back to defaults; the first toggle then writes the project's own key
 * and the two diverge from there.
 *
 * We store only explicit *overrides*, so a default can still apply to columns
 * the viewer has never touched: Done ships collapsed, everything else expanded.
 * Once you pop Done open it persists `done: false` and stays how you left it.
 *
 * Backed by useSyncExternalStore so the first client render matches the server
 * (defaults, i.e. Done collapsed) and then reconciles to the stored value with
 * no hydration mismatch — and so a change in one tab syncs to others.
 */
const KEY_PREFIX = "mykan:column-collapse";
// The pre-per-project global key, read only as a first-visit fallback.
const LEGACY_KEY = KEY_PREFIX;
const DEFAULT_COLLAPSED: Partial<Record<ItemStatus, boolean>> = { done: true };

type Overrides = Partial<Record<ItemStatus, boolean>>;

export interface ColumnCollapse {
  isCollapsed: (status: ItemStatus) => boolean;
  toggle: (status: ItemStatus) => void;
}

const EMPTY: Overrides = {};

function keyFor(projectId: string): string {
  return `${KEY_PREFIX}:${projectId}`;
}

function rawOf(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode
  }
}

// useSyncExternalStore loops if getSnapshot returns a fresh reference every
// call, so cache the parsed value per key and only re-parse when the raw string
// changes. Returning the cached object keeps the reference stable.
const parsed = new Map<string, { raw: string; val: Overrides }>();

function parseCached(key: string, raw: string): Overrides {
  const c = parsed.get(key);
  if (c && c.raw === raw) return c.val;
  let val: Overrides;
  try {
    val = raw ? (JSON.parse(raw) as Overrides) : EMPTY;
  } catch {
    val = EMPTY; // corrupt JSON — fall back to defaults
  }
  parsed.set(key, { raw, val });
  return val;
}

function readSnapshot(projectId: string): Overrides {
  if (typeof window === "undefined") return EMPTY;
  const own = rawOf(keyFor(projectId));
  if (own !== null) return parseCached(keyFor(projectId), own);
  // First visit to this project: inherit the old global habit once (read-only).
  const legacy = rawOf(LEGACY_KEY);
  if (legacy !== null) return parseCached(LEGACY_KEY, legacy);
  return EMPTY;
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Cross-tab: another tab writing any collapse key invalidates our cache for
  // that key and re-renders. getSnapshot re-reads the right key per project.
  const onStorage = (e: StorageEvent) => {
    if (e.key && e.key.startsWith(KEY_PREFIX)) {
      parsed.delete(e.key);
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function toggleStatus(projectId: string, status: ItemStatus): void {
  const cur = readSnapshot(projectId); // includes the first-visit legacy fallback
  const curVal = cur[status] ?? DEFAULT_COLLAPSED[status] ?? false;
  const next: Overrides = { ...cur, [status]: !curVal };
  const key = keyFor(projectId);
  try {
    // The first write captures the inherited state into the project's own key,
    // then this project diverges from the global default going forward.
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* private mode — this session won't persist, but still re-render below */
  }
  // Same tab gets no `storage` event, so invalidate + notify our listeners.
  parsed.delete(key);
  for (const l of listeners) l();
}

export function useColumnCollapse(projectId: string): ColumnCollapse {
  const overrides = useSyncExternalStore(
    subscribe,
    () => readSnapshot(projectId),
    () => EMPTY,
  );

  const isCollapsed = useCallback(
    (status: ItemStatus) => overrides[status] ?? DEFAULT_COLLAPSED[status] ?? false,
    [overrides],
  );

  const toggle = useCallback(
    (status: ItemStatus) => toggleStatus(projectId, status),
    [projectId],
  );

  return { isCollapsed, toggle };
}
