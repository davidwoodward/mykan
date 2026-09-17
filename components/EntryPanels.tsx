"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { AbandonButton } from "@/components/AbandonButton";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { EntryMarkdown } from "@/components/EntryMarkdown";
import { useAbandonable, type PendingRestore } from "@/components/useAbandonable";
import { useRegisterFinisher, type Finisher } from "@/components/cardFinish";
import { trackPendingSave } from "@/components/boardReturn";
import { browserDraftStore, readFieldDraft, restoreDecision, type DraftStore } from "@/lib/abandon";
import {
  composerDraftLanded,
  entryDraftKey,
  entryDraftScope,
  entryEditorKey,
  groupDecisions,
  groupProgress,
  mergeEntries,
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

/**
 * One request. Writes can go out with `keepalive` (a save while the page is
 * being left), and every write is tracked so the board, if it loads next,
 * waits for it (its open-question badge must not be stale).
 */
async function send<T>(url: string, method: string, body?: unknown, keepalive = false): Promise<T> {
  const p = (async () => {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      keepalive,
    });
    if (!res.ok) throw new Error(await responseError(res));
    return (await res.json()) as T;
  })();
  if (method !== "GET") trackPendingSave(p);
  return p;
}

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export type EntriesApi = {
  itemId: string;
  /** The loaded entries (deleted included), newest first, or null while loading. */
  entries: ItemEntry[] | null;
  error: string | null;
  /** Put written entries into local state (replace by id, or add). */
  apply: (...rows: ItemEntry[]) => void;
  /** More (older) paged entries exist on the server. */
  hasMore: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
};

type Page = { entries: ItemEntry[]; hasMore: boolean; before: string | null };

/**
 * The card's entries, loaded once per card page and shared by both panels.
 * The first page always holds every open question and active decision; older
 * progress, superseded, answered and deleted entries come with "Load older".
 */
export function useItemEntries(itemId: string): EntriesApi {
  const [entries, setEntries] = useState<ItemEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  useEffect(() => {
    let cancelled = false;
    send<Page>(`/api/items/${itemId}/entries`, "GET")
      .then((d) => {
        if (cancelled) return;
        setEntries((prev) => mergeEntries(prev ?? [], d.entries));
        setCursor(d.hasMore ? d.before : null);
        setError(null);
      })
      .catch((e) => !cancelled && setError(errText(e, "Couldn't load entries")));
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const apply = useCallback((...rows: ItemEntry[]) => {
    setEntries((prev) => mergeEntries(prev ?? [], rows));
  }, []);

  const loadOlder = useCallback(() => {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    send<Page>(`/api/items/${itemId}/entries?before=${encodeURIComponent(cursor)}`, "GET")
      .then((d) => {
        setEntries((prev) => mergeEntries(prev ?? [], d.entries));
        setCursor(d.hasMore ? d.before : null);
      })
      .catch((e) => setError(errText(e, "Couldn't load older entries")))
      .finally(() => setLoadingOlder(false));
  }, [cursor, loadingOlder, itemId]);

  return useMemo(
    () => ({ itemId, entries, error, apply, hasMore: cursor !== null, loadingOlder, loadOlder }),
    [itemId, entries, error, apply, cursor, loadingOlder, loadOlder],
  );
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

// ── Browser drafts, read hydration-safely ───────────────────────────────────

const DRAFTS_EVENT = "mykan:drafts";

function subscribeDrafts(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(DRAFTS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(DRAFTS_EVENT, onChange);
  };
}

/**
 * The raw stored draft under `key`. Null on the server and during hydration
 * (no localStorage read in the server render), then the real value; re-read
 * on every render and whenever a draft is forgotten.
 */
function useStoredDraft(key: string): string | null {
  return useSyncExternalStore(
    subscribeDrafts,
    () => browserDraftStore().get(key),
    () => null,
  );
}

/** Forget one stored draft and let every prompt re-read storage. */
function forgetDraft(key: string) {
  browserDraftStore().remove(key);
  window.dispatchEvent(new Event(DRAFTS_EVENT));
}

type Leftover = Pick<PendingRestore<EntryDraftFields>, "startedAt" | "stale">;

/**
 * A leftover draft for one editor, from its raw stored value: an offer, or null.
 * `forget` is true when the draft should just be dropped (its save or post
 * already landed).
 */
function leftoverOf(
  t: EntryDraftTarget,
  raw: string | null,
  stored: string,
  entries: ItemEntry[] | null,
): { offer: Leftover | null; forget: boolean } {
  if (!raw) return { offer: null, forget: false };
  const key = entryDraftKey(t);
  const store: DraftStore = { get: (k) => (k === key ? raw : null), set() {}, remove() {} };
  const draft = readFieldDraft(store, key);
  if (!draft) return { offer: null, forget: false };
  if (t.kind !== "edit") {
    // Wait for the entries before deciding a composer's draft didn't land.
    if (!entries) return { offer: null, forget: false };
    if (composerDraftLanded(t, draft, entries)) return { offer: null, forget: true };
  }
  const d = restoreDecision<EntryDraftFields>({ body: draft }, { body: stored });
  if (d.kind === "clear") return { offer: null, forget: true };
  if (d.kind !== "offer") return { offer: null, forget: false };
  return { offer: { startedAt: d.startedAt, stale: d.stale }, forget: false };
}

/** useStoredDraft + leftoverOf, forgetting drafts that already landed. */
function useLeftover(t: EntryDraftTarget, stored: string, entries: ItemEntry[] | null, enabled: boolean) {
  const key = entryDraftKey(t);
  const raw = useStoredDraft(key);
  const { offer, forget } = useMemo(
    () => (enabled ? leftoverOf(t, raw, stored, entries) : { offer: null, forget: false }),
    // t is described by key.
    [enabled, raw, stored, entries, key], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    if (forget) forgetDraft(key);
  }, [forget, key]);
  return offer;
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
      {api.entries && g.current.length === 0 ? <Empty>No progress notes yet.</Empty> : null}
      <EntryList rows={g.current} ctx={ctx} />
      <Collapsed title="Superseded" rows={g.superseded} ctx={ctx} />
      <Collapsed title="Deleted" rows={g.deleted} ctx={ctx} />
      <LoadOlder api={api} />
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
      <LoadOlder api={api} />
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

function LoadOlder({ api }: { api: EntriesApi }) {
  if (!api.hasMore) return null;
  return (
    <button
      type="button"
      onClick={api.loadOlder}
      disabled={api.loadingOlder}
      className="self-center rounded-md px-2.5 py-1 text-xs text-[var(--color-muted)] ring-1 ring-inset ring-[var(--color-line-strong)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)] disabled:opacity-50"
    >
      {api.loadingOlder ? "Loading…" : "Load older entries"}
    </button>
  );
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

  const deleted = !!entry.deleted_at;
  const canAnswer = !deleted && entry.kind === "question" && entry.state === "open";
  const canSupersede = !deleted && entry.kind === "decision" && entry.state === "active";

  // Leftover drafts for this entry's editors (from an earlier visit), offered
  // right in the row without opening an editor. Each resolves on its own.
  const editT = useMemo<EntryDraftTarget>(() => ({ kind: "edit", entryId: entry.id }), [entry.id]);
  const answerT = useMemo<EntryDraftTarget>(() => ({ kind: "answer", questionId: entry.id }), [entry.id]);
  const supersedeT = useMemo<EntryDraftTarget>(() => ({ kind: "supersede", entryId: entry.id }), [entry.id]);
  const closed = mode === null;
  const leftovers = [
    { mode: "edit" as const, target: editT, what: "edit to this entry", offer: useLeftover(editT, entry.body, api.entries, closed && !deleted) },
    { mode: "answer" as const, target: answerT, what: "answer to this question", offer: useLeftover(answerT, "", api.entries, closed && canAnswer) },
    { mode: "supersede" as const, target: supersedeT, what: "replacement for this decision", offer: useLeftover(supersedeT, "", api.entries, closed && canSupersede) },
  ].filter((l) => l.offer);

  // The open editor's finish, and which open it belongs to: switching to
  // another editor first finishes the open one (a failed save stays in it),
  // and a late finish of an earlier open never closes a newer one.
  const current = useRef<Finisher | null>(null);
  const opens = useRef(0);
  const [openId, setOpenId] = useState(0);

  async function open(m: Mode, restore = false) {
    const f = current.current;
    if (f && !(await f())) return; // the open editor shows why; nothing lost
    opens.current += 1;
    setOpenId(opens.current);
    setError(null);
    setAutoRestore(restore);
    setMode(m);
  }
  const doneFor = (id: number) => () => {
    if (opens.current !== id) return;
    setMode(null);
    setAutoRestore(false);
  };

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
  const onDone = doneFor(openId);

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
                <IconButton
                  label="Answer this question"
                  onClick={() => void open(mode === "answer" ? null : "answer")}
                  active={mode === "answer"}
                >
                  <path d="M9 14 4 9l5-5" />
                  <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
                </IconButton>
              ) : null}
              {canSupersede ? (
                <IconButton
                  label="Supersede with a new decision"
                  onClick={() => void open(mode === "supersede" ? null : "supersede")}
                  active={mode === "supersede"}
                >
                  <path d="m17 2 4 4-4 4" />
                  <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
                  <path d="m7 22-4-4 4-4" />
                  <path d="M21 13v1a4 4 0 0 1-4 4H3" />
                </IconButton>
              ) : null}
              {mode !== "edit" ? (
                <IconButton label="Edit this entry" onClick={() => void open("edit")}>
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                </IconButton>
              ) : null}
              <IconButton
                label="Delete this entry"
                onClick={() => void remove()}
                disabled={busy || mode === "edit"}
                danger
              >
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              </IconButton>
            </>
          )}
          <IconButton
            label={history ? "Hide history" : "History of this entry"}
            onClick={() => setHistory((h) => !h)}
            active={history}
          >
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 7.5V12l3 2" />
          </IconButton>
        </span>
      </div>

      {leftovers.map((l) => (
        <div key={l.mode} className="mt-1.5">
          <DraftPrompt
            restore={l.offer!}
            what={l.what}
            staleNote={
              l.mode === "edit"
                ? "This entry changed since then. Restoring replaces the newer text when you save."
                : null
            }
            onRestore={() => void open(l.mode, true)}
            onDiscard={() => forgetDraft(entryDraftKey(l.target))}
          />
        </div>
      ))}

      <div className="mt-1">
        {mode === "edit" ? (
          <DraftEditor
            key={openId}
            target={editT}
            opened={entry.body}
            baseUpdatedAt={entry.updated_at}
            isNew={false}
            autoRestore={autoRestore}
            finishRef={current}
            label="Edit entry text"
            onDone={onDone}
            commit={async (body, keepalive, editSession) => {
              api.apply(
                await send<ItemEntry>(
                  entryUrl(entry),
                  "PATCH",
                  { body, edit_session: editSession },
                  keepalive,
                ),
              );
            }}
          />
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
          <AnswerComposer
            key={openId}
            question={entry}
            target={answerT}
            ctx={ctx}
            autoRestore={autoRestore}
            finishRef={current}
            onDone={onDone}
          />
        </div>
      ) : null}
      {mode === "supersede" ? (
        <div className="mt-2 border-t border-[var(--color-line)] pt-2">
          <DraftEditor
            key={openId}
            target={supersedeT}
            opened=""
            isNew
            autoRestore={autoRestore}
            finishRef={current}
            label="The new decision that replaces this one"
            placeholder="The new decision that replaces this one"
            submitLabel="Supersede"
            onDone={onDone}
            commit={async (body, keepalive) => {
              const r = await send<{ superseded: ItemEntry; entry: ItemEntry }>(
                entryUrl(entry, "/supersede"),
                "POST",
                { body },
                keepalive,
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

// ── The one entry editor: save on finish (KANBAN-42) ────────────────────────

/**
 * Every entry editor, for an existing entry (`isNew` false) and for new ones
 * (a progress note, question, decision, an answer, a superseding decision).
 * Both follow the card body's model exactly (David, 2026-09-17):
 *
 * - Nothing is written while typing; the text is a browser draft under its own
 *   key (entryDraftScope), so several editors can be open at once.
 * - Esc, ⌘/Ctrl+Enter, a press outside the editor, the Add button, or leaving
 *   the page (it registers with the card page's finishers) writes ONCE: a PATCH
 *   (with the open's edit_session) or a POST. A new entry left empty or
 *   whitespace writes nothing and just closes. An existing entry can't be
 *   emptied ("abandon to keep the old text").
 * - The abandon icon discards the draft, no write.
 * - A failed write keeps the editor open with the text ("Esc to retry").
 * - Tab close / reload finishes with a keepalive request; while a write is in
 *   flight nothing else is sent, so one edit is one version and one post.
 */
function DraftEditor({
  target,
  opened,
  baseUpdatedAt = null,
  isNew,
  autoRestore,
  finishRef,
  label,
  placeholder,
  submitLabel,
  onDone,
  commit,
  discardRef,
  children,
}: {
  target: EntryDraftTarget;
  opened: string;
  baseUpdatedAt?: string | null;
  isNew: boolean;
  autoRestore: boolean;
  /** Set to this editor's finish while mounted (the entry row awaits it). */
  finishRef?: MutableRefObject<Finisher | null>;
  label: string;
  placeholder?: string;
  submitLabel?: string;
  onDone: () => void;
  commit: (body: string, keepalive: boolean, editSession: string) => Promise<void>;
  /** Set to "discard this draft without writing or closing" while mounted. */
  discardRef?: MutableRefObject<(() => void) | null>;
  /** Extra controls inside the editor (presses there aren't click-offs). */
  children?: ReactNode;
}) {
  const draft = useAbandonable<EntryDraftFields>({
    opened: { body: opened },
    ...entryDraftScope(target),
    baseUpdatedAt,
    restoreOnOpen: autoRestore,
  });
  const { session, set, close, abandon, restore, applyRestore, discardRestore } = draft;

  const editSession = useRef("");
  useEffect(() => {
    editSession.current = crypto.randomUUID();
  }, []);
  const root = useRef<HTMLDivElement>(null);
  const ended = useRef(false);
  // Typed since opening: only then may an unmount write (a StrictMode
  // remount of an editor opened with a restored draft must not post it).
  const typed = useRef(false);
  const closing = useRef<Promise<boolean> | null>(null);
  const restorePending = useRef(restore !== null);
  useEffect(() => {
    restorePending.current = restore !== null;
  }, [restore]);
  const latest = useRef({ commit, onDone });
  useEffect(() => {
    latest.current = { commit, onDone };
  });
  const [invalid, setInvalid] = useState<string | null>(null);

  const finish = useCallback(
    (keepalive = false): Promise<boolean> => {
      if (ended.current) return Promise.resolve(true);
      if (closing.current) return closing.current;
      const body = session.values.body;
      if (isNew && entryTextLength(body) === 0 && !restorePending.current) {
        // Nothing to add: close, and drop a whitespace-only draft.
        ended.current = true;
        abandon();
        latest.current.onDone();
        return Promise.resolve(true);
      }
      if (session.patch()) {
        const err = entryLengthError(body);
        if (err) {
          setInvalid(
            entryTextLength(body) === 0 ? "Text is required. Abandon changes to keep the old text." : err,
          );
          return Promise.resolve(false);
        }
      }
      setInvalid(null);
      const p = close((patch) =>
        latest.current.commit(patch.body ?? body, keepalive, editSession.current),
      ).then((ok) => {
        closing.current = null;
        if (ok) {
          ended.current = true;
          latest.current.onDone();
        }
        return ok;
      });
      closing.current = p;
      return p;
    },
    [session, isNew, abandon, close],
  );
  useRegisterFinisher(finish);
  const finishLatest = useRef(finish);
  useEffect(() => {
    finishLatest.current = finish;
    if (!finishRef) return;
    finishRef.current = finish;
    return () => {
      if (finishRef.current === finish) finishRef.current = null;
    };
  }, [finish, finishRef]);

  const discard = useCallback(() => {
    ended.current = true;
    abandon();
  }, [abandon]);
  useEffect(() => {
    if (!discardRef) return;
    discardRef.current = discard;
    return () => {
      discardRef.current = null;
    };
  }, [discard, discardRef]);
  const onAbandon = useCallback(() => {
    discard();
    latest.current.onDone();
  }, [discard]);

  // Click-off: a press outside this editor finishes it.
  useEffect(() => {
    function onDown(e: PointerEvent) {
      const el = root.current;
      const t = e.target as Node | null;
      if (!el || !t || el.contains(t)) return;
      if (t instanceof Element && t.closest("[data-keep-draft]")) return;
      void finishLatest.current();
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  // Leaving: tab close / reload finishes with keepalive. An unmount that
  // wasn't preceded by a finish (browser Back) does the same, but only for
  // text typed in this open. finish() never sends while a write is in flight.
  useEffect(() => {
    function onPageHide() {
      if (!ended.current && session.patch()) trackPendingSave(finishLatest.current(true));
    }
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      if (!ended.current && typed.current && session.patch()) {
        trackPendingSave(finishLatest.current(true));
      }
    };
  }, [session]);

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
  const failed = draft.status === "failed";
  const status =
    draft.status === "saving"
      ? isNew
        ? "Adding…"
        : "Saving…"
      : failed
        ? `${isNew ? "Not added" : "Save failed"}${draft.error ? ` (${draft.error})` : ""}. Nothing lost. Esc to retry.`
        : (invalid ?? (!isNew && draft.dirty ? "Unsaved · Esc or click away to save" : null));

  return (
    <div ref={root} onKeyDown={onKeyDown} className="flex flex-col gap-1.5">
      {restore ? (
        <DraftPrompt
          restore={restore}
          what={isNew ? "draft here" : "edit to this entry"}
          staleNote={
            isNew ? null : "This entry changed since then. Restoring replaces the newer text when you save."
          }
          onRestore={applyRestore}
          onDiscard={discardRestore}
          autoFocus
        />
      ) : null}
      <div inert={restore ? true : undefined} className={restore ? "opacity-60" : ""}>
        <AutoGrowTextarea
          value={body}
          onChange={(e) => {
            typed.current = true;
            set("body", e.target.value);
          }}
          aria-label={label}
          placeholder={placeholder}
          autoFocus={!restore}
          maxHeight={320}
          className="rounded-md border border-[var(--color-line-strong)] bg-[var(--color-canvas)] px-2 py-1.5 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
        />
      </div>
      <EditorFooter
        count={entryTextLength(body)}
        status={status}
        failed={failed || invalid !== null}
        hint={`Enter for newline · Esc, ⌘/Ctrl+Enter or click away to ${isNew ? "add" : "save"}`}
      >
        <span data-keep-draft className="inline-flex">
          <AbandonButton
            onAbandon={onAbandon}
            size="sm"
            label={isNew ? "Discard this draft" : "Abandon changes"}
            disabled={draft.status === "saving"}
          />
        </span>
        {submitLabel ? (
          <button
            type="button"
            onClick={() => void finish()}
            disabled={draft.status === "saving" || restore !== null}
            className="rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitLabel}
          </button>
        ) : null}
      </EditorFooter>
      {children}
    </div>
  );
}

/** A collapsed "+ Add …" button that opens an editor for a new entry. */
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
  const [opens, setOpens] = useState(0);
  const target = useMemo<EntryDraftTarget>(() => ({ kind: "new", itemId, entryKind: kind }), [itemId, kind]);
  const leftover = useLeftover(target, "", api.entries, !open);

  const show = (restore: boolean) => {
    setAutoRestore(restore);
    setOpens((n) => n + 1);
    setOpen(true);
  };

  if (!open) {
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => show(false)}
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
            onRestore={() => show(true)}
            onDiscard={() => forgetDraft(entryDraftKey(target))}
          />
        ) : null}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-[var(--color-line)] p-2">
      <DraftEditor
        key={opens}
        target={target}
        opened=""
        isNew
        autoRestore={autoRestore}
        label={placeholder}
        placeholder={placeholder}
        submitLabel={kind === "progress" ? "Add note" : kind === "question" ? "Ask" : "Record"}
        onDone={() => setOpen(false)}
        commit={async (body, keepalive) => {
          api.apply(
            await send<ItemEntry>(`/api/items/${itemId}/entries`, "POST", { kind, body }, keepalive),
          );
        }}
      />
    </div>
  );
}

/**
 * Answer an open question: write a new decision (recorded and linked on
 * finish, like any new entry), or link one of the card's active decisions.
 */
function AnswerComposer({
  question,
  target,
  ctx,
  autoRestore,
  finishRef,
  onDone,
}: {
  question: ItemEntry;
  target: EntryDraftTarget;
  ctx: Ctx;
  autoRestore: boolean;
  finishRef: MutableRefObject<Finisher | null>;
  onDone: () => void;
}) {
  const [linking, setLinking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const discardRef = useRef<(() => void) | null>(null);

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
      discardRef.current?.();
      onDone();
    } catch (e) {
      setError(errText(e, "Link failed"));
    } finally {
      setLinking(null);
    }
  }

  return (
    <DraftEditor
      target={target}
      opened=""
      isNew
      autoRestore={autoRestore}
      finishRef={finishRef}
      label="The decision that answers this question"
      placeholder="The decision that answers this question"
      submitLabel="Record decision"
      onDone={onDone}
      discardRef={discardRef}
      commit={async (body, keepalive) => {
        const r = await send<{ question: ItemEntry; decision: ItemEntry }>(
          entryUrl(question, "/answer"),
          "POST",
          { body },
          keepalive,
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
    </DraftEditor>
  );
}

// ── Shared editor pieces ────────────────────────────────────────────────────

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
  restore: Leftover;
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
