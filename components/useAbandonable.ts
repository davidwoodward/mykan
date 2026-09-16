"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  browserDraftStore,
  createDraftSession,
  draftKey,
  readFieldDraft,
  restoreDecision,
  type DraftSession,
  type EqualFn,
} from "@/lib/abandon";

export type DraftEditorStatus = "idle" | "saving" | "failed";

export type PendingRestore<T> = {
  values: Partial<T>;
  stale: boolean;
  staleFields: (keyof T & string)[];
  startedAt: string;
};

/**
 * A draft editor (KANBAN-42): nothing is written while editing; finishing sends
 * one save; abandoning writes nothing. The decisions are the pure, tested
 * lib/abandon.ts; this hook adds React lifetimes and browser storage.
 *
 * - Captures the as-opened values ON MOUNT (mount the editor per open, e.g.
 *   keyed by the thing it edits).
 * - `set` changes the draft and mirrors it to localStorage under
 *   `mykan:draft:v1:<scope>:<id>:<field>` (try/catch'd; no storage, no crash).
 * - `close(save)` resolves true when the editor may close: unchanged (no
 *   write) or saved. On failure it resolves false, keeps the draft, and sets
 *   `status: "failed"` + `error` so the editor stays open without losing text.
 * - `abandon()` drops the draft. The caller closes.
 * - `restore` is a leftover draft from an earlier open that differs from the
 *   stored value (crash, or a tab-close save that didn't land), for the
 *   editor to offer: `applyRestore()` puts it back as unsaved changes and bumps
 *   `revision` (remount uncontrolled inputs with it), `discardRestore()` forgets it.
 *
 * Reused by any editor of saved data: the item modal today; entry editors
 * (KANBAN-38) and the card page (KANBAN-44) next.
 */
export function useAbandonable<T extends Record<string, unknown>>({
  opened,
  scope,
  id,
  equal,
  baseUpdatedAt = null,
}: {
  opened: T;
  scope: string;
  id: string;
  equal?: EqualFn;
  baseUpdatedAt?: string | null;
}): {
  session: DraftSession<T>;
  values: Readonly<T>;
  dirty: boolean;
  set: <K extends keyof T & string>(key: K, value: T[K]) => void;
  status: DraftEditorStatus;
  error: string | null;
  close: (save: (patch: Partial<T>) => Promise<void>) => Promise<boolean>;
  abandon: () => void;
  restore: PendingRestore<T> | null;
  applyRestore: () => void;
  discardRestore: () => void;
  revision: number;
} {
  // Lazy initialisers: the snapshot and the leftover-draft check happen once,
  // when the editor opens.
  const [store] = useState(browserDraftStore);
  const [session] = useState(() =>
    createDraftSession<T>({
      opened,
      store,
      keyOf: (f) => draftKey(scope, id, f),
      equal,
      baseUpdatedAt,
    }),
  );
  const [initialDecision] = useState(() => {
    const drafts: Partial<Record<keyof T & string, ReturnType<typeof readFieldDraft>>> = {};
    for (const f of Object.keys(opened) as (keyof T & string)[]) {
      drafts[f] = readFieldDraft(store, draftKey(scope, id, f));
    }
    return restoreDecision<T>(drafts, opened, equal);
  });
  const [restore, setRestore] = useState<PendingRestore<T> | null>(() =>
    initialDecision.kind === "offer"
      ? {
          values: initialDecision.values,
          stale: initialDecision.stale,
          staleFields: initialDecision.staleFields,
          startedAt: initialDecision.startedAt,
        }
      : null,
  );
  const [status, setStatus] = useState<DraftEditorStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  // Drafts that match what's stored (their save landed) are just forgotten.
  useEffect(() => {
    if (initialDecision.kind === "clear") session.clearStored();
  }, [initialDecision, session]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const set = useCallback(
    <K extends keyof T & string>(key: K, value: T[K]) => {
      session.set(key, value);
      rerender();
    },
    [session],
  );

  const close = useCallback(
    async (save: (patch: Partial<T>) => Promise<void>) => {
      // Closed before answering the restore prompt: nothing was edited, and the
      // leftover draft stays for next time (session.close would forget it).
      if (restore && !session.dirty) return true;
      if (session.patch()) setStatus("saving");
      const outcome = await session.close(save);
      if (outcome.kind === "failed") {
        if (mounted.current) {
          setStatus("failed");
          setError(outcome.error);
        }
        return false;
      }
      if (mounted.current) {
        setStatus("idle");
        setError(null);
        rerender();
      }
      return true;
    },
    [restore, session],
  );

  const abandon = useCallback(() => {
    session.abandon();
    setRestore(null);
    rerender();
  }, [session]);

  const applyRestore = useCallback(() => {
    if (!restore) return;
    session.restore(restore.values);
    setRestore(null);
    setRevision((r) => r + 1);
  }, [restore, session]);

  const discardRestore = useCallback(() => {
    session.clearStored();
    setRestore(null);
  }, [session]);

  return {
    session,
    values: session.values,
    dirty: session.dirty,
    set,
    status,
    error,
    close,
    abandon,
    restore,
    applyRestore,
    discardRestore,
    revision,
  };
}
