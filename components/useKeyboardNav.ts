"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Per-viewer toggle for the keyboard-forward navigation (the vim-style board /
 * list selection: j/k, g/G/0, u/d, Ctrl-f/Ctrl-b, and the selection cursor).
 *
 * These power-user shortcuts confuse newcomers, so they ship OFF by default and
 * are only ON where the app tells us to default them on — the owner (see
 * `isOwner`), passed in as `defaultOn`. That default follows the *identity*, so
 * the owner gets keyboard nav on every device with nothing stored; a novice
 * never gets it unless they flip it on.
 *
 * We persist only an explicit *override* (`on` / `off`) in localStorage; absence
 * means "use the default". Mirrors useColumnCollapse: backed by
 * useSyncExternalStore so the first client render matches the server (the
 * default, which is deterministic per identity) and then reconciles to any
 * stored override with no hydration mismatch — and so a change in one tab syncs
 * to others and to the header's profile menu.
 */
const STORAGE_KEY = "mykan:keyboard-nav";

// null = no explicit override (fall back to the default); true/false = a choice.
function parse(raw: string | null): boolean | null {
  if (raw === "on") return true;
  if (raw === "off") return false;
  return null;
}

// useSyncExternalStore loops if getSnapshot returns a fresh value each call, so
// cache and only re-read when the raw string changes. `undefined` = not yet read.
let cachedRaw: string | null | undefined = undefined;
let cachedValue: boolean | null = null;

function readOverride(): boolean | null {
  if (typeof window === "undefined") return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private mode
  }
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  cachedValue = parse(raw);
  return cachedValue;
}

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Cross-tab: another tab writing the key invalidates our cache and re-renders.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      cachedRaw = undefined;
      cb();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

export interface KeyboardNav {
  /** Whether keyboard-forward navigation is active for this viewer. */
  enabled: boolean;
  /** Persist an explicit choice (survives across the default). */
  setEnabled: (on: boolean) => void;
}

export function useKeyboardNav(defaultOn: boolean): KeyboardNav {
  const override = useSyncExternalStore(subscribe, readOverride, () => null);
  const enabled = override ?? defaultOn;

  const setEnabled = useCallback((on: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    } catch {
      /* private mode — this session won't persist, but still re-render below */
    }
    // Same tab gets no `storage` event, so invalidate + notify our listeners.
    cachedRaw = undefined;
    for (const l of listeners) l();
  }, []);

  return { enabled, setEnabled };
}
