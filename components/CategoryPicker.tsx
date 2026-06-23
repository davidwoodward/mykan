"use client";

import {
  createContext,
  useContext,
  useMemo,
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
  /** Delete a node (children reparent up; items un-file). */
  remove: (id: string) => void;
};

const CategoryContext = createContext<CategoriesValue | null>(null);
export const CategoryProvider = CategoryContext.Provider;
export function useCategories(): CategoriesValue | null {
  return useContext(CategoryContext);
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
}: {
  paths: { id: string; path: string }[];
  onCommit: (path: string) => void;
  onCancel: () => void;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [hi, setHi] = useState(0);

  const matches = useMemo(() => {
    const q = draft.trim().toLowerCase();
    const list = q
      ? paths.filter((p) => p.path.toLowerCase().includes(q))
      : paths;
    return list.slice(0, 8);
  }, [draft, paths]);

  function commit(path: string) {
    const p = path.trim();
    if (p) onCommit(p);
    else onCancel();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(matches.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(matches[hi]?.path ?? draft);
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
        onBlur={() => commit(draft)}
        placeholder="Area / Sub-area…"
        aria-label="Category path"
        className="w-44 rounded border border-[var(--color-line)] bg-transparent px-1.5 py-0.5 text-xs outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
      />
      {matches.length > 0 ? (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-56 min-w-44 overflow-y-auto rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-lg">
          {matches.map((m, i) => (
            <button
              key={m.id}
              type="button"
              // onMouseDown (not onClick) so it fires before the input blur.
              onMouseDown={(e) => {
                e.preventDefault();
                commit(m.path);
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
          !matches.some(
            (m) => m.path.toLowerCase() === draft.trim().toLowerCase(),
          ) ? (
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

  async function commitPath(p: string) {
    const cat = await ctx!.ensure(p);
    onChange(cat ? cat.id : null);
    setEditing(false);
  }

  if (editing) {
    return (
      <PathInput
        paths={ctx.paths}
        onCommit={(p) => void commitPath(p)}
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
  if (!ctx) return null;
  const { pathOf, paths, assign, ensure } = ctx;
  const path = pathOf(item.category_id);

  async function commitPath(p: string) {
    const cat = await ensure(p);
    if (cat) assign(item.id, cat.id);
    setEditing(false);
  }

  if (editing) {
    return (
      <span className={className}>
        <PathInput
          paths={paths}
          onCommit={(p) => void commitPath(p)}
          onCancel={() => setEditing(false)}
        />
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
          className="inline-flex max-w-[16rem] items-center gap-1 rounded bg-[var(--color-canvas)] px-1.5 py-0.5 text-[11px] text-[var(--color-muted)] ring-1 ring-inset ring-[var(--color-line)] transition-colors hover:text-[var(--color-ink)]"
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
