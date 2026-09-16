"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  createAbandonSession,
  type AbandonOutcome,
  type AbandonSession,
  type EqualFn,
} from "@/lib/abandon";

export type AbandonState = "idle" | "abandoning" | "failed";

/**
 * Lets a control nested inside an item editor (e.g. the Parent epic row in the
 * detail modal) route its write through the editor's abandon session, so
 * abandoning the editor reverts it too. Null outside such an editor.
 */
type ItemSave = (
  patch: { parent_id?: string | null },
  run: () => Promise<unknown>,
) => Promise<unknown>;
const ItemEditSaveContext = createContext<ItemSave | null>(null);
export const ItemEditSaveProvider = ItemEditSaveContext.Provider;
export function useItemEditSave(): ItemSave | null {
  return useContext(ItemEditSaveContext);
}

/**
 * Abandon changes for an editor that saves as you go (KANBAN-42). Captures the
 * as-opened values ON MOUNT (so mount the editor per open, e.g. keyed by the
 * thing it edits), routes the editor's saves through `save` so it knows what
 * has been written, and `abandon` restores the as-opened state:
 *
 *   cancel the pending autosave → wait for in-flight saves → write the revert
 *   (only the fields actually changed) → `onDone` (close the editor).
 *
 * With nothing to revert it just calls `onDone`. A failing revert leaves the
 * editor open with `state === "failed"`, and saving resumes. The decision logic
 * is the pure lib/abandon.ts (tested); this hook only adds React lifetimes.
 * Reusable by any autosaving editor (the item modal today; entry editors next).
 */
export function useAbandonable<T extends Record<string, unknown>>(
  opened: T,
  options: { equal?: EqualFn } = {},
): {
  session: AbandonSession<T>;
  save: AbandonSession<T>["save"];
  state: AbandonState;
  abandon: (opts: {
    cancelPending?: () => void;
    revert: (patch: Partial<T>) => Promise<void>;
    onDone: (outcome: AbandonOutcome<T>) => void;
  }) => Promise<void>;
} {
  // Lazy state initialiser: the snapshot is taken once, when the editor opens.
  const [session] = useState(() => createAbandonSession(opened, options));
  const [state, setState] = useState<AbandonState>("idle");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const save = useCallback<AbandonSession<T>["save"]>(
    (patch, run) => session.save(patch, run),
    [session],
  );

  const abandon = useCallback(
    async ({
      cancelPending,
      revert,
      onDone,
    }: {
      cancelPending?: () => void;
      revert: (patch: Partial<T>) => Promise<void>;
      onDone: (outcome: AbandonOutcome<T>) => void;
    }) => {
      if (session.abandoning) return;
      setState("abandoning");
      try {
        const outcome = await session.abandon({ cancelPending, revert });
        // If the editor was dismissed meanwhile (Esc, click-off), it's already
        // closed: don't close whatever is open now.
        if (mounted.current) {
          setState("idle");
          onDone(outcome);
        }
      } catch {
        if (mounted.current) setState("failed");
      }
    },
    [session],
  );

  return { session, save, state, abandon };
}
