"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { STATUS_LABEL, type ItemStatus } from "@/lib/types";
import {
  ageLabel,
  capError,
  describeReason,
  entryTitle,
  entryStatus,
  typeLetter,
  typeTip,
  type FocusEntryView,
  type FocusHistoryEntry,
  type FocusSettings,
  type ReviewReason,
} from "@/lib/focus-rules";
import { announceFocusChange, onFocusChange } from "@/lib/focus-events";

/**
 * The focus list on the home page (KANBAN-76/77/78): the signed-in person's own
 * ranked list of the cards that matter now, across every project. Rendered only
 * when their focus list is on (the page decides). Drag (or grip + Space/arrows)
 * to rank, tick to finish, × to drop, pencil to edit the why-now line, and the
 * add box picks an existing card or quick-adds a personal one.
 */

type View = {
  enabled: true;
  settings: FocusSettings;
  entries: FocusEntryView[];
  history: FocusHistoryEntry[];
  reasons: ReviewReason[];
  review_due: boolean;
};

type Candidate = { item_id: string; ref: string; title: string; type: string; status: string; project: string };

type Option =
  | { kind: "card"; c: Candidate }
  | { kind: "new"; text: string };

const iconBtn =
  "grid h-7 w-7 shrink-0 place-items-center rounded text-[var(--color-faint)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-ink)]";

async function call(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data;
}

export function FocusList({ className = "mb-8" }: { className?: string } = {}) {
  // Unique per mount: Home and the top-bar overlay (KANBAN-84) can both show it.
  const uid = useId();
  const headingId = `${uid}-heading`;
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  const apply = useCallback((d: unknown) => {
    const v = d as View | { enabled: false };
    setView(v.enabled ? v : null);
    setNow(new Date());
    setError(null);
  }, []);

  const load = useCallback(async () => {
    try {
      apply(await call("/api/focus"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [apply]);

  useEffect(() => {
    let cancelled = false;
    call("/api/focus")
      .then((d) => !cancelled && apply(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [apply]);

  // Another view (the overlay, Home, a row or card target) changed the list.
  useEffect(() => onFocusChange(uid, () => void load()), [uid, load]);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await fn();
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        await load();
        setBusy(false);
        announceFocusChange(uid);
      }
    },
    [load, uid],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    if (!view || !e.over || e.active.id === e.over.id) return;
    const ids = view.entries.map((x) => x.id);
    const from = ids.indexOf(String(e.active.id));
    const to = ids.indexOf(String(e.over.id));
    if (from < 0 || to < 0) return;
    const entries = arrayMove(view.entries, from, to);
    setView({ ...view, entries }); // show the drop at once
    void act(() => call("/api/focus/order", { method: "PUT", body: JSON.stringify({ order: entries.map((x) => x.id) }) }));
  }

  if (!view) {
    return error ? (
      <p role="alert" className="mb-6 text-xs text-[var(--color-bug)]">
        Focus list: {error}
      </p>
    ) : (
      <section aria-label="Focus list" className="mb-6 h-24 animate-pulse rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]" />
    );
  }

  const { entries, settings, reasons, history } = view;
  const full = capError(entries.length, settings.max_entries);

  return (
    <section aria-labelledby={headingId} className={className}>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 id={headingId} className="text-sm font-medium text-[var(--color-muted)]">
          Focus
        </h2>
        <span className="text-[11px] text-[var(--color-faint)]" title="Entries on your list, and your maximum">
          {entries.length} of {settings.max_entries}
        </span>
      </div>

      {reasons.length ? (
        <div
          role="status"
          className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] px-3 py-2 text-sm"
        >
          <span className="font-medium text-[var(--color-accent-ink)]">Review your priorities</span>
          <span className="min-w-0 flex-1 text-[var(--color-muted)]">{reasons.map(describeReason).join(" · ")}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => call("/api/focus/review", { method: "POST" }))}
            className="rounded border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-2.5 py-1 text-xs font-medium text-[var(--color-ink)] transition-colors hover:border-[var(--color-accent)] disabled:opacity-50"
            title="Keep the list as it is until the next review"
          >
            Confirm as is
          </button>
        </div>
      ) : null}

      <div className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)]">
        {entries.length === 0 ? (
          <p className="px-3 py-4 text-sm text-[var(--color-faint)]">
            Nothing on your focus list yet. Add the cards that matter most right now, from any project, or type
            something new.
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={entries.map((e) => e.id)} strategy={verticalListSortingStrategy}>
              <ol className="divide-y divide-[var(--color-line)]">
                {entries.map((e, i) => (
                  <FocusRow
                    key={e.id}
                    entry={e}
                    rank={i + 1}
                    now={now}
                    busy={busy}
                    sortable={entries.length > 1}
                    onComplete={() =>
                      void act(() => call(`/api/focus/entries/${e.id}`, { method: "PATCH", body: JSON.stringify({ complete: true }) }))
                    }
                    onDrop={() => void act(() => call(`/api/focus/entries/${e.id}`, { method: "DELETE" }))}
                    onEdit={(patch) =>
                      void act(() => call(`/api/focus/entries/${e.id}`, { method: "PATCH", body: JSON.stringify(patch) }))
                    }
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
        <div className="border-t border-[var(--color-line)] px-3 py-2">
          {full ? (
            <p className="text-xs text-[var(--color-muted)]">
              Your list is full ({entries.length} of {settings.max_entries}). Tick off or drop an entry (✓ or × on its
              row) before adding another.
            </p>
          ) : (
            <AddBox
              taken={new Set(entries.map((e) => e.item_id))}
              busy={busy}
              onAdd={(body) => act(() => call("/api/focus", { method: "POST", body: JSON.stringify(body) }))}
            />
          )}
        </div>
      </div>

      {error ? (
        <p role="alert" className="mt-1 text-xs text-[var(--color-bug)]">
          {error}
        </p>
      ) : null}

      {history.length ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowHistory((s) => !s)}
            aria-expanded={showHistory}
            className="text-[11px] text-[var(--color-faint)] transition-colors hover:text-[var(--color-ink)]"
          >
            {showHistory ? "Hide" : "Show"} recently finished ({history.length})
          </button>
          {showHistory ? (
            <ul className="mt-1 flex flex-col gap-0.5 text-xs">
              {history.map((h) => (
                <li key={h.id} className="flex items-center gap-2 text-[var(--color-muted)]">
                  <span className="w-16 shrink-0 text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
                    {h.completed_at ? "Done" : "Dropped"}
                  </span>
                  {h.url ? (
                    <a href={h.url.replace(/^https?:\/\/[^/]+/, "")} className="font-mono text-[11px] text-[var(--color-faint)] hover:text-[var(--color-ink)]">
                      {h.ref}
                    </a>
                  ) : (
                    <span className="font-mono text-[11px] text-[var(--color-faint)]">no access</span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{entryTitle(h) ?? ""}</span>
                  <span
                    className="shrink-0 text-[10px] text-[var(--color-faint)]"
                    title="How long it was on your list, and when it left"
                  >
                    {now ? `${listedFor(h)} on list · ${ageLabel(h.completed_at ?? h.removed_at, now)} ago`.replace("today ago", "today") : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/** "3d" — whole days an entry spent on the list (at least "<1d"). */
function listedFor(h: FocusHistoryEntry): string {
  const end = Date.parse(h.completed_at ?? h.removed_at ?? h.added_at);
  const days = Math.floor((end - Date.parse(h.added_at)) / 86_400_000);
  return days < 1 ? "<1d" : `${days}d`;
}

function FocusRow({
  entry: e,
  rank,
  now,
  busy,
  sortable,
  onComplete,
  onDrop,
  onEdit,
}: {
  entry: FocusEntryView;
  rank: number;
  now: Date | null;
  busy: boolean;
  sortable: boolean;
  onComplete: () => void;
  onDrop: () => void;
  onEdit: (patch: { label?: string; why_now?: string }) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: e.id, disabled: !sortable });
  const [editing, setEditing] = useState(false);
  const shown = entryTitle(e) ?? "";
  const status = entryStatus(e);
  const [titleDraft, setTitleDraft] = useState(shown);
  const [draft, setDraft] = useState(e.why_now ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLDivElement>(null);
  const label = e.ref ?? "this entry";
  const path = e.url ? e.url.replace(/^https?:\/\/[^/]+/, "") : null;
  // The entry's own title can differ from the card's (KANBAN-82).
  const renamed = !!e.label && e.label !== e.title;

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // One save on Enter, Esc or click-off (focus leaving both fields), only for
  // what changed (DESIGN.md). The title is the entry's own: the card is never
  // touched; an empty title goes back to the card's.
  function finish() {
    setEditing(false);
    const patch: { label?: string; why_now?: string } = {};
    const t = titleDraft.replace(/\s+/g, " ").trim();
    if (t !== shown) patch.label = t === (e.title ?? "") ? "" : t;
    if (draft.trim() !== (e.why_now ?? "")) patch.why_now = draft.trim();
    if (Object.keys(patch).length) onEdit(patch);
  }
  const keys = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "Enter" || ev.key === "Escape") {
      ev.preventDefault();
      finish();
    }
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-start gap-2 px-2 py-2 ${isDragging ? "relative z-10 bg-[var(--color-surface)] opacity-70 shadow" : ""}`}
    >
      {sortable ? (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag to reorder ${label}`}
          className="mt-0.5 grid h-6 w-4 shrink-0 cursor-grab touch-none place-items-center text-[var(--color-faint)] transition-colors hover:text-[var(--color-muted)] active:cursor-grabbing"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="9" cy="6" r="1.4" />
            <circle cx="15" cy="6" r="1.4" />
            <circle cx="9" cy="12" r="1.4" />
            <circle cx="15" cy="12" r="1.4" />
            <circle cx="9" cy="18" r="1.4" />
            <circle cx="15" cy="18" r="1.4" />
          </svg>
        </button>
      ) : (
        <span className="w-4 shrink-0" aria-hidden="true" />
      )}
      <span className="mt-0.5 w-5 shrink-0 text-right text-sm font-semibold tabular-nums text-[var(--color-accent)]">{rank}</span>
      <TypeLetter e={e} className="mt-[5px]" />

      <div className="min-w-0 flex-1">
        {e.visible && editing ? (
          <div
            ref={editRef}
            className="flex flex-col gap-1"
            onBlur={(ev) => {
              if (!editRef.current?.contains(ev.relatedTarget as Node | null)) finish();
            }}
          >
            <input
              ref={inputRef}
              value={titleDraft}
              maxLength={200}
              onChange={(ev) => setTitleDraft(ev.target.value)}
              onKeyDown={keys}
              placeholder={e.title ?? "Title on your focus list"}
              aria-label={`Focus title for ${label} (the card is not changed)`}
              className="w-full rounded border border-[var(--color-line)] bg-transparent px-2 py-1 text-sm outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
            />
            <input
              value={draft}
              maxLength={200}
              onChange={(ev) => setDraft(ev.target.value)}
              onKeyDown={keys}
              placeholder="Why this, why now? (one line)"
              aria-label={`Why now for ${label}`}
              className="w-full rounded border border-[var(--color-line)] bg-transparent px-2 py-1 text-xs outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
            />
            <span className="text-[10px] text-[var(--color-faint)]">
              {`Your wording here only; ${e.ref} keeps its own title. Clear the title to use the card's.`}
            </span>
          </div>
        ) : e.visible ? (
          <div className="flex min-w-0 items-baseline gap-x-2">
            <a
              href={path ?? "#"}
              title={renamed ? `Open ${e.ref}: ${e.title}` : `Open ${e.ref}`}
              className="shrink-0 font-mono text-[11px] text-[var(--color-faint)] hover:text-[var(--color-ink)]"
            >
              {e.ref}
            </a>
            <a
              href={path ?? "#"}
              title={shown}
              className="min-w-0 flex-1 truncate text-sm text-[var(--color-ink)] hover:underline"
            >
              {shown}
            </a>
          </div>
        ) : (
          <p className="text-sm italic text-[var(--color-faint)]">No access: you can no longer see this card.</p>
        )}
        {e.visible ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-[var(--color-faint)]">
            {e.personal ? <span className="rounded bg-[var(--color-canvas)] px-1.5">Personal</span> : null}
            {status ? <span className="uppercase tracking-wider">{STATUS_LABEL[status as ItemStatus] ?? status}</span> : null}
            {e.progress ? <span title="Epic cards done">{e.progress.done}/{e.progress.total} done</span> : null}
            {e.open_questions ? (
              <span className="text-[var(--color-accent-ink)]" title="Open questions on the card">
                {e.open_questions} open {e.open_questions === 1 ? "question" : "questions"}
              </span>
            ) : null}
            {now && e.last_moved_at ? (
              <span
                className={e.stale ? "font-medium text-[var(--color-bug)]" : ""}
                title={e.stale ? "Nothing on this card has moved for a while" : "Last moved"}
              >
                {e.stale ? "idle " : "moved "}
                {ageLabel(e.last_moved_at, now)}
              </span>
            ) : null}
            {e.target_date ? <span title="Target date">by {e.target_date}</span> : null}
          </div>
        ) : null}
        {editing ? null : e.why_now ? (
          <p className="mt-0.5 text-xs text-[var(--color-muted)]">{e.why_now}</p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center">
        <button
          type="button"
          disabled={busy || !e.visible}
          onClick={() => {
            setTitleDraft(entryTitle(e) ?? "");
            setDraft(e.why_now ?? "");
            setEditing(true);
          }}
          title="Edit title and why now"
          aria-label={`Edit the focus title and why now for ${label}`}
          className={iconBtn}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onComplete}
          title="Tick off"
          aria-label={`Tick off ${label}`}
          className={`${iconBtn} hover:text-[var(--color-feature)]`}
        >
          <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDrop}
          title="Drop from list"
          aria-label={`Drop ${label} from your focus list`}
          className={`${iconBtn} hover:text-[var(--color-bug)]`}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18" />
            <path d="M6 6l12 12" />
          </svg>
        </button>
      </div>
    </li>
  );
}

/**
 * Add an existing card or quick-add a new personal one. A typeahead overlay:
 * opens on focus, filters as you type (ref, title, project), ↑/↓ move, Enter
 * adds the highlighted option, Esc closes (a second Esc clears), Tab moves on,
 * a press outside closes. The last option, once you type, is "add as a new
 * personal card".
 */
function AddBox({
  taken,
  busy,
  onAdd,
}: {
  taken: Set<string>;
  busy: boolean;
  onAdd: (body: { item?: string; text?: string }) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || cands) return;
    call("/api/focus/candidates")
      .then((d) => setCands(d as Candidate[]))
      .catch((e: Error) => setLoadErr(e.message));
  }, [open, cands]);

  useEffect(() => {
    if (!open) return;
    function onDown(ev: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(ev.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const options = useMemo<Option[]>(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (cands ?? [])
      .filter((c) => !taken.has(c.item_id) && c.status !== "done")
      .filter((c) => {
        const hay = `${c.ref} ${c.title} ${c.project}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      })
      .slice(0, 50)
      .map((c): Option => ({ kind: "card", c }));
    const text = q.replace(/\s+/g, " ").trim();
    return text ? [...matches, { kind: "new", text }] : matches;
  }, [cands, q, taken]);

  const hiClamped = Math.min(hi, Math.max(options.length - 1, 0));

  async function choose(o: Option | undefined) {
    if (!o) return;
    setOpen(false);
    setQ("");
    setHi(0);
    await onAdd(o.kind === "card" ? { item: o.c.ref } : { text: o.text });
    inputRef.current?.focus();
  }

  function onKeyDown(ev: KeyboardEvent<HTMLInputElement>) {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setOpen(true);
      setHi((h) => Math.min(h + 1, options.length - 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      void choose(options[hiClamped]);
    } else if (ev.key === "Escape") {
      // Close, then clear; an Esc with nothing left to undo is left alone so
      // the top-bar overlay (KANBAN-84) can close on it.
      if (open) {
        ev.preventDefault();
        setOpen(false);
      } else if (q) {
        ev.preventDefault();
        setQ("");
      }
    } else if (ev.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-center gap-2">
        <svg className="h-4 w-4 shrink-0 text-[var(--color-faint)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
        <input
          ref={inputRef}
          value={q}
          disabled={busy}
          onChange={(ev) => {
            setQ(ev.target.value);
            setOpen(true);
            setHi(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Add a card, or type something new…"
          aria-label="Add to your focus list"
          role="combobox"
          aria-expanded={open}
          aria-controls="focus-add-options"
          aria-autocomplete="list"
          className="min-w-0 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-[var(--color-faint)]"
        />
        {q ? (
          <button
            type="button"
            onClick={() => {
              setQ("");
              inputRef.current?.focus();
            }}
            title="Clear"
            aria-label="Clear"
            className={iconBtn}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>
      {open ? (
        <ul
          id="focus-add-options"
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] py-1 text-sm shadow-lg"
        >
          {loadErr ? <li className="px-3 py-1.5 text-xs text-[var(--color-bug)]">{loadErr}</li> : null}
          {!cands && !loadErr ? <li className="px-3 py-1.5 text-xs text-[var(--color-faint)]">Loading cards…</li> : null}
          {cands && options.length === 0 ? (
            <li className="px-3 py-1.5 text-xs text-[var(--color-faint)]">Type to find a card, or to add something new.</li>
          ) : null}
          {options.map((o, i) => (
            <li
              key={o.kind === "card" ? o.c.item_id : "__new"}
              role="option"
              aria-selected={i === hiClamped}
              onPointerDown={(ev) => ev.preventDefault()}
              onClick={() => void choose(o)}
              onPointerEnter={() => setHi(i)}
              className={`flex cursor-pointer items-baseline gap-2 px-3 py-1.5 ${
                i === hiClamped ? "bg-[var(--color-accent-soft)]" : ""
              }`}
            >
              {o.kind === "card" ? (
                <>
                  <span className="w-20 shrink-0 font-mono text-[11px] text-[var(--color-faint)]">{o.c.ref}</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--color-ink)]">{o.c.title}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-[var(--color-faint)]">{o.c.project}</span>
                </>
              ) : (
                <span className="min-w-0 flex-1 truncate text-[var(--color-ink)]">
                  Add “{o.text}” as a new personal card
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The type column of a compact focus row (KANBAN-85): one letter, fixed width
 * so refs line up. Blank (but still taking its width) for a personal entry.
 */
export function TypeLetter({
  e,
  className = "",
}: {
  e: Pick<FocusEntryView, "type" | "personal" | "visible" | "progress">;
  className?: string;
}) {
  const letter = typeLetter(e);
  const name = typeTip(e);
  return (
    <span
      className={`w-3 shrink-0 text-center font-mono text-[11px] font-semibold text-[var(--color-muted)] ${className}`}
      title={name || undefined}
      aria-label={name || undefined}
    >
      {letter}
    </span>
  );
}
