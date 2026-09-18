"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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

/**
 * The leftover-draft offer is decided once, when the editor opens, and changes
 * only through React state after that — so the "store" it is read from never
 * has anything to announce.
 */
function subscribeNever(): () => void {
  return () => {};
}

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
 * Reused by any editor of saved data: the card page (KANBAN-44) and its entry
 * editors and composers (KANBAN-38), each an instance with its own draft key.
 */
export function useAbandonable<T extends Record<string, unknown>>({
  opened,
  scope,
  id,
  equal,
  baseUpdatedAt = null,
  restoreOnOpen = false,
}: {
  opened: T;
  /**
   * The draft's storage scope and id: the key is
   * `mykan:draft:v1:<scope>:<id>:<field>`. Several editors can be open on one
   * page as long as each has its own scope/id (the card is `item:<itemId>`;
   * entry editors use lib/entry-panels.ts entryDraftScope).
   */
  scope: string;
  id: string;
  equal?: EqualFn;
  baseUpdatedAt?: string | null;
  /** Apply a leftover draft on open instead of prompting (Restore was already chosen). */
  restoreOnOpen?: boolean;
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
  const [pendingRestore, setRestore] = useState<PendingRestore<T> | null>(() => {
    if (initialDecision.kind !== "offer") return null;
    // The user already chose Restore before this editor opened (an entry row's
    // prompt, KANBAN-38): start with the draft as unsaved changes, no prompt.
    if (restoreOnOpen) {
      session.restore(initialDecision.values);
      return null;
    }
    return {
      values: initialDecision.values,
      stale: initialDecision.stale,
      staleFields: initialDecision.staleFields,
      startedAt: initialDecision.startedAt,
    };
  });
  // The offer is withheld from the server render AND from the hydrating render
  // (KANBAN-49). A leftover draft only exists in localStorage, which the server
  // can't read: rendering the prompt on the client's first pass makes the tree
  // differ from the server HTML, React throws that HTML away and client-renders
  // from the root, and on the way it rewrites <html>'s className from the
  // server's value — which never contains `dark`. The card page (the one page
  // with a draft editor in its server render) therefore came back light after
  // every reload that had a draft waiting. useSyncExternalStore is the same
  // shape EntryPanels already uses for its stored drafts: the server snapshot
  // during hydration, the real value straight after — and on a client-side
  // navigation, where there is no hydration, the real value immediately.
  const restore = useSyncExternalStore(
    subscribeNever,
    () => pendingRestore,
    () => null,
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
