"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { AbandonButton } from "@/components/AbandonButton";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { EntryMarkdown } from "@/components/EntryMarkdown";
import { useAbandonable, type PendingRestore } from "@/components/useAbandonable";
import { useRegisterFinisher } from "@/components/cardFinish";
import { trackPendingSave } from "@/components/boardReturn";
import { browserDraftStore } from "@/lib/abandon";
import {
  entryDraftKey,
  entryDraftScope,
  entryEditorKey,
  groupDecisions,
  groupProgress,
  leftoverEntryDraft,
  openQuestionsLabel,
  successorsById,
  type EntryDraftFields,
  type EntryDraftTarget,
} from "@/lib/entry-panels";
import {
  ENTRY_MAX_CHARS,
  entryLengthError,
  entryTextLength,
  type EntryKind,
  type ItemEntry,
} from "@/lib/item-entries-rules";
import { displayName, timeAgo } from "@/lib/format";

// ── Data ────────────────────────────────────────────────────────────────────

/** The API's `{ error }` message for a failed response, else "HTTP <status>". */
async function responseError(res: Response): Promise<string> {
  const msg = await res
    .json()
    .then((d: { error?: unknown }) => (typeof d.error === "string" ? d.error : null))
    .catch(() => null);
  return msg ?? `HTTP ${res.status}`;
}

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await responseError(res));
  return (await res.json()) as T;
}

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export type EntriesApi = {
  itemId: string;
  /** Every entry on the card (deleted included), or null while loading. */
  entries: ItemEntry[] | null;
  error: string | null;
  /** Put written entries into local state (replace by id, or add). */
  apply: (...rows: ItemEntry[]) => void;
};

/** The card's entries, loaded once per card page and shared by both panels. */
export function useItemEntries(itemId: string): EntriesApi {
  const [entries, setEntries] = useState<ItemEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    send<ItemEntry[]>(`/api/items/${itemId}/entries`, "GET")
      .then((d) => {
        if (cancelled) return;
        setEntries(d);
        setError(null);
      })
      .catch((e) => !cancelled && setError(errText(e, "Couldn't load entries")));
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const apply = useCallback((...rows: ItemEntry[]) => {
    setEntries((prev) => {
      const list = prev ? [...prev] : [];
      for (const r of rows) {
        const i = list.findIndex((e) => e.id === r.id);
        if (i >= 0) list[i] = r;
        else list.unshift(r);
      }
      return list;
    });
  }, []);

  return useMemo(() => ({ itemId, entries, error, apply }), [itemId, entries, error, apply]);
}

const entryUrl = (e: Pick<ItemEntry, "item_id" | "id">, rest = "") =>
  `/api/items/${e.item_id}/entries/${e.id}${rest}`;

/** Counts for the card page's tab labels. */
export function entryTabCounts(entries: ItemEntry[] | null): { progress: number; open: number } {
  if (!entries) return { progress: 0, open: 0 };
  return {
    progress: groupProgress(entries).current.length,
    open: groupDecisions(entries).openQuestions.length,
  };
}

// ── Panels ──────────────────────────────────────────────────────────────────

type Ctx = {
  api: EntriesApi;
  byId: Map<string, ItemEntry>;
  successors: Map<string, ItemEntry>;
  activeDecisions: ItemEntry[];
};

function useCtx(api: EntriesApi): Ctx {
  return useMemo(() => {
    const rows = api.entries ?? [];
    return {
      api,
      byId: new Map(rows.map((e) => [e.id, e])),
      successors: successorsById(rows),
      activeDecisions: groupDecisions(rows).activeDecisions,
    };
  }, [api]);
}

/**
 * The Progress panel (KANBAN-38): a timeline of progress notes, newest first;
 * superseded and deleted notes are collapsed below.
 */
export function ProgressPanel({ api }: { api: EntriesApi }) {
  const ctx = useCtx(api);
  const g = useMemo(() => groupProgress(api.entries ?? []), [api.entries]);
  return (
    <div data-entry-panels className="flex flex-col gap-3">
      <NewEntry
        itemId={api.itemId}
        kind="progress"
        label="Add progress note"
        placeholder="What changed, where (PR, commit, file), what's next"
        api={api}
      />
      <Loading api={api} />
      {api.entries && g.current.length === 0 ? (
        <Empty>No progress notes yet.</Empty>
      ) : null}
      <EntryList rows={g.current} ctx={ctx} />
      <Collapsed title="Superseded" rows={g.superseded} ctx={ctx} />
      <Collapsed title="Deleted" rows={g.deleted} ctx={ctx} />
    </div>
  );
}

/**
 * The Decisions & Questions panel (KANBAN-38): open questions and active
 * decisions on top; answered questions, superseded decisions and deleted
 * entries collapsed below.
 */
export function DecisionsPanel({ api }: { api: EntriesApi }) {
  const ctx = useCtx(api);
  const g = useMemo(() => groupDecisions(api.entries ?? []), [api.entries]);
  const nothing = g.openQuestions.length === 0 && g.activeDecisions.length === 0;
  return (
    <div data-entry-panels className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <NewEntry
          itemId={api.itemId}
          kind="question"
          label="Ask a question"
          placeholder="What needs deciding or clarifying?"
          api={api}
        />
        <NewEntry
          itemId={api.itemId}
          kind="decision"
          label="Record a decision"
          placeholder="What was decided (and why, briefly)"
          api={api}
        />
      </div>
      <Loading api={api} />
      {api.entries && nothing ? <Empty>No open questions or active decisions.</Empty> : null}
      {g.openQuestions.length > 0 ? (
        <Group title={openQuestionsLabel(g.openQuestions.length)} accent>
          <EntryList rows={g.openQuestions} ctx={ctx} />
        </Group>
      ) : null}
      {g.activeDecisions.length > 0 ? (
        <Group title={`Decisions (${g.activeDecisions.length})`}>
          <EntryList rows={g.activeDecisions} ctx={ctx} />
        </Group>
      ) : null}
      <Collapsed title="Answered questions" rows={g.answeredQuestions} ctx={ctx} />
      <Collapsed title="Superseded decisions" rows={g.supersededDecisions} ctx={ctx} />
      <Collapsed title="Deleted" rows={g.deleted} ctx={ctx} />
    </div>
  );
}

function Loading({ api }: { api: EntriesApi }) {
  if (api.error) return <p className="text-sm text-[var(--color-bug)]">{api.error}</p>;
  if (api.entries === null) {
    return <p className="py-4 text-center text-sm text-[var(--color-faint)]">Loading…</p>;
  }
  return null;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-3 text-center text-sm text-[var(--color-faint)]">{children}</p>;
}

function Group({ title, accent, children }: { title: string; accent?: boolean; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3
        className={`text-[10px] font-medium uppercase tracking-wider ${
          accent ? "text-[var(--color-accent-ink)]" : "text-[var(--color-faint)]"
        }`}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A collapsed group (native <details>: pointer, touch, Enter/Space). Hidden when empty. */
function Collapsed({ title, rows, ctx }: { title: string; rows: ItemEntry[]; ctx: Ctx }) {
  if (rows.length === 0) return null;
  return (
    <details className="group/details">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded text-[10px] font-medium uppercase tracking-wider text-[var(--color-faint)] outline-none hover:text-[var(--color-ink)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] [&::-webkit-details-marker]:hidden">
        <svg
          className="h-3 w-3 transition-transform group-open/details:rotate-90"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m9 6 6 6-6 6" />
        </svg>
        {title} ({rows.length})
      </summary>
      <div className="mt-1.5">
        <EntryList rows={rows} ctx={ctx} />
      </div>
    </details>
  );
}

function EntryList({ rows, ctx }: { rows: ItemEntry[]; ctx: Ctx }) {
  if (rows.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((e) => (
        <EntryCard key={e.id} entry={e} ctx={ctx} />
      ))}
    </ul>
  );
}

// ── One entry ───────────────────────────────────────────────────────────────

type Mode = null | "edit" | "answer" | "supersede";

const KIND_LABEL: Record<EntryKind, string> = {
  progress: "Progress",
  question: "Question",
  decision: "Decision",
};

function stateLabel(e: ItemEntry): string | null {
  if (e.deleted_at) return "Deleted";
  if (e.state === "open") return "Open";
  if (e.state === "answered") return "Answered";
  if (e.state === "superseded") return "Superseded";
  return null;
}

/** The first line of an entry, for "Answered by" / "Superseded by" links. */
function snippet(text: string): string {
  const line = text.split("\n").find((l) => l.trim()) ?? "";
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

function EntryCard({ entry, ctx }: { entry: ItemEntry; ctx: Ctx }) {
  const { api } = ctx;
  const [mode, setMode] = useState<Mode>(null);
  const [autoRestore, setAutoRestore] = useState(false);
  const [history, setHistory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped when a leftover draft is discarded, to check storage again.
  const [draftCheck, setDraftCheck] = useState(0);

  const deleted = !!entry.deleted_at;
  const canAnswer = !deleted && entry.kind === "question" && entry.state === "open";
  const canSupersede = !deleted && entry.kind === "decision" && entry.state === "active";

  // Leftover drafts for this entry's editors (from an earlier visit), offered
  // right in the row without opening an editor. Each resolves on its own.
  const leftovers = useMemo(() => {
    void draftCheck;
    if (mode !== null) return [];
    const store = browserDraftStore();
    const targets: { mode: Exclude<Mode, null>; target: EntryDraftTarget; stored: string; what: string }[] = [];
    if (!deleted) {
      targets.push({ mode: "edit", target: { kind: "edit", entryId: entry.id }, stored: entry.body, what: "edit to this entry" });
    }
    if (canAnswer) {
      targets.push({ mode: "answer", target: { kind: "answer", questionId: entry.id }, stored: "", what: "answer to this question" });
    }
    if (canSupersede) {
      targets.push({ mode: "supersede", target: { kind: "supersede", entryId: entry.id }, stored: "", what: "replacement for this decision" });
    }
    return targets.flatMap((t) => {
      const d = leftoverEntryDraft(store, t.target, t.stored);
      return d.kind === "offer" ? [{ ...t, restore: d }] : [];
    });
  }, [mode, deleted, canAnswer, canSupersede, entry.id, entry.body, draftCheck]);

  const open = (m: Mode, restore = false) => {
    setError(null);
    setAutoRestore(restore);
    setMode(m);
  };
  const done = useCallback(() => {
    setMode(null);
    setAutoRestore(false);
  }, []);

  async function act(run: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(errText(e, fallback));
    } finally {
      setBusy(false);
    }
  }
  const remove = () =>
    act(async () => api.apply(await send<ItemEntry>(entryUrl(entry), "DELETE")), "Delete failed");
  const undelete = () =>
    act(async () => api.apply(await send<ItemEntry>(entryUrl(entry, "/restore"), "POST")), "Restore failed");

  const answeredBy = entry.answered_by_id ? ctx.byId.get(entry.answered_by_id) : undefined;
  const successor = ctx.successors.get(entry.id);
  const state = stateLabel(entry);
  const edited = entry.updated_at !== entry.created_at && !deleted;

  return (
    <li
      className={`rounded-md border px-3 py-2 ${
        canAnswer
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]/40"
          : "border-[var(--color-line)]"
      } ${deleted ? "opacity-75" : ""}`}
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[11px] leading-5 text-[var(--color-faint)]">
          {entry.kind !== "progress" ? (
            <span className="font-medium uppercase tracking-wider text-[var(--color-muted)]">
              {KIND_LABEL[entry.kind]}
            </span>
          ) : null}
          {state ? (
            <span
              className={`${entry.kind !== "progress" ? "ml-1.5 " : ""}font-medium uppercase tracking-wider ${
                deleted ? "text-[var(--color-bug)]" : state === "Open" ? "text-[var(--color-accent-ink)]" : ""
              }`}
            >
              {state}
            </span>
          ) : null}
          {entry.kind !== "progress" || state ? " · " : ""}
          <span className="text-[var(--color-muted)]">{displayName(entry.created_by)}</span>
          {" · "}
          <span title={new Date(entry.created_at).toLocaleString()}>{timeAgo(entry.created_at)}</span>
          {entry.source !== "web" ? (
            <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wider">{entry.source}</span>
          ) : null}
          {edited ? (
            <span title={`Edited ${new Date(entry.updated_at).toLocaleString()}`}> · edited</span>
          ) : null}
        </p>
        <span className="flex shrink-0 items-center gap-0.5">
          {deleted ? (
            <button
              type="button"
              onClick={() => void undelete()}
              disabled={busy}
              title="Restore this entry"
              aria-label="Restore this entry"
              className="rounded px-1.5 py-0.5 text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-50"
            >
              {busy ? "Restoring…" : "Restore"}
            </button>
          ) : (
            <>
              {canAnswer ? (
                <IconButton label="Answer this question" onClick={() => open(mode === "answer" ? null : "answer")} active={mode === "answer"}>
                  <path d="M9 14 4 9l5-5" />
                  <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
                </IconButton>
              ) : null}
              {canSupersede ? (
                <IconButton label="Supersede with a new decision" onClick={() => open(mode === "supersede" ? null : "supersede")} active={mode === "supersede"}>
                  <path d="m17 2 4 4-4 4" />
                  <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
                  <path d="m7 22-4-4 4-4" />
                  <path d="M21 13v1a4 4 0 0 1-4 4H3" />
                </IconButton>
              ) : null}
              {mode !== "edit" ? (
                <IconButton label="Edit this entry" onClick={() => open("edit")}>
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                </IconButton>
              ) : null}
              <IconButton label="Delete this entry" onClick={() => void remove()} disabled={busy || mode === "edit"} danger>
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              </IconButton>
            </>
          )}
          <IconButton label={history ? "Hide history" : "History of this entry"} onClick={() => setHistory((h) => !h)} active={history}>
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" />
          </IconButton>
        </span>
      </div>

      {leftovers.map((l) => (
        <div key={l.mode} className="mt-1.5">
          <DraftPrompt
            restore={l.restore}
            what={l.what}
            staleNote={l.mode === "edit" ? "This entry changed since then. Restoring replaces the newer text when you save." : null}
            onRestore={() => open(l.mode, true)}
            onDiscard={() => {
              browserDraftStore().remove(entryDraftKey(l.target));
              setDraftCheck((n) => n + 1);
            }}
          />
        </div>
      ))}

      <div className="mt-1">
        {mode === "edit" ? (
          <EntryEditor entry={entry} api={api} autoRestore={autoRestore} onDone={done} />
        ) : (
          <EntryMarkdown text={entry.body} />
        )}
      </div>

      {answeredBy ? (
        <p className="mt-1.5 text-xs text-[var(--color-muted)]">
          <span className="text-[var(--color-faint)]">Answered by decision: </span>
          {snippet(answeredBy.body)}
        </p>
      ) : null}
      {successor ? (
        <p className="mt-1.5 text-xs text-[var(--color-muted)]">
          <span className="text-[var(--color-faint)]">Superseded by: </span>
          {snippet(successor.body)}
        </p>
      ) : null}

      {error ? <p className="mt-1.5 text-xs text-[var(--color-bug)]">{error}</p> : null}

      {mode === "answer" ? (
        <div className="mt-2 border-t border-[var(--color-line)] pt-2">
          <AnswerComposer question={entry} ctx={ctx} autoRestore={autoRestore} onDone={done} />
        </div>
      ) : null}
      {mode === "supersede" ? (
        <div className="mt-2 border-t border-[var(--color-line)] pt-2">
          <Composer
            target={{ kind: "supersede", entryId: entry.id }}
            placeholder="The new decision that replaces this one"
            submitLabel="Supersede"
            autoRestore={autoRestore}
            onDone={done}
            onSubmit={async (body) => {
              const r = await send<{ superseded: ItemEntry; entry: ItemEntry }>(
                entryUrl(entry, "/supersede"),
                "POST",
                { body },
              );
              api.apply(r.superseded, r.entry);
            }}
          />
        </div>
      ) : null}

      {history ? (
        <div className="mt-2 border-t border-[var(--color-line)] pt-1">
          <EntryHistory entry={entry} api={api} />
        </div>
      ) : null}
    </li>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  active,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      className={`grid h-6 w-6 place-items-center rounded transition-colors disabled:opacity-40 ${
        active ? "text-[var(--color-accent)]" : "text-[var(--color-faint)]"
      } ${danger ? "hover:text-[var(--color-bug)]" : "hover:text-[var(--color-accent)]"}`}
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  );
}

// ── Editing an entry (save on finish, KANBAN-42) ────────────────────────────

/**
 * Edits one entry's text exactly like the card description: nothing written
 * while typing (localStorage draft under entry:<id>); Esc, ⌘/Ctrl+Enter, a
 * press outside the editor, or leaving the page saves ONCE (one version, one
 * edit session); the abandon icon discards with no write. Registered with the
 * card page so leaving waits for this save too.
 */
function EntryEditor({
  entry,
  api,
  autoRestore,
  onDone,
}: {
  entry: ItemEntry;
  api: EntriesApi;
  autoRestore: boolean;
  onDone: () => void;
}) {
  const draft = useAbandonable<EntryDraftFields>({
    opened: { body: entry.body },
    ...entryDraftScope({ kind: "edit", entryId: entry.id }),
    baseUpdatedAt: entry.updated_at,
    restoreOnOpen: autoRestore,
  });
  const { session, set, close, abandon, restore, applyRestore, discardRestore } = draft;
  const url = entryUrl(entry);

  // One edit session per open: the save and a keepalive save of the same edit
  // fold into one version.
  const editSession = useRef("");
  useEffect(() => {
    editSession.current = crypto.randomUUID();
  }, []);
  const root = useRef<HTMLDivElement>(null);
  const ended = useRef(false);
  const [invalid, setInvalid] = useState<string | null>(null);

  const save = useCallback(
    async (patch: Partial<EntryDraftFields>) => {
      api.apply(
        await send<ItemEntry>(url, "PATCH", { body: patch.body, edit_session: editSession.current }),
      );
    },
    [api, url],
  );

  const closing = useRef<Promise<boolean> | null>(null);
  const finish = useCallback((): Promise<boolean> => {
    if (ended.current) return Promise.resolve(true);
    if (closing.current) return closing.current;
    if (session.patch()) {
      const err = entryLengthError(session.values.body);
      if (err) {
        setInvalid(
          entryTextLength(session.values.body) === 0
            ? "Text is required. Abandon changes to keep the old text."
            : err,
        );
        return Promise.resolve(false);
      }
    }
    setInvalid(null);
    const p = close(save).then((ok) => {
      closing.current = null;
      if (ok) {
        ended.current = true;
        onDone();
      }
      return ok;
    });
    closing.current = p;
    return p;
  }, [session, close, save, onDone]);
  useRegisterFinisher(finish);

  const onAbandon = useCallback(() => {
    ended.current = true;
    abandon();
    onDone();
  }, [abandon, onDone]);

  // Click-off: a press outside this editor finishes it (one save if changed).
  useEffect(() => {
    function onDown(e: PointerEvent) {
      const el = root.current;
      const t = e.target as Node | null;
      if (!el || !t || el.contains(t)) return;
      if (t instanceof Element && t.closest("[data-keep-draft]")) return;
      void finish();
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [finish]);

  // Leaving the page (tab close, reload, client-side navigation that unmounts
  // this editor): a best-effort keepalive save. The draft stays in storage in
  // case it doesn't land, and is forgotten next time if it did.
  useEffect(() => {
    function beacon() {
      if (ended.current) return;
      const patch = session.patch();
      if (!patch || entryLengthError(patch.body)) return;
      try {
        const p = fetch(url, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: patch.body, edit_session: editSession.current }),
          keepalive: true,
        });
        trackPendingSave(p);
        void p.catch(() => {});
      } catch {
        // The page is going away: the draft stays.
      }
    }
    window.addEventListener("pagehide", beacon);
    return () => {
      window.removeEventListener("pagehide", beacon);
      beacon();
    };
  }, [session, url]);

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (restore) return; // the prompt answers its own keys
    const k = entryEditorKey({
      key: e.key,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      isComposing: e.nativeEvent.isComposing,
    });
    if (!k) return;
    // Handled here: the card page's own Esc must not also act on it.
    e.preventDefault();
    void finish();
  }

  const body = draft.values.body;
  return (
    <div ref={root} onKeyDown={onKeyDown} className="flex flex-col gap-1.5">
      {restore ? (
        <DraftPrompt
          restore={restore}
          what="edit to this entry"
          staleNote="This entry changed since then. Restoring replaces the newer text when you save."
          onRestore={applyRestore}
          onDiscard={discardRestore}
          autoFocus
        />
      ) : null}
      <div inert={restore ? true : undefined} className={restore ? "opacity-60" : ""}>
        <EntryTextarea
          value={body}
          onChange={(v) => set("body", v)}
          label="Edit entry text"
          autoFocus={!restore}
        />
      </div>
      <EditorFooter
        count={entryTextLength(body)}
        status={
          draft.status === "saving"
            ? "Saving…"
            : draft.status === "failed"
              ? `Save failed${draft.error ? ` (${draft.error})` : ""}. Nothing lost. Esc to retry.`
              : invalid ?? (draft.dirty ? "Unsaved · Esc or click away to save" : "Esc or click away to finish")
        }
        failed={draft.status === "failed" || invalid !== null}
        hint="Enter for newline · ⌘/Ctrl+Enter to save"
      >
        <span data-keep-draft className="inline-flex">
          <AbandonButton onAbandon={onAbandon} size="sm" disabled={draft.status === "saving"} />
        </span>
      </EditorFooter>
    </div>
  );
}

// ── Composers (new entries, answers, superseding decisions) ─────────────────

/**
 * Writing a NEW entry. Nothing is created until the explicit Add (the button
 * or ⌘/Ctrl+Enter), so a stray Esc can't post a note or a decision. The text is
 * a browser draft while you type (its own key per item and kind, or per
 * question / decision), so it survives a crash or leaving the page and is
 * offered back. Esc settles (blurs, keeps the text); an empty composer closes.
 * The abandon icon discards the draft and closes, with no write.
 */
function Composer({
  target,
  placeholder,
  submitLabel,
  autoRestore,
  onSubmit,
  onDone,
  autoFocus = true,
  children,
}: {
  target: EntryDraftTarget;
  placeholder: string;
  submitLabel: string;
  autoRestore: boolean;
  onSubmit: (body: string) => Promise<void>;
  onDone: () => void;
  autoFocus?: boolean;
  children?: ReactNode;
}) {
  const draft = useAbandonable<EntryDraftFields>({
    opened: { body: "" },
    ...entryDraftScope(target),
    restoreOnOpen: autoRestore,
  });
  const { set, close, abandon, restore, applyRestore, discardRestore } = draft;
  const [invalid, setInvalid] = useState<string | null>(null);
  const body = draft.values.body;

  async function submit() {
    const err = entryLengthError(body);
    if (err) {
      setInvalid(entryTextLength(body) === 0 ? "Write something first." : err);
      return;
    }
    setInvalid(null);
    if (await close(async (patch) => onSubmit(patch.body ?? body))) onDone();
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (restore) return;
    const k = entryEditorKey({
      key: e.key,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      isComposing: e.nativeEvent.isComposing,
    });
    if (!k) return;
    e.preventDefault();
    if (k === "submit") {
      void submit();
    } else if (!draft.dirty) {
      onDone();
    } else if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  return (
    <div onKeyDown={onKeyDown} className="flex flex-col gap-1.5">
      {restore ? (
        <DraftPrompt
          restore={restore}
          what="draft here"
          staleNote={null}
          onRestore={applyRestore}
          onDiscard={discardRestore}
          autoFocus
        />
      ) : null}
      <div inert={restore ? true : undefined} className={restore ? "opacity-60" : ""}>
        <EntryTextarea
          value={body}
          onChange={(v) => set("body", v)}
          label={placeholder}
          placeholder={placeholder}
          autoFocus={autoFocus && !restore}
        />
      </div>
      <EditorFooter
        count={entryTextLength(body)}
        status={
          draft.status === "saving"
            ? "Adding…"
            : draft.status === "failed"
              ? `Not added${draft.error ? ` (${draft.error})` : ""}. Nothing lost.`
              : invalid
        }
        failed={draft.status === "failed" || invalid !== null}
        hint="Enter for newline · ⌘/Ctrl+Enter to add"
      >
        <AbandonButton
          onAbandon={() => {
            abandon();
            onDone();
          }}
          size="sm"
          label="Discard this draft"
          disabled={draft.status === "saving"}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={draft.status === "saving" || restore !== null}
          className="rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </EditorFooter>
      {children}
    </div>
  );
}

/** A collapsed "+ Add …" button that opens a composer for a new entry. */
function NewEntry({
  itemId,
  kind,
  label,
  placeholder,
  api,
}: {
  itemId: string;
  kind: EntryKind;
  label: string;
  placeholder: string;
  api: EntriesApi;
}) {
  const [open, setOpen] = useState(false);
  const [autoRestore, setAutoRestore] = useState(false);
  const [draftCheck, setDraftCheck] = useState(0);
  const target = useMemo<EntryDraftTarget>(() => ({ kind: "new", itemId, entryKind: kind }), [itemId, kind]);

  const leftover = useMemo(() => {
    void draftCheck;
    if (open) return null;
    const d = leftoverEntryDraft(browserDraftStore(), target, "");
    return d.kind === "offer" ? d : null;
  }, [open, target, draftCheck]);

  if (!open) {
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => {
            setAutoRestore(false);
            setOpen(true);
          }}
          className="flex items-center gap-1.5 self-start rounded-md px-2 py-1 text-xs font-medium text-[var(--color-muted)] ring-1 ring-inset ring-[var(--color-line-strong)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)]"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {label}
        </button>
        {leftover ? (
          <DraftPrompt
            restore={leftover}
            what={`${KIND_LABEL[kind].toLowerCase()} draft`}
            staleNote={null}
            onRestore={() => {
              setAutoRestore(true);
              setOpen(true);
            }}
            onDiscard={() => {
              browserDraftStore().remove(entryDraftKey(target));
              setDraftCheck((n) => n + 1);
            }}
          />
        ) : null}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-[var(--color-line)] p-2">
      <Composer
        target={target}
        placeholder={placeholder}
        submitLabel={kind === "progress" ? "Add note" : kind === "question" ? "Ask" : "Record"}
        autoRestore={autoRestore}
        onDone={() => {
          setOpen(false);
          setDraftCheck((n) => n + 1);
        }}
        onSubmit={async (body) => {
          api.apply(await send<ItemEntry>(`/api/items/${itemId}/entries`, "POST", { kind, body }));
        }}
      />
    </div>
  );
}

/**
 * Answer an open question: write a new decision (recorded and linked), or link
 * one of the card's active decisions.
 */
function AnswerComposer({
  question,
  ctx,
  autoRestore,
  onDone,
}: {
  question: ItemEntry;
  ctx: Ctx;
  autoRestore: boolean;
  onDone: () => void;
}) {
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function link(decisionId: string) {
    setLinking(decisionId);
    setError(null);
    try {
      const r = await send<{ question: ItemEntry; decision: ItemEntry }>(
        entryUrl(question, "/answer"),
        "POST",
        { decision_id: decisionId },
      );
      ctx.api.apply(r.question, r.decision);
      // Answered by linking: a drafted new decision for this question is moot.
      browserDraftStore().remove(entryDraftKey({ kind: "answer", questionId: question.id }));
      onDone();
    } catch (e) {
      setError(errText(e, "Link failed"));
    } finally {
      setLinking(null);
    }
  }

  return (
    <Composer
      target={{ kind: "answer", questionId: question.id }}
      placeholder="The decision that answers this question"
      submitLabel="Record decision"
      autoRestore={autoRestore}
      onDone={onDone}
      onSubmit={async (body) => {
        const r = await send<{ question: ItemEntry; decision: ItemEntry }>(
          entryUrl(question, "/answer"),
          "POST",
          { body },
        );
        ctx.api.apply(r.question, r.decision);
      }}
    >
      {ctx.activeDecisions.length > 0 ? (
        <div className="mt-1 flex flex-col gap-1">
          <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
            Or link an active decision
          </p>
          <ul className="flex flex-col gap-1">
            {ctx.activeDecisions.map((d) => (
              <li key={d.id} className="flex items-start gap-2 text-xs">
                <span className="min-w-0 flex-1 break-words text-[var(--color-muted)]">{snippet(d.body)}</span>
                <button
                  type="button"
                  onClick={() => void link(d.id)}
                  disabled={linking !== null}
                  title="Answer the question with this decision"
                  aria-label={`Answer with the decision: ${snippet(d.body)}`}
                  className="shrink-0 rounded px-1.5 py-0.5 font-medium text-[var(--color-accent)] ring-1 ring-inset ring-[var(--color-line-strong)] transition-colors hover:bg-[var(--color-accent-soft)] disabled:opacity-50"
                >
                  {linking === d.id ? "Linking…" : "Link"}
                </button>
              </li>
            ))}
          </ul>
          {error ? <p className="text-xs text-[var(--color-bug)]">{error}</p> : null}
        </div>
      ) : null}
    </Composer>
  );
}

// ── Shared editor pieces ────────────────────────────────────────────────────

function EntryTextarea({
  value,
  onChange,
  label,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <AutoGrowTextarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      placeholder={placeholder}
      autoFocus={autoFocus}
      maxHeight={320}
      className="rounded-md border border-[var(--color-line-strong)] bg-[var(--color-canvas)] px-2 py-1.5 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
    />
  );
}

function EditorFooter({
  count,
  status,
  failed,
  hint,
  children,
}: {
  count: number;
  status: string | null;
  failed: boolean;
  hint: string;
  children: ReactNode;
}) {
  const over = count > ENTRY_MAX_CHARS;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-faint)]">
      <span
        className={`tabular-nums ${over ? "font-medium text-[var(--color-bug)]" : ""}`}
        title={`Entries are capped at ${ENTRY_MAX_CHARS.toLocaleString("en-US")} characters`}
      >
        {count.toLocaleString("en-US")} / {ENTRY_MAX_CHARS.toLocaleString("en-US")}
      </span>
      <span className="hidden sm:inline">{hint}</span>
      {status ? (
        <span role={failed ? "alert" : undefined} className={failed ? "text-[var(--color-bug)]" : ""}>
          {status}
        </span>
      ) : null}
      <span className="ml-auto flex items-center gap-2">{children}</span>
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "earlier";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Offer back one editor's leftover draft: Restore (primary) or Discard, by
 * pointer/touch; with focus in the prompt, Esc = Discard (Enter activates the
 * focused button, Restore when it was focused on open). Resolves only its own
 * draft, so several can be up at once.
 */
function DraftPrompt({
  restore,
  what,
  staleNote,
  onRestore,
  onDiscard,
  autoFocus,
}: {
  restore: Pick<PendingRestore<EntryDraftFields>, "startedAt" | "stale">;
  what: string;
  staleNote: string | null;
  onRestore: () => void;
  onDiscard: () => void;
  autoFocus?: boolean;
}) {
  return (
    <div
      data-restore-prompt
      role="group"
      aria-label="Unsaved draft"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        onDiscard();
      }}
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-[var(--color-line)] bg-[var(--color-accent-soft)] px-2.5 py-1.5 text-xs text-[var(--color-ink)]"
    >
      <span className="min-w-0 flex-1">
        Unsaved {what} from {formatWhen(restore.startedAt)}.
        {restore.stale && staleNote ? (
          <strong className="mt-0.5 block font-medium text-[var(--color-bug)]">{staleNote}</strong>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onDiscard}
          title="Discard the draft (Esc)"
          className="rounded-md px-2 py-0.5 text-[var(--color-muted)] ring-1 ring-inset ring-[var(--color-line-strong)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
        >
          Discard
        </button>
        <button
          type="button"
          autoFocus={autoFocus}
          onClick={onRestore}
          title="Restore the draft"
          className="rounded-md bg-[var(--color-accent)] px-2 py-0.5 font-medium text-white transition-opacity hover:opacity-90"
        >
          Restore
        </button>
      </span>
    </div>
  );
}

// ── Entry history ───────────────────────────────────────────────────────────

/** Mirrors EntryHistoryEntry in app/api/items/[id]/entries/[entryId]/versions/route.ts. */
type EntryVersionRow = {
  id: string;
  created_at: string;
  created_by: string | null;
  source: "web" | "mcp" | "telegram" | "recovery";
  changes: string[];
  body_text: string;
};

/**
 * One entry's versions, newest first, in the same look and behaviour as the
 * card's History list: each row is the state BEFORE a change; Restore asks for
 * a confirm, and the restore is itself versioned. Esc cancels a pending
 * confirm. Reloads when the entry changes.
 */
function EntryHistory({ entry, api }: { entry: ItemEntry; api: EntriesApi }) {
  const [rows, setRows] = useState<EntryVersionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    send<EntryVersionRow[]>(entryUrl(entry, "/versions"), "GET")
      .then((d) => {
        if (cancelled) return;
        setRows(d);
        setError(null);
      })
      .catch(() => !cancelled && setError("Couldn't load history"));
    return () => {
      cancelled = true;
    };
    // entry.updated_at: a save or restore reloads the list.
  }, [entry.item_id, entry.id, entry.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (confirming === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setConfirming(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming]);

  async function restore(versionId: string) {
    setRestoring(versionId);
    try {
      api.apply(
        await send<ItemEntry>(entryUrl(entry, "/versions"), "POST", { version_id: versionId }),
      );
    } catch (e) {
      setError(errText(e, "Restore failed"));
    } finally {
      setRestoring(null);
      setConfirming(null);
    }
  }

  if (error) return <p className="py-3 text-center text-xs text-[var(--color-bug)]">{error}</p>;
  if (rows === null) {
    return <p className="py-3 text-center text-xs text-[var(--color-faint)]">Loading…</p>;
  }
  if (rows.length === 0) {
    return (
      <p className="py-3 text-center text-xs text-[var(--color-faint)]">
        No history yet — changes to this entry will appear here.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-[var(--color-line)]">
      {rows.map((v) => (
        <li key={v.id} className="flex items-start gap-3 py-2 text-sm">
          <div className="min-w-0 flex-1">
            <p className="text-[var(--color-ink)]">
              <span className="font-medium">{displayName(v.created_by)}</span>{" "}
              <span className="text-[var(--color-muted)]">{v.changes.join(" · ")}</span>
            </p>
            {v.changes.includes("text edited") && v.body_text ? (
              <p
                className="mt-0.5 overflow-hidden whitespace-pre-wrap break-words text-xs leading-5 text-[var(--color-faint)]"
                style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}
                title="The text as it was before this change"
              >
                {v.body_text}
              </p>
            ) : null}
            <p className="mt-0.5 text-xs text-[var(--color-faint)]">
              <span title={new Date(v.created_at).toLocaleString()}>{timeAgo(v.created_at)}</span>
              {v.source !== "web" ? (
                <span className="ml-2 font-mono text-[10px] uppercase tracking-wider">{v.source}</span>
              ) : null}
            </p>
          </div>
          {confirming === v.id ? (
            <span className="flex shrink-0 items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => void restore(v.id)}
                disabled={restoring !== null}
                className="font-medium text-[var(--color-accent)] transition-opacity hover:opacity-70 disabled:opacity-50"
              >
                {restoring === v.id ? "Restoring…" : "Confirm restore"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                disabled={restoring !== null}
                className="text-[var(--color-faint)] transition-colors hover:text-[var(--color-ink)]"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(v.id)}
              title="Restore the entry to how it was before this change"
              aria-label="Restore this version"
              className="shrink-0 text-xs text-[var(--color-faint)] transition-colors hover:text-[var(--color-accent)]"
            >
              Restore
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
