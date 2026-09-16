// Abandon changes (KANBAN-42). Pure — no DB, no React — so the decision logic
// runs under `node --test`. The React wiring lives in components/useAbandonable.ts
// and components/AbandonButton.tsx.
//
// Editing in mykan saves implicitly (autosave, Esc and leaving the editor all
// keep your work). Abandon is the one explicit way back: it restores the thing
// being edited to exactly how it was when the editor opened, even when autosave
// has already written some of the changes.
//
// How it decides what to write back, without trusting write ordering:
//  - The editor captures the as-opened values of the fields it can change.
//  - Every save it sends goes through `save()`, which marks a field "touched"
//    when the value sent differs from the as-opened value.
//  - The server can only hold the as-opened value or one of the values this
//    editor sent (each save writes the whole field). So a field needs writing
//    back only if some sent value differed; a field never sent, or only ever
//    sent equal to its as-opened value, is already as it was.
//  - abandon() stops new saves, cancels the pending (debounced) one, waits for
//    in-flight saves to land, and only then writes the revert, so a slow
//    autosave can never land on top of it.

/** Per-field equality. */
export type EqualFn = (key: string, a: unknown, b: unknown) => boolean;

/** Structural equality (null and undefined are the same "empty"). */
export const jsonEqual: EqualFn = (_key, a, b) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export type AbandonOutcome<T> =
  /** Nothing had been saved that differs from the as-opened state. */
  | { kind: "closed" }
  /** These fields were written back to their as-opened values. */
  | { kind: "reverted"; patch: Partial<T> };

export type AbandonSession<T extends Record<string, unknown>> = {
  /** The as-opened values, captured when the session was created. */
  readonly opened: Readonly<T>;
  /** True once abandon() has started (and until a failed revert reopens it). */
  readonly abandoning: boolean;
  /**
   * Send a save for `patch` via `run`. Once abandon has started the save is
   * dropped: `run` is not called and the result resolves to undefined.
   */
  save<R>(patch: Partial<T>, run: () => Promise<R>): Promise<R | undefined>;
  /** The write that restores the as-opened state, or null when none is needed. */
  revertPatch(): Partial<T> | null;
  /**
   * Abandon: stop new saves, cancel the pending one, wait for in-flight saves,
   * then write the revert (if any). A failing revert rethrows and reopens the
   * session so editing (and autosave) carries on.
   */
  abandon(opts: {
    cancelPending?: () => void;
    revert: (patch: Partial<T>) => Promise<void>;
  }): Promise<AbandonOutcome<T>>;
};

export function createAbandonSession<T extends Record<string, unknown>>(
  opened: T,
  { equal = jsonEqual }: { equal?: EqualFn } = {},
): AbandonSession<T> {
  const snapshot = { ...opened };
  const touched = new Set<keyof T & string>();
  const inFlight = new Set<Promise<unknown>>();
  let abandoning = false;

  function revertPatch(): Partial<T> | null {
    if (touched.size === 0) return null;
    const patch: Partial<T> = {};
    for (const key of touched) patch[key] = snapshot[key];
    return patch;
  }

  return {
    opened: snapshot,
    get abandoning() {
      return abandoning;
    },
    save<R>(patch: Partial<T>, run: () => Promise<R>): Promise<R | undefined> {
      if (abandoning) return Promise.resolve(undefined);
      for (const key of Object.keys(patch) as (keyof T & string)[]) {
        if (!(key in snapshot)) continue; // not a field this editor reverts
        if (!equal(key, patch[key], snapshot[key])) touched.add(key);
      }
      const p = run();
      inFlight.add(p);
      const done = () => void inFlight.delete(p);
      p.then(done, done);
      return p;
    },
    revertPatch,
    async abandon({ cancelPending, revert }) {
      abandoning = true;
      cancelPending?.();
      // No new saves can start now; wait until every in-flight one settles.
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
      const patch = revertPatch();
      if (!patch) return { kind: "closed" };
      try {
        await revert(patch);
      } catch (e) {
        abandoning = false;
        throw e;
      }
      touched.clear();
      return { kind: "reverted", patch };
    },
  };
}

/**
 * The PATCH body for an item revert. It carries a FRESH edit session: body
 * autosaves of one editor open coalesce into a single history entry keyed by
 * the open's session, so a revert sent under that same session would fold into
 * it and the abandoned text would vanish from history. A new session makes the
 * revert its own write, which snapshots the abandoned state first (restorable
 * from History). `abandon: true` annotates that snapshot as an abandoned edit.
 */
export function itemRevertBody(
  patch: Record<string, unknown>,
  editSession: string,
  mintSession: () => string,
): Record<string, unknown> {
  let session = mintSession();
  while (session === editSession) session = mintSession();
  return { ...patch, edit_session: session, abandon: true };
}
