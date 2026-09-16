// Save on finish, abandon for free (KANBAN-42, David 2026-09-16). Pure — no
// DB, no React — so every decision here runs under `node --test`. The React
// wiring lives in components/useAbandonable.ts and components/AbandonButton.tsx.
//
// The model:
//  - While editing, nothing is written to the card. Changes live in a local
//    draft (in memory, mirrored to browser storage for crash safety).
//  - Finishing (Esc, click-off, ✕, leaving) sends ONE save with only the fields
//    that differ from how they were when the editor opened. No difference, no
//    write. A failed save keeps the draft and keeps the editor open.
//  - Abandon drops the draft and closes. No write, no history entry.
//  - A draft left behind (crash, closed tab whose last save didn't land) is
//    offered back the next time the editor opens, flagged as stale when the
//    stored value has moved on since the draft started.

/** Per-field equality. */
export type EqualFn = (key: string, a: unknown, b: unknown) => boolean;

/** Structural equality (null and undefined are the same "empty"). */
export const jsonEqual: EqualFn = (_key, a, b) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The fields of `current` that differ from `opened`, or null when none do. */
export function dirtyPatch<T extends Record<string, unknown>>(
  opened: T,
  current: T,
  equal: EqualFn = jsonEqual,
): Partial<T> | null {
  const patch: Partial<T> = {};
  let any = false;
  for (const key of Object.keys(opened) as (keyof T & string)[]) {
    if (!equal(key, current[key], opened[key])) {
      patch[key] = current[key];
      any = true;
    }
  }
  return any ? patch : null;
}

// ---------------------------------------------------------------------------
// Draft storage (browser storage, keyed per editor scope, id and field)
// ---------------------------------------------------------------------------

/** The storage an editor mirrors its draft to. Every method must not throw. */
export type DraftStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
};

/**
 * localStorage, with every access wrapped: private windows, blocked site data
 * and quota errors make it throw, and then the draft simply isn't persisted
 * (the in-memory draft and the save on close still work).
 */
export function browserDraftStore(): DraftStore {
  const ls = (): Storage | null => {
    try {
      return typeof window === "undefined" ? null : window.localStorage;
    } catch {
      return null;
    }
  };
  return {
    get(key) {
      try {
        return ls()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        ls()?.setItem(key, value);
      } catch {
        // Not persisted; the in-memory draft still holds the text.
      }
    },
    remove(key) {
      try {
        ls()?.removeItem(key);
      } catch {
        // Nothing to do.
      }
    },
  };
}

/** An in-memory DraftStore (tests, and anywhere storage is unavailable). */
export function memoryDraftStore(): DraftStore & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

/** Storage key for one field of one editor, e.g. `mykan:draft:v1:item:<id>:body`. */
export function draftKey(scope: string, id: string, field: string): string {
  return `mykan:draft:v1:${scope}:${id}:${field}`;
}

/** One persisted field draft. */
export type FieldDraft = {
  /** The draft value. */
  value: unknown;
  /** The stored value when the draft started (what it was edited from). */
  base: unknown;
  /**
   * The item's updated_at when the draft started. Informational only (kept for
   * debugging a report): staleness is decided per field from `base`.
   */
  baseUpdatedAt: string | null;
  /** When the draft started (ISO). */
  startedAt: string;
};

/** Read a field draft; absent, unreadable or malformed → null. */
export function readFieldDraft(store: DraftStore, key: string): FieldDraft | null {
  const raw = store.get(key);
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as Partial<FieldDraft> | null;
    if (!d || typeof d !== "object" || !("value" in d) || typeof d.startedAt !== "string") {
      return null;
    }
    return {
      value: d.value,
      base: d.base ?? null,
      baseUpdatedAt: typeof d.baseUpdatedAt === "string" ? d.baseUpdatedAt : null,
      startedAt: d.startedAt,
    };
  } catch {
    return null;
  }
}

export type RestoreDecision<T> =
  /** No draft for this editor. */
  | { kind: "none" }
  /** Drafts exist but match what's stored (their save landed): forget them. */
  | { kind: "clear" }
  /** A draft differs from what's stored: offer Restore / Discard. */
  | {
      kind: "offer";
      values: Partial<T>;
      /** True when a drafted field's stored value changed since the draft began. */
      stale: boolean;
      /** Those fields. */
      staleFields: (keyof T & string)[];
      /** The earliest start among the offered drafts. */
      startedAt: string;
    };

/**
 * What to do with leftover drafts when an editor opens over `stored`.
 *
 * A field draft is only worth offering when its value differs from the stored
 * value (otherwise its save landed, e.g. the best-effort save on tab close).
 * It is stale when the stored value is no longer the one the draft was edited
 * from, i.e. the card changed on the server since (another tab, MCP): restoring
 * would overwrite that newer value on the next save, so the prompt says so.
 * Compared per field rather than by updated_at, which also moves on status or
 * position changes that a body draft doesn't touch.
 */
export function restoreDecision<T extends Record<string, unknown>>(
  drafts: Partial<Record<keyof T & string, FieldDraft | null>>,
  stored: T,
  equal: EqualFn = jsonEqual,
): RestoreDecision<T> {
  const values: Partial<T> = {};
  const staleFields: (keyof T & string)[] = [];
  let found = false;
  let offered = false;
  let startedAt: string | null = null;
  for (const key of Object.keys(stored) as (keyof T & string)[]) {
    const d = drafts[key];
    if (!d) continue;
    found = true;
    if (equal(key, d.value, stored[key])) continue;
    offered = true;
    values[key] = d.value as T[typeof key];
    if (!equal(key, d.base, stored[key])) staleFields.push(key);
    if (!startedAt || d.startedAt < startedAt) startedAt = d.startedAt;
  }
  if (offered) {
    return {
      kind: "offer",
      values,
      stale: staleFields.length > 0,
      staleFields,
      startedAt: startedAt!,
    };
  }
  return found ? { kind: "clear" } : { kind: "none" };
}

// ---------------------------------------------------------------------------
// The draft session: one editor open
// ---------------------------------------------------------------------------

export type CloseOutcome<T> =
  /** Nothing differed from the as-opened values: no write. */
  | { kind: "unchanged" }
  /** One save, with exactly these fields. */
  | { kind: "saved"; patch: Partial<T> }
  /** The save failed: the draft is kept and the editor should stay open. */
  | { kind: "failed"; error: string };

export type DraftSession<T extends Record<string, unknown>> = {
  /** The as-opened values (advanced to what was saved after a successful save). */
  readonly opened: Readonly<T>;
  /** The current draft values. */
  readonly values: Readonly<T>;
  /** True while the draft differs from `opened`. */
  readonly dirty: boolean;
  /** Change one field of the draft (mirrored to the store). */
  set<K extends keyof T & string>(key: K, value: T[K]): void;
  /** Replace draft fields at once (Restore a leftover draft). */
  restore(values: Partial<T>): void;
  /** The save a close would send now, or null. Doesn't change anything. */
  patch(): Partial<T> | null;
  /**
   * Finish: send ONE save with the changed fields via `save`, or nothing when
   * unchanged. On success the stored draft is cleared; on failure it's kept.
   * Concurrent calls (Esc then click-off) share the one in-flight save.
   */
  close(save: (patch: Partial<T>) => Promise<void>): Promise<CloseOutcome<T>>;
  /** Abandon: drop the draft (memory and store). Never writes. */
  abandon(): void;
  /** Forget leftover stored drafts for every field (Discard in the prompt). */
  clearStored(): void;
};

export function createDraftSession<T extends Record<string, unknown>>({
  opened,
  store,
  keyOf,
  equal = jsonEqual,
  baseUpdatedAt = null,
  now = () => new Date().toISOString(),
}: {
  opened: T;
  store: DraftStore;
  /** Storage key for a field. */
  keyOf: (field: keyof T & string) => string;
  equal?: EqualFn;
  /** The item's updated_at at open, recorded with each draft. */
  baseUpdatedAt?: string | null;
  now?: () => string;
}): DraftSession<T> {
  let base: T = { ...opened };
  let current: T = { ...opened };
  const fields = Object.keys(opened) as (keyof T & string)[];
  const startedAt = new Map<string, string>();
  let closing: Promise<CloseOutcome<T>> | null = null;

  function persist(key: keyof T & string) {
    if (equal(key, current[key], base[key])) {
      store.remove(keyOf(key));
      startedAt.delete(key);
      return;
    }
    if (!startedAt.has(key)) startedAt.set(key, now());
    const d: FieldDraft = {
      value: current[key],
      base: base[key],
      baseUpdatedAt,
      startedAt: startedAt.get(key)!,
    };
    store.set(keyOf(key), JSON.stringify(d));
  }

  function clearStored() {
    for (const key of fields) store.remove(keyOf(key));
    startedAt.clear();
  }

  return {
    get opened() {
      return base;
    },
    get values() {
      return current;
    },
    get dirty() {
      return dirtyPatch(base, current, equal) !== null;
    },
    set(key, value) {
      current = { ...current, [key]: value };
      persist(key);
    },
    restore(values) {
      current = { ...current, ...values };
      for (const key of Object.keys(values) as (keyof T & string)[]) {
        if (fields.includes(key)) persist(key);
      }
    },
    patch() {
      return dirtyPatch(base, current, equal);
    },
    close(save) {
      if (closing) return closing;
      const patch = dirtyPatch(base, current, equal);
      if (!patch) {
        clearStored();
        return Promise.resolve({ kind: "unchanged" });
      }
      closing = (async (): Promise<CloseOutcome<T>> => {
        try {
          await save(patch);
        } catch (e) {
          return { kind: "failed", error: e instanceof Error ? e.message : "Save failed" };
        } finally {
          closing = null;
        }
        base = { ...base, ...patch };
        // Clear only fields the save covered and that haven't moved on since.
        for (const key of Object.keys(patch) as (keyof T & string)[]) persist(key);
        return { kind: "saved", patch };
      })();
      return closing;
    },
    abandon() {
      current = { ...base };
      clearStored();
    },
    clearStored,
  };
}

/** Order-insensitive equality for two string lists (assignees, sharing). */
export function sameMembers(a: readonly string[] = [], b: readonly string[] = []): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b.map((e) => e.toLowerCase()));
  return a.every((e) => sb.has(e.toLowerCase()));
}
