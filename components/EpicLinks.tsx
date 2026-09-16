"use client";

import {
  createContext,
  useContext,
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
} from "@/lib/types";
import { useProjectKey } from "@/components/RefBadge";

/**
 * Epic parent/child links (KANBAN-41). The link lives on the child
 * (`item.parent_id`); everything here is derived from the project's items, so
 * the parent link on a child and the children list on its epic always agree.
 */
type EpicValue = {
  /** Every loaded item in the project (archived included), by id. */
  byId: Map<string, Item>;
  /** Non-archived epics, the only valid NEW parents. */
  epics: Item[];
  /** An epic's children, archived included, in board order. */
  childrenOf: (epicId: string) => Item[];
  /** Open an item's detail modal. */
  open: (id: string) => void;
  /** Link (or clear with null) an item's parent epic. */
  setParent: (id: string, parentId: string | null) => void;
};

const EpicContext = createContext<EpicValue | null>(null);
export const EpicProvider = EpicContext.Provider;

/** Build the context value from the project's items. */
export function useEpicValue(
  items: Item[] | null,
  open: (id: string) => void,
  setParent: (id: string, parentId: string | null) => void,
): EpicValue {
  return useMemo(() => {
    const all = items ?? [];
    const byId = new Map(all.map((it) => [it.id, it]));
    const kids = new Map<string, Item[]>();
    for (const it of all) {
      if (!it.parent_id) continue;
      const l = kids.get(it.parent_id) ?? [];
      l.push(it);
      kids.set(it.parent_id, l);
    }
    for (const l of kids.values()) l.sort((a, b) => a.position - b.position);
    const epics = all
      .filter((it) => it.type === "epic" && !it.archived_at)
      .sort((a, b) => a.number - b.number);
    return {
      byId,
      epics,
      childrenOf: (id: string) => kids.get(id) ?? [],
      open,
      setParent,
    };
  }, [items, open, setParent]);
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

function titleOf(it: Item): string {
  return richDocTitle(it.body) || "Untitled";
}

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

/**
 * Typeahead over the project's non-archived epics. Opens on focus (seeded with
 * the current parent's ref, selected so typing replaces it), filters by ref or
 * title as you type; ↑/↓ move, Enter picks, Esc closes without changing, Tab
 * moves on (blur closes, never selects). The list is an overlay.
 */
function ParentPicker({
  item,
  onPick,
  onClose,
}: {
  item: Item;
  onPick: (parentId: string) => void;
  onClose: () => void;
}) {
  const ctx = useEpics();
  const key = useProjectKey();
  const current = item.parent_id ? ctx?.byId.get(item.parent_id) : undefined;
  const seed = current ? (itemRef(key, current.number) ?? "") : "";
  const [draft, setDraft] = useState(seed);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const options = useMemo(
    () =>
      (ctx?.epics ?? [])
        .filter((e) => e.id !== item.id && e.project_id === item.project_id)
        .map((e) => ({ id: e.id, ref: itemRef(key, e.number) ?? "", title: titleOf(e) })),
    [ctx, item.id, item.project_id, key],
  );
  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    // The untouched seed shows every epic (with the current one highlighted).
    if (!q || draft === seed) return options;
    return options.filter(
      (o) => o.ref.toLowerCase().includes(q) || o.title.toLowerCase().includes(q),
    );
  }, [draft, seed, options]);
  const [hi, setHi] = useState(() =>
    Math.max(0, options.findIndex((o) => o.id === item.parent_id)),
  );

  function move(n: number) {
    setHi(n);
    (listRef.current?.children?.[n] as HTMLElement | undefined)?.scrollIntoView({
      block: "nearest",
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      // Close just the picker, not the modal/board underneath.
      e.preventDefault();
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(Math.min(matches.length - 1, hi + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(Math.max(0, hi - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const sel = matches[hi];
      if (sel) onPick(sel.id);
    }
  }

  return (
    <span className="relative inline-block">
      <input
        autoFocus
        value={draft}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          setDraft(e.target.value);
          setHi(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={onClose}
        placeholder="Epic ref or title…"
        aria-label="Parent epic"
        role="combobox"
        aria-expanded={matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        className="w-44 rounded border border-[var(--color-line)] bg-transparent px-1.5 py-0.5 text-xs outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
      />
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Epics"
        className="absolute left-0 top-full z-30 mt-1 max-h-56 w-72 max-w-[80vw] overflow-y-auto overscroll-contain rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-lg"
      >
        {matches.length === 0 ? (
          <div className="px-2 py-1 text-xs text-[var(--color-faint)]">
            {options.length === 0 ? "No open epics in this project" : "No matching epics"}
          </div>
        ) : (
          matches.map((m, i) => (
            <button
              key={m.id}
              type="button"
              role="option"
              aria-selected={m.id === item.parent_id}
              // onMouseDown (not onClick) so it fires before the input blur.
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(m.id);
              }}
              onMouseEnter={() => setHi(i)}
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs ${
                i === hi ? "bg-[var(--color-accent-soft)]" : ""
              }`}
            >
              <span className="shrink-0 font-mono text-[11px] text-[var(--color-faint)]">
                {m.ref}
              </span>
              <span className="truncate text-[var(--color-ink)]">{m.title}</span>
            </button>
          ))
        )}
      </div>
    </span>
  );
}

/**
 * A child's link to its epic, inline on board cards, list rows and the detail
 * modal: the epic's ref + title (click opens the epic), a pencil to change it and
 * × to clear it. With no parent it offers "+ epic" when the project has an open
 * epic to pick. Epics themselves never show it (one level only).
 */
export function ItemParent({ item, className = "" }: { item: Item; className?: string }) {
  const ctx = useEpics();
  const key = useProjectKey();
  const [editing, setEditing] = useState(false);
  if (!ctx || item.type === "epic") return null;
  const parent = item.parent_id ? ctx.byId.get(item.parent_id) : undefined;

  if (editing) {
    return (
      <span className={className}>
        <ParentPicker
          item={item}
          onClose={() => setEditing(false)}
          onPick={(id) => {
            setEditing(false);
            if (id !== item.parent_id) ctx.setParent(item.id, id);
          }}
        />
      </span>
    );
  }

  if (!item.parent_id) {
    if (ctx.epics.length === 0) return null;
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Add to an epic"
        aria-label="Add to an epic"
        className={`text-[11px] text-[var(--color-faint)] transition-colors hover:text-[var(--color-muted)] ${className}`}
      >
        + epic
      </button>
    );
  }

  const ref = parent ? itemRef(key, parent.number) : null;
  const title = parent ? titleOf(parent) : "Epic not loaded";
  return (
    <span className={`inline-flex min-w-0 max-w-full items-center gap-1 ${className}`}>
      <button
        type="button"
        onClick={() => parent && ctx.open(parent.id)}
        disabled={!parent}
        title={parent ? `Open epic ${ref}: ${title}` : title}
        aria-label={parent ? `Open parent epic ${ref}: ${title}` : title}
        className="inline-flex min-w-0 max-w-[16rem] items-center gap-1 rounded bg-[var(--color-epic-bg)] px-1.5 py-0.5 text-[11px] text-[var(--color-epic)] ring-1 ring-inset ring-[var(--color-epic-line)] transition-opacity hover:opacity-90"
      >
        <EpicIcon />
        {ref ? <span className="shrink-0 font-mono">{ref}</span> : null}
        <span className="truncate">{title}</span>
        {parent?.archived_at ? <span className="shrink-0 opacity-70">(archived)</span> : null}
      </button>
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Change epic"
        aria-label="Change parent epic"
        className="text-[var(--color-faint)] transition-colors hover:text-[var(--color-muted)]"
      >
        <svg
          className="h-3 w-3"
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
      </button>
      <button
        type="button"
        onClick={() => ctx.setParent(item.id, null)}
        title="Remove from epic"
        aria-label="Remove from parent epic"
        className="text-[var(--color-faint)] transition-colors hover:text-[var(--color-bug)]"
      >
        ×
      </button>
    </span>
  );
}

/**
 * The "Epic" row in a non-epic item's detail modal. Hidden when there's nothing
 * to show: no parent and no open epic in the project to pick.
 */
export function ParentRow({ item }: { item: Item }) {
  const ctx = useEpics();
  if (!ctx || item.type === "epic") return null;
  if (!item.parent_id && ctx.epics.length === 0) return null;
  return (
    <div className="flex items-center gap-2 border-t border-[var(--color-line)] px-4 py-2.5">
      <span className="text-xs text-[var(--color-faint)]">Epic</span>
      <ItemParent item={item} className="min-w-0" />
    </div>
  );
}

/**
 * The epic's children in its detail modal: a clickable list (ref, title,
 * status) with "N/M done". Archived children still reference the epic but are
 * left out of the list and the count.
 */
export function EpicChildren({ item }: { item: Item }) {
  const ctx = useEpics();
  const key = useProjectKey();
  if (!ctx || item.type !== "epic") return null;
  const live = ctx.childrenOf(item.id).filter((c) => !c.archived_at);
  const { done, total } = epicProgress(live);
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-xs text-[var(--color-faint)]">
        <EpicIcon className="h-3.5 w-3.5 text-[var(--color-epic)]" />
        <span className="font-medium uppercase tracking-wider">Child items</span>
        <span className="tabular-nums">
          {done}/{total} done
        </span>
      </div>
      {total === 0 ? (
        <p className="text-xs text-[var(--color-faint)]">
          No child items yet. Use “+ epic” on a card to add it to this epic.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {live.map((c) => {
            const ref = itemRef(key, c.number);
            const title = titleOf(c);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => ctx.open(c.id)}
                  title={`Open ${ref}: ${title}`}
                  aria-label={`Open child item ${ref}: ${title}`}
                  className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm transition-colors hover:bg-[var(--color-canvas)]"
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
