"use client";

import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { Category, Item } from "@/lib/types";

type CategoriesValue = {
  categories: Category[];
  /** "A / B / C" path for a node id. */
  pathOf: (id: string | null) => string;
  /** All nodes as full-path strings, for typeahead. */
  paths: { id: string; path: string }[];
  /** Assign (or clear with null) an item's category. */
  assign: (itemId: string, categoryId: string | null) => void;
  /** Find-or-create the node at a "/"-path; returns it (or null on failure). */
  ensure: (path: string) => Promise<Category | null>;
  /** Rename a node (ripples to every item via the id reference). */
  rename: (id: string, name: string) => void;
  /** Bind (or clear with null) a GitHub repo on a node. */
  setRepo: (id: string, repo: string | null) => void;
  /** Delete a node (children reparent up; items un-file). */
  remove: (id: string) => void;
};

const CategoryContext = createContext<CategoriesValue | null>(null);
export const CategoryProvider = CategoryContext.Provider;
export function useCategories(): CategoriesValue | null {
  return useContext(CategoryContext);
}

/**
 * Normalise a path for matching: lowercase and collapse spacing around slashes,
 * so a typed "coach/" matches the displayed "coach / home". Spaces *within* a
 * segment (e.g. "session complete") are preserved.
 */
function normPath(s: string): string {
  return s.toLowerCase().replace(/\s*\/\s*/g, "/").trim();
}

/** Build "A / B / C" for a node id from a flat list (cycle-safe). */
export function buildPathOf(cats: Category[]): (id: string | null) => string {
  const byId = new Map(cats.map((c) => [c.id, c]));
  return (id) => {
    const parts: string[] = [];
    const seen = new Set<string>();
    let cur = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const n = byId.get(cur);
      if (!n) break;
      parts.unshift(n.name);
      cur = n.parent_id;
    }
    return parts.join(" / ");
  };
}

/** A node id plus all descendants — for subtree filtering. */
export function subtreeIdSet(cats: Category[], rootId: string): Set<string> {
  const kids = new Map<string | null, Category[]>();
  for (const c of cats) {
    const l = kids.get(c.parent_id) ?? [];
    l.push(c);
    kids.set(c.parent_id, l);
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop() as string;
    for (const ch of kids.get(id) ?? []) {
      if (!out.has(ch.id)) {
        out.add(ch.id);
        stack.push(ch.id);
      }
    }
  }
  return out;
}

function Spinner() {
  return (
    <svg
      className="h-3 w-3 shrink-0 animate-spin text-[var(--color-muted)]"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      className="h-3 w-3 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

/**
 * Reusable path typeahead: type a "/"-path, see existing paths filtered by
 * substring; ↑/↓ move, Enter commits the highlighted suggestion or the typed
 * text (find-or-creating), Esc cancels. Floating overlay (doesn't push content).
 */
export function PathInput({
  paths,
  onCommit,
  onCancel,
  autoFocus = true,
  keepOpen = false,
  initial = "",
}: {
  paths: { id: string; path: string }[];
  /** id is set when an existing suggestion was picked (skip the create round-trip). */
  onCommit: (path: string, id?: string) => void;
  onCancel: () => void;
  autoFocus?: boolean;
  /**
   * Builder mode (the Areas manager): Enter commits the *typed* path and, before
   * the insert returns, immediately trims the field back to the last "/" so you
   * can type the next sibling. Stays open; blur does not auto-create.
   */
  keepOpen?: boolean;
  /** Seed the field (e.g. the item's current area, despaced) for editing. */
  initial?: string;
}) {
  const [draft, setDraft] = useState(initial);
  const [hi, setHi] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    const q = normPath(draft);
    return q ? paths.filter((p) => normPath(p.path).includes(q)) : paths;
  }, [draft, paths]);

  // Builder mode: only suggest once something's typed (an empty Add field
  // showing every path was just noise). Picker mode drops down on focus.
  const showSuggestions =
    matches.length > 0 && (keepOpen ? draft.trim().length > 0 : true);

  function scrollHiIntoView(n: number) {
    (listRef.current?.children?.[n] as HTMLElement | undefined)?.scrollIntoView({
      block: "nearest",
    });
  }

  function commit(path: string, id?: string) {
    const p = path.trim();
    if (!p) {
      if (!keepOpen) onCancel();
      return;
    }
    onCommit(p, id);
    if (keepOpen) {
      // Trim back to (and including) the last "/" — synchronously, so the field
      // is ready for the next sibling instantly, not after the insert round-trip.
      const cut = p.lastIndexOf("/");
      setDraft(cut >= 0 ? `${p.slice(0, cut + 1)} ` : "");
      setHi(0);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (keepOpen) setDraft("");
      else onCancel();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const n = Math.min(matches.length - 1, hi + 1);
      setHi(n);
      scrollHiIntoView(n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const n = Math.max(0, hi - 1);
      setHi(n);
      scrollHiIntoView(n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Builder mode commits exactly what's typed; picker mode takes the
      // highlighted suggestion (with its id) when there is one.
      const sel = keepOpen ? undefined : matches[hi];
      commit(keepOpen ? draft : (sel?.path ?? draft), sel?.id);
    }
  }

  return (
    <span className="relative inline-block">
      <input
        autoFocus={autoFocus}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setHi(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!keepOpen) commit(draft);
        }}
        placeholder="Area / Sub-area…"
        aria-label="Category path"
        className="w-44 rounded border border-[var(--color-line)] bg-transparent px-1.5 py-0.5 text-xs outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
      />
      {showSuggestions ? (
        <div
          ref={listRef}
          className="absolute left-0 top-full z-30 mt-1 max-h-56 min-w-44 overflow-y-auto overscroll-contain rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-lg"
        >
          {matches.map((m, i) => (
            <button
              key={m.id}
              type="button"
              // onMouseDown (not onClick) so it fires before the input blur.
              // Builder: filling lets you extend an existing branch (… / child).
              // Picker: clicking selects that area for the item.
              onMouseDown={(e) => {
                e.preventDefault();
                if (keepOpen) {
                  setDraft(`${m.path} / `);
                  setHi(0);
                } else {
                  commit(m.path, m.id);
                }
              }}
              onMouseEnter={() => setHi(i)}
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs ${
                i === hi ? "bg-[var(--color-accent-soft)]" : ""
              }`}
            >
              <FolderIcon />
              <span className="truncate">{m.path}</span>
            </button>
          ))}
          {draft.trim() &&
          !matches.some((m) => normPath(m.path) === normPath(draft)) ? (
            <div className="px-2 pt-1 text-[10px] text-[var(--color-faint)]">
              Enter to create “{draft.trim()}”
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}

/** Category picker for the add-item form (operates on a draft category id). */
export function DraftCategory({
  categoryId,
  onChange,
}: {
  categoryId: string | null;
  onChange: (id: string | null) => void;
}) {
  const ctx = useCategories();
  const [editing, setEditing] = useState(false);
  if (!ctx) return null;
  const path = ctx.pathOf(categoryId);

  async function commitPath(p: string, id?: string) {
    setEditing(false);
    if (id) {
      onChange(id);
      return;
    }
    const cat = await ctx!.ensure(p);
    onChange(cat ? cat.id : null);
  }

  if (editing) {
    return (
      <PathInput
        paths={ctx.paths}
        initial={path.replace(/\s*\/\s*/g, "/")}
        onCommit={(p, id) => void commitPath(p, id)}
        onCancel={() => setEditing(false)}
      />
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label="Set area"
        title="File under an area"
        className={
          path
            ? "inline-flex max-w-[14rem] items-center gap-1 rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-xs text-[var(--color-muted)] ring-1 ring-inset ring-[var(--color-line)]"
            : "text-xs text-[var(--color-faint)] hover:text-[var(--color-muted)]"
        }
      >
        {path ? (
          <>
            <FolderIcon />
            <span className="truncate">{path}</span>
          </>
        ) : (
          "+ area"
        )}
      </button>
      {path ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Clear area"
          className="text-[var(--color-faint)] hover:text-[var(--color-bug)]"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

/** Inline category breadcrumb + picker for an item row/card. */
export function ItemCategory({
  item,
  className = "",
}: {
  item: Item;
  className?: string;
}) {
  const ctx = useCategories();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  if (!ctx) return null;
  const { pathOf, paths, assign, ensure } = ctx;
  const path = pathOf(item.category_id);

  async function commitPath(p: string, id?: string) {
    setEditing(false);
    // Picked an existing area → assign by id (optimistic = instant). Only a
    // genuinely new typed path needs the create round-trip, with a spinner.
    if (id) {
      assign(item.id, id);
      return;
    }
    setSaving(true);
    const cat = await ensure(p);
    if (cat) assign(item.id, cat.id);
    setSaving(false);
  }

  if (editing) {
    return (
      <span className={className}>
        <PathInput
          paths={paths}
          initial={path.replace(/\s*\/\s*/g, "/")}
          onCommit={(p, id) => void commitPath(p, id)}
          onCancel={() => setEditing(false)}
        />
      </span>
    );
  }

  if (saving) {
    return (
      <span className={`inline-flex items-center gap-1 ${className}`}>
        <Spinner />
        <span className="text-[11px] text-[var(--color-faint)]">saving…</span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      {path ? (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Change area"
          aria-label={`Area: ${path}. Click to change.`}
          className="inline-flex max-w-full items-center gap-1 rounded bg-[var(--color-accent-soft)] px-1.5 py-0.5 text-[11px] text-[var(--color-accent-ink)] transition-opacity hover:opacity-90"
        >
          <FolderIcon />
          <span className="truncate">{path}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Set area"
          className="text-[11px] text-[var(--color-faint)] transition-colors hover:text-[var(--color-muted)]"
        >
          + area
        </button>
      )}
      {path ? (
        <button
          type="button"
          onClick={() => assign(item.id, null)}
          title="Clear area"
          aria-label="Clear area"
          className="text-[var(--color-faint)] transition-colors hover:text-[var(--color-bug)]"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}
