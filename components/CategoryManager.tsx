"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useCategories, PathInput } from "@/components/CategoryPicker";
import type { Category } from "@/lib/types";

/** Depth of a node (root = 0) for indenting the tree. */
function depthOf(byId: Map<string, Category>, c: Category): number {
  let d = 0;
  const seen = new Set<string>();
  let cur = c.parent_id;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    d++;
    cur = byId.get(cur)?.parent_id ?? null;
  }
  return d;
}

/** Manage a project's Areas: rename (ripples), add, delete. */
export function CategoryManager({ onClose }: { onClose: () => void }) {
  const ctx = useCategories();

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Order nodes as a tree: each node directly after its parent, siblings by
  // position — so the indented list reads top-down.
  const ordered = useMemo(() => {
    if (!ctx) return [];
    const kids = new Map<string | null, Category[]>();
    for (const c of ctx.categories) {
      const l = kids.get(c.parent_id) ?? [];
      l.push(c);
      kids.set(c.parent_id, l);
    }
    for (const l of kids.values()) l.sort((a, b) => a.position - b.position);
    const byId = new Map(ctx.categories.map((c) => [c.id, c]));
    const out: { cat: Category; depth: number }[] = [];
    const walk = (parent: string | null) => {
      for (const c of kids.get(parent) ?? []) {
        out.push({ cat: c, depth: depthOf(byId, c) });
        walk(c.id);
      }
    };
    walk(null);
    return out;
  }, [ctx]);

  if (!ctx) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[10vh]"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-[var(--color-line)] px-4 py-2.5">
          <h2 className="text-sm font-semibold">Areas</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded p-1 text-[var(--color-faint)] transition-colors hover:text-[var(--color-ink)]"
          >
            ✕
          </button>
        </header>

        <div className="max-h-[50vh] overflow-y-auto px-2 py-2">
          {ordered.length === 0 ? (
            <p className="px-2 py-3 text-xs text-[var(--color-faint)]">
              No areas yet. Add one below — or type a path on any item.
            </p>
          ) : (
            <ul>
              {ordered.map(({ cat, depth }) => (
                <CategoryRow
                  key={cat.id}
                  cat={cat}
                  depth={depth}
                  onRename={(name) => ctx.rename(cat.id, name)}
                  onSetRepo={(repo) => ctx.setRepo(cat.id, repo)}
                  onDelete={() => ctx.remove(cat.id)}
                />
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t border-[var(--color-line)] px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
              Add
            </span>
            <PathInput
              paths={ctx.paths}
              autoFocus={false}
              keepOpen
              onCommit={(p) => void ctx.ensure(p)}
              onCancel={() => {}}
            />
          </div>
          <p className="mt-1.5 text-[10px] text-[var(--color-faint)]">
            Renaming an area updates it on every item. Deleting moves its
            children up and un-files its items.
          </p>
        </footer>
      </div>
    </div>
  );
}

function CategoryRow({
  cat,
  depth,
  onRename,
  onSetRepo,
  onDelete,
}: {
  cat: Category;
  depth: number;
  onRename: (name: string) => void;
  onSetRepo: (repo: string | null) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cat.name);
  const [repoEditing, setRepoEditing] = useState(false);
  const [repoDraft, setRepoDraft] = useState(cat.github_repo ?? "");

  function commit() {
    const n = draft.trim();
    if (n && n !== cat.name) onRename(n);
    else setDraft(cat.name);
    setEditing(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(cat.name);
      setEditing(false);
    }
  }

  function commitRepo() {
    const next = repoDraft.trim() || null;
    if (next !== (cat.github_repo ?? null)) onSetRepo(next);
    setRepoEditing(false);
  }

  function onRepoKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRepo();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setRepoDraft(cat.github_repo ?? "");
      setRepoEditing(false);
    }
  }

  return (
    <li className="group flex items-center gap-2 rounded px-2 py-1 hover:bg-[var(--color-canvas)]">
      <span style={{ width: depth * 14 }} className="shrink-0" aria-hidden="true" />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={commit}
          aria-label={`Rename ${cat.name}`}
          className="flex-1 rounded border border-[var(--color-accent)] bg-transparent px-1.5 py-0.5 text-sm outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(cat.name);
            setEditing(true);
          }}
          title="Rename"
          className="flex-1 truncate text-left text-sm hover:text-[var(--color-accent)]"
        >
          {cat.name}
        </button>
      )}
      {repoEditing ? (
        <input
          autoFocus
          value={repoDraft}
          onChange={(e) => setRepoDraft(e.target.value)}
          onKeyDown={onRepoKeyDown}
          onBlur={commitRepo}
          placeholder="owner/repo"
          aria-label={`GitHub repo for ${cat.name}`}
          className="w-40 shrink-0 rounded border border-[var(--color-accent)] bg-transparent px-1.5 py-0.5 font-mono text-[11px] outline-none"
        />
      ) : cat.github_repo ? (
        <button
          type="button"
          onClick={() => {
            setRepoDraft(cat.github_repo ?? "");
            setRepoEditing(true);
          }}
          title="Edit linked GitHub repo"
          className="shrink-0 rounded bg-[var(--color-accent-soft)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-accent-ink)] transition-opacity hover:opacity-80"
        >
          {cat.github_repo}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            setRepoDraft("");
            setRepoEditing(true);
          }}
          title="Link a GitHub repo"
          className="invisible shrink-0 text-xs text-[var(--color-faint)] transition-colors hover:text-[var(--color-accent-ink)] group-hover:visible"
        >
          + repo
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          if (confirm(`Delete area “${cat.name}”? Items keep, just un-filed.`)) {
            onDelete();
          }
        }}
        aria-label={`Delete ${cat.name}`}
        title="Delete area"
        className="invisible shrink-0 text-xs text-[var(--color-faint)] transition-colors hover:text-[var(--color-bug)] group-hover:visible"
      >
        Delete
      </button>
    </li>
  );
}
