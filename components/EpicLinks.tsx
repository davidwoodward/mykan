"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { itemRef } from "@/lib/format";
import {
  STATUS_LABEL,
  epicProgress,
  richDocTitle,
  type Item,
  type ItemStatus,
} from "@/lib/types";
import { useProjectKey } from "@/components/RefBadge";
import { linkSequentially, sortByStatusThenNumber, type LinkFailure } from "@/lib/epic-order";

/**
 * Epic parent/child links (KANBAN-41). The link lives on the child
 * (`item.parent_id`); everything here is derived from the project's items, so
 * the parent link on a child and the children list on its epic always agree.
 *
 * Where things live: board cards and list rows only SHOW a child's epic (a chip
 * that opens it) and an epic's "N/M done". Linking and unlinking — "Add parent",
 * "Remove parent", "Add child", remove-from-epic — live in the detail modal (and
 * the Add Item modal), so the board isn't cluttered with a link control on every
 * card.
 */
type EpicValue = {
  /** Every loaded item in the project (archived included), by id. */
  byId: Map<string, Item>;
  /** Every loaded item in the project, in board order. */
  all: Item[];
  /** Non-archived epics, the only valid NEW parents, by status then number. */
  epics: Item[];
  /** An epic's children, archived included, by status then number. */
  childrenOf: (epicId: string) => Item[];
  /** Open an item's detail modal. */
  open: (id: string) => void;
  /** Link (or clear with null) an item's parent epic. */
  setParent: (id: string, parentId: string | null) => void;
  /** Awaited link for batches: resolves to null on success, else the error. */
  linkParent: (id: string, parentId: string | null) => Promise<string | null>;
  /** Re-fetch the project's items so the UI shows the real state. */
  refresh: () => Promise<void>;
};

const EpicContext = createContext<EpicValue | null>(null);
export const EpicProvider = EpicContext.Provider;

/** Build the context value from the project's items. */
export function useEpicValue(
  items: Item[] | null,
  open: (id: string) => void,
  setParent: (id: string, parentId: string | null) => void,
  linkParent: (id: string, parentId: string | null) => Promise<string | null>,
  refresh: () => Promise<void>,
): EpicValue {
  return useMemo(() => {
    const all = [...(items ?? [])].sort((a, b) => a.position - b.position);
    const byId = new Map(all.map((it) => [it.id, it]));
    const kids = new Map<string, Item[]>();
    for (const it of all) {
      if (!it.parent_id) continue;
      const l = kids.get(it.parent_id) ?? [];
      l.push(it);
      kids.set(it.parent_id, l);
    }
    // Epic lists read status (board column order) then number, never position.
    for (const [id, l] of kids) kids.set(id, sortByStatusThenNumber(l));
    const epics = sortByStatusThenNumber(
      all.filter((it) => it.type === "epic" && !it.archived_at),
    );
    return {
      byId,
      all,
      epics,
      childrenOf: (id: string) => kids.get(id) ?? [],
      open,
      setParent,
      linkParent,
      refresh,
    };
  }, [items, open, setParent, linkParent, refresh]);
}

function useEpics(): EpicValue | null {
  return useContext(EpicContext);
}

function EpicIcon({ className = "h-3 w-3" }: { className?: string }) {
  // Stacked layers: an epic groups cards.
  return (
    <svg
      className={`shrink-0 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3 9 5-9 5-9-5 9-5z" />
      <path d="m3 13 9 5 9-5" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

/** "Unlink": a broken chain link. Used for remove-parent / remove-from-epic. */
function UnlinkIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.5 14.5 8 16a3 3 0 0 1-4.2-4.2L6 9.6" />
      <path d="M14.5 9.5 16 8a3 3 0 0 1 4.2 4.2L18 14.4" />
      <path d="m4 4 16 16" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function titleOf(it: Item): string {
  return richDocTitle(it.body) || "Untitled";
}

const iconBtn =
  "grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--color-faint)] transition-colors";

const actionBtn =
  "inline-flex items-center gap-1 rounded-md border border-[var(--color-line)] px-2 py-0.5 text-xs text-[var(--color-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent-ink)]";

/**
 * "N/M done" beside an epic's type badge on board cards and list rows. Counts
 * non-archived children only. Renders nothing for non-epics or epics with no
 * children.
 */
export function EpicProgress({ item, className = "" }: { item: Item; className?: string }) {
  const ctx = useEpics();
  if (!ctx || item.type !== "epic") return null;
  const { done, total } = epicProgress(ctx.childrenOf(item.id));
  if (total === 0) return null;
  return (
    <span
      className={`shrink-0 text-[11px] tabular-nums text-[var(--color-epic)] ${className}`}
      title={`${done} of ${total} child items done`}
    >
      {done}/{total} done
    </span>
  );
}

type Option = {
  id: string;
  ref: string;
  title: string;
  status: ItemStatus;
  note?: string;
};

/** Multi-select mode for ItemTypeahead (the epic's Add child picker). */
type MultiSelect = {
  /** Selected option ids (kept across filter changes). */
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Add these ids (the selection, or the highlighted row when none). */
  onCommit: (ids: string[]) => void;
  /** Progress text while a batch is running; interactions pause meanwhile. */
  busy: string | null;
  /** Per-card failures from the last batch, shown in the footer. */
  failures: { ref: string; error: string }[];
};

function CheckIcon() {
  return (
    <svg
      className="h-2.5 w-2.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m5 12 5 5 9-10" />
    </svg>
  );
}

/**
 * Item typeahead used by every epic link picker. Opens on focus (optionally
 * seeded with the current value's ref, selected so typing replaces it) and
 * filters by ref or title; ↑/↓ move, Enter picks the highlighted row, Esc closes
 * without changing anything (and without closing the modal underneath), Tab
 * moves on (blur closes, never picks). The list is an overlay; mouse and touch
 * pick with a press. Each option shows its status.
 *
 * With `multi`, each row carries a checkbox: click/tap toggles it, and Space
 * toggles the highlighted row while the filter is empty or right after ↑/↓
 * (otherwise Space types, since titles contain spaces). The typed filter stays
 * while selecting. Enter (or Cmd/Ctrl+Enter, or the footer's "Add N") adds the
 * selection; with nothing selected, Enter adds just the highlighted row. Tab
 * reaches the "Add N" button; the picker closes only when focus leaves it.
 */
function ItemTypeahead({
  options,
  seed = "",
  currentId = null,
  placeholder,
  label,
  emptyText,
  align = "left",
  onPick,
  onClose,
  multi,
}: {
  options: Option[];
  seed?: string;
  currentId?: string | null;
  placeholder: string;
  label: string;
  emptyText: string;
  /** Which edge of the input the overlay lines up with. */
  align?: "left" | "right";
  onPick: (id: string) => void;
  onClose: () => void;
  multi?: MultiSelect;
}) {
  const [draft, setDraft] = useState(seed);
  // True right after ↑/↓, so Space toggles instead of typing (multi only).
  const [navigated, setNavigated] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // After a batch settles with the picker still open (some cards failed), put
  // focus back in the field if the disabled Add button dropped it.
  const busyNow = multi?.busy ?? null;
  useEffect(() => {
    if (busyNow !== null) return;
    if (!wrapRef.current?.contains(document.activeElement)) inputRef.current?.focus();
  }, [busyNow]);

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    // The untouched seed shows every option (with the current one highlighted).
    if (!q || draft === seed) return options;
    return options.filter(
      (o) => o.ref.toLowerCase().includes(q) || o.title.toLowerCase().includes(q),
    );
  }, [draft, seed, options]);
  const [rawHi, setHi] = useState(() =>
    Math.max(0, options.findIndex((o) => o.id === currentId)),
  );
  // Clamp: the options can shrink under the cursor (a batch add, a refresh).
  const hi = Math.max(0, Math.min(rawHi, matches.length - 1));
  const busy = busyNow;
  const count = multi?.selected.size ?? 0;

  function move(n: number) {
    setHi(n);
    setNavigated(true);
    (listRef.current?.children?.[n] as HTMLElement | undefined)?.scrollIntoView({
      block: "nearest",
    });
  }

  function close() {
    if (!busy) onClose();
  }

  function commit() {
    if (!multi || busy) return;
    if (count > 0) multi.onCommit([...multi.selected]);
    else if (matches[hi]) multi.onCommit([matches[hi].id]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(Math.min(matches.length - 1, hi + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(Math.max(0, hi - 1));
    } else if (e.key === "Enter") {
      if (!multi && (e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      e.stopPropagation();
      if (multi) {
        commit();
      } else {
        const sel = matches[hi];
        if (sel) onPick(sel.id);
      }
    } else if (
      e.key === " " &&
      multi &&
      (navigated || draft.trim() === "") &&
      matches[hi]
    ) {
      e.preventDefault();
      if (!busy) multi.onToggle(matches[hi].id);
    }
  }

  return (
    <span
      ref={wrapRef}
      className="relative inline-block"
      // Close when focus leaves the whole picker (input and its Add button),
      // not when it moves between them.
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <input
        ref={inputRef}
        autoFocus
        value={draft}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setDraft(e.target.value);
          setHi(0);
          setNavigated(false);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={label}
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        className="w-52 rounded border border-[var(--color-line)] bg-transparent px-1.5 py-0.5 text-xs outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
      />
      <div
        className={`absolute top-full z-30 mt-1 w-96 max-w-[calc(100vw-2rem)] rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg ${
          align === "right" ? "right-0" : "left-0"
        }`}
      >
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          aria-multiselectable={multi ? true : undefined}
          className="max-h-60 overflow-y-auto overscroll-contain p-1"
        >
          {matches.length === 0 ? (
            <div className="px-2 py-1 text-xs text-[var(--color-faint)]">
              {options.length === 0 ? emptyText : "No matches"}
            </div>
          ) : (
            matches.map((m, i) => {
              const checked = multi?.selected.has(m.id) ?? false;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={multi ? checked : i === hi}
                  // onMouseDown (not onClick) so it fires before the input blur.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (!multi) onPick(m.id);
                    else if (!busy) {
                      setHi(i);
                      multi.onToggle(m.id);
                    }
                  }}
                  onMouseEnter={() => setHi(i)}
                  className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs ${
                    i === hi ? "bg-[var(--color-accent-soft)]" : ""
                  }`}
                >
                  {multi ? (
                    <span
                      aria-hidden="true"
                      className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm border ${
                        checked
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                          : "border-[var(--color-line-strong)]"
                      }`}
                    >
                      {checked ? <CheckIcon /> : null}
                    </span>
                  ) : null}
                  <span className="shrink-0 font-mono text-[11px] text-[var(--color-faint)]">
                    {m.ref}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[var(--color-ink)]">
                    {m.title}
                  </span>
                  {m.note ? (
                    <span className="shrink-0 text-[10px] text-[var(--color-epic)]">{m.note}</span>
                  ) : null}
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
                    {STATUS_LABEL[m.status]}
                  </span>
                </button>
              );
            })
          )}
        </div>
        {multi ? (
          <div className="border-t border-[var(--color-line)] px-2 py-1.5 text-xs">
            {multi.failures.length > 0 ? (
              <div role="alert" className="mb-1.5 text-[var(--color-bug)]">
                <p>
                  Couldn&apos;t add {multi.failures.length}{" "}
                  {multi.failures.length === 1 ? "card" : "cards"} (still selected):
                </p>
                <ul className="mt-0.5 flex flex-col gap-0.5">
                  {multi.failures.map((f) => (
                    <li key={f.ref}>
                      <span className="font-mono text-[11px]">{f.ref}</span>: {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[var(--color-faint)]" aria-live="polite">
                {busy ??
                  (count > 0
                    ? `${count} selected`
                    : "Click or Space to select · Enter adds")}
              </span>
              <button
                type="button"
                disabled={count === 0 || busy !== null}
                // Keep focus in the picker so a pointer press doesn't close it.
                onMouseDown={(e) => e.preventDefault()}
                onClick={commit}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    close();
                  }
                }}
                title={count > 0 ? `Add ${count} selected ${count === 1 ? "card" : "cards"}` : "Select cards to add"}
                aria-label={count > 0 ? `Add ${count} selected ${count === 1 ? "card" : "cards"}` : "Add selected cards"}
                className="shrink-0 rounded-md bg-[var(--color-accent)] px-2 py-0.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add {count > 0 ? count : ""}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </span>
  );
}

/** Picker over the project's non-archived epics, for choosing a parent. */
function ParentPicker({
  currentId,
  excludeId,
  onPick,
  onClose,
}: {
  currentId: string | null;
  /** The item being linked (never offered as its own parent). */
  excludeId?: string;
  onPick: (epicId: string) => void;
  onClose: () => void;
}) {
  const ctx = useEpics();
  const key = useProjectKey();
  const current = currentId ? ctx?.byId.get(currentId) : undefined;
  const options = useMemo(
    () =>
      (ctx?.epics ?? [])
        .filter((e) => e.id !== excludeId)
        .map((e) => ({
          id: e.id,
          ref: itemRef(key, e.number) ?? "",
          title: titleOf(e),
          status: e.status,
        })),
    [ctx, excludeId, key],
  );
  return (
    <ItemTypeahead
      options={options}
      seed={current ? (itemRef(key, current.number) ?? "") : ""}
      currentId={currentId}
      placeholder="Epic ref or title…"
      label="Parent epic"
      emptyText="No open epics in this project"
      onPick={onPick}
      onClose={onClose}
    />
  );
}

/** The epic chip: ref + title, click opens the epic. */
function EpicChip({ epicId, className = "" }: { epicId: string; className?: string }) {
  const ctx = useEpics();
  const key = useProjectKey();
  if (!ctx) return null;
  const parent = ctx.byId.get(epicId);
  const ref = parent ? itemRef(key, parent.number) : null;
  const title = parent ? titleOf(parent) : "Epic not loaded";
  return (
    <button
      type="button"
      onClick={() => parent && ctx.open(parent.id)}
      disabled={!parent}
      title={parent ? `Open epic ${ref}: ${title}` : title}
      aria-label={parent ? `Open parent epic ${ref}: ${title}` : title}
      className={`inline-flex min-w-0 max-w-[16rem] items-center gap-1 rounded bg-[var(--color-epic-bg)] px-1.5 py-0.5 text-[11px] text-[var(--color-epic)] ring-1 ring-inset ring-[var(--color-epic-line)] transition-opacity hover:opacity-90 ${className}`}
    >
      <EpicIcon />
      {ref ? <span className="shrink-0 font-mono">{ref}</span> : null}
      <span className="truncate">{title}</span>
      {parent?.archived_at ? <span className="shrink-0 opacity-70">(archived)</span> : null}
    </button>
  );
}

/**
 * Read-only parent link for board cards and list rows: the epic chip, which
 * opens the epic. Nothing when the item has no parent. Editing the link lives
 * in the detail modal.
 */
export function ParentChip({ item, className = "" }: { item: Item; className?: string }) {
  if (item.type === "epic" || !item.parent_id) return null;
  return <EpicChip epicId={item.parent_id} className={className} />;
}

/**
 * The "Parent epic" row in a non-epic item's detail modal: the epic chip with
 * "Change parent" and "Remove parent" icon actions, or a labelled "Add parent"
 * action that opens the epic picker.
 */
export function ParentRow({ item }: { item: Item }) {
  const ctx = useEpics();
  const [editing, setEditing] = useState(false);
  if (!ctx || item.type === "epic") return null;

  function pick(id: string) {
    setEditing(false);
    if (id !== item.parent_id) ctx!.setParent(item.id, id);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line)] px-4 py-2.5">
      <span className="text-xs text-[var(--color-faint)]">Parent epic</span>
      {editing ? (
        <ParentPicker
          currentId={item.parent_id}
          excludeId={item.id}
          onPick={pick}
          onClose={() => setEditing(false)}
        />
      ) : item.parent_id ? (
        <span className="inline-flex min-w-0 items-center gap-0.5">
          <EpicChip epicId={item.parent_id} />
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Change parent"
            aria-label="Change parent epic"
            className={`${iconBtn} hover:text-[var(--color-ink)]`}
          >
            <PencilIcon />
          </button>
          <button
            type="button"
            onClick={() => ctx.setParent(item.id, null)}
            title="Remove parent"
            aria-label="Remove parent epic"
            className={`${iconBtn} hover:text-[var(--color-bug)]`}
          >
            <UnlinkIcon />
          </button>
        </span>
      ) : ctx.epics.length > 0 ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Add this item to an epic"
          aria-label="Add parent epic"
          className={actionBtn}
        >
          <PlusIcon />
          Add parent
        </button>
      ) : (
        <span className="text-xs text-[var(--color-faint)]">
          None (no open epics in this project)
        </span>
      )}
    </div>
  );
}

/**
 * Parent picker for the Add Item form, on a draft parent id. Hidden by the form
 * when the chosen type is epic.
 */
export function DraftParent({
  parentId,
  onChange,
}: {
  parentId: string | null;
  onChange: (id: string | null) => void;
}) {
  const ctx = useEpics();
  const [editing, setEditing] = useState(false);
  if (!ctx) return null;
  if (editing) {
    return (
      <ParentPicker
        currentId={parentId}
        onPick={(id) => {
          setEditing(false);
          onChange(id);
        }}
        onClose={() => setEditing(false)}
      />
    );
  }
  if (parentId) {
    return (
      <span className="inline-flex min-w-0 items-center gap-0.5">
        <EpicChip epicId={parentId} />
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Change parent"
          aria-label="Change parent epic"
          className={`${iconBtn} hover:text-[var(--color-ink)]`}
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          onClick={() => onChange(null)}
          title="Remove parent"
          aria-label="Remove parent epic"
          className={`${iconBtn} hover:text-[var(--color-bug)]`}
        >
          <UnlinkIcon />
        </button>
      </span>
    );
  }
  if (ctx.epics.length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Create this item inside an epic"
      aria-label="Add parent epic"
      className={actionBtn}
    >
      <PlusIcon />
      Add parent
    </button>
  );
}

/**
 * The epic's children in its detail modal: "N/M done", an "Add child" action
 * (typeahead over cards in the project that can become its child), and a
 * clickable list (ref, title, status) where each child has a remove-from-epic
 * icon action. Archived children still reference the epic but are left out of
 * the list and the count. Every link change is a normal PATCH, so it lands in
 * the child's history.
 */
/**
 * The epic's children in its detail modal: "N/M done", an "Add child" action
 * (a multi-select typeahead over cards in the project that can become its
 * child), and a clickable list (ref, title, status) where each child has a
 * remove-from-epic icon action. Both lists read status (board column order) then
 * number. Archived children still reference the epic but are left out of the
 * list and the count. Every link change is a normal PATCH, so it lands in the
 * child's history — a multi-add sends one PATCH per card, one at a time.
 */
export function EpicChildren({ item }: { item: Item }) {
  const ctx = useEpics();
  const key = useProjectKey();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [failures, setFailures] = useState<{ ref: string; error: string }[]>([]);

  // Cards that can become this epic's child: same project (the context holds
  // only this project), not an epic, not archived, not already its child. A card
  // in ANOTHER epic is offered with a note — adding it moves it.
  const candidates = useMemo<Option[]>(
    () =>
      sortByStatusThenNumber(
        (ctx?.all ?? []).filter(
          (c) =>
            c.type !== "epic" &&
            !c.archived_at &&
            c.parent_id !== item.id &&
            c.project_id === item.project_id,
        ),
      ).map((c) => {
        const other = c.parent_id ? ctx?.byId.get(c.parent_id) : undefined;
        const otherRef = other ? itemRef(key, other.number) : null;
        return {
          id: c.id,
          ref: itemRef(key, c.number) ?? "",
          title: titleOf(c),
          status: c.status,
          note: c.parent_id ? `in ${otherRef ?? "another epic"} · moves here` : undefined,
        };
      }),
    [ctx, item.id, item.project_id, key],
  );

  // Only ids still offered count as selected (a card can stop being a
  // candidate after a refresh, e.g. archived elsewhere).
  const liveSelected = useMemo(() => {
    const ok = new Set(candidates.map((c) => c.id));
    return new Set([...selected].filter((id) => ok.has(id)));
  }, [selected, candidates]);

  if (!ctx || item.type !== "epic") return null;
  const epics = ctx;
  const live = ctx.childrenOf(item.id).filter((c) => !c.archived_at);
  const { done, total } = epicProgress(live);
  const epicRef = itemRef(key, item.number) ?? "this epic";

  function closePicker() {
    setAdding(false);
    setSelected(new Set());
    setFailures([]);
  }

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function addAll(ids: string[]) {
    if (busy !== null || ids.length === 0) return;
    const refOf = (id: string) => {
      const c = epics.byId.get(id);
      return c ? (itemRef(key, c.number) ?? "card") : "card";
    };
    setFailures([]);
    setBusy(`Adding 1 of ${ids.length}…`);
    const failed: LinkFailure[] = await linkSequentially(
      ids,
      (id) => epics.linkParent(id, item.id),
      (n, total) => setBusy(n < total ? `Adding ${n + 1} of ${total}…` : "Refreshing…"),
    );
    if (failed.length === 0) {
      setBusy(null);
      closePicker();
      return;
    }
    // Some links were refused: show the real state, keep the failed cards
    // selected, and say which failed and why.
    await epics.refresh();
    setSelected(new Set(failed.map((f) => f.id)));
    setFailures(failed.map((f) => ({ ref: refOf(f.id), error: f.error })));
    setBusy(null);
  }

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--color-faint)]">
        <EpicIcon className="h-3.5 w-3.5 text-[var(--color-epic)]" />
        <span className="font-medium uppercase tracking-wider">Child items</span>
        <span className="tabular-nums">
          {done}/{total} done
        </span>
        <span className="ml-auto">
          {adding ? (
            <ItemTypeahead
              options={candidates}
              placeholder="Card ref or title…"
              label={`Add child items to ${epicRef}`}
              emptyText="No cards available to add"
              align="right"
              onPick={(id) => void addAll([id])}
              onClose={closePicker}
              multi={{
                selected: liveSelected,
                onToggle: toggle,
                onCommit: (ids) => void addAll(ids),
                busy,
                failures,
              }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              title={`Add existing cards to ${epicRef}`}
              aria-label={`Add child items to ${epicRef}`}
              className={actionBtn}
            >
              <PlusIcon />
              Add child
            </button>
          )}
        </span>
      </div>
      {total === 0 ? (
        <p className="text-xs text-[var(--color-faint)]">
          No child items yet. Use Add child to pick an existing card.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {live.map((c) => {
            const ref = itemRef(key, c.number);
            const title = titleOf(c);
            return (
              <li key={c.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => ctx.open(c.id)}
                  title={`Open ${ref}: ${title}`}
                  aria-label={`Open child item ${ref}: ${title}`}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left text-sm transition-colors hover:bg-[var(--color-canvas)]"
                >
                  <span className="w-20 shrink-0 font-mono text-[11px] text-[var(--color-faint)]">
                    {ref}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate ${
                      c.status === "done"
                        ? "text-[var(--color-faint)] line-through"
                        : "text-[var(--color-ink)]"
                    }`}
                  >
                    {title}
                  </span>
                  <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
                    {STATUS_LABEL[c.status]}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => ctx.setParent(c.id, null)}
                  title="Remove from epic"
                  aria-label={`Remove ${ref} from ${epicRef}`}
                  className={`${iconBtn} hover:text-[var(--color-bug)]`}
                >
                  <UnlinkIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
