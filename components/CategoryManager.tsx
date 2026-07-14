"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
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

/** The shape POST /api/projects/[id]/github/import returns (subset we render). */
type ImportSummary = {
  account: string | null;
  needs_connect?: { account: string; reason: "missing" | "invalid" };
  repos: { repo: string; area: string; imported: number; skipped: number; error?: string }[];
  imported: number;
  skipped: number;
};

/** Manage a project's Areas: rename (ripples), add, delete, import from GitHub. */
export function CategoryManager({
  projectId,
  onImported,
  onClose,
}: {
  projectId: string;
  /** Called after a successful import so the board pulls the new items in. */
  onImported: () => void;
  onClose: () => void;
}) {
  const ctx = useCategories();
  // Repo names under the project's bound GitHub account (for the binding
  // picker). Empty until loaded, or when no account/PAT is connected — the
  // picker still lets you type a repo name by hand.
  const [repoOptions, setRepoOptions] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/github/repos`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { repos?: string[] }) => {
        if (!cancelled) setRepoOptions(d.repos ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

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
                  projectId={projectId}
                  repoOptions={repoOptions}
                  onImported={onImported}
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
  projectId,
  repoOptions,
  onImported,
  onRename,
  onSetRepo,
  onDelete,
}: {
  cat: Category;
  depth: number;
  projectId: string;
  repoOptions: string[];
  onImported: () => void;
  onRename: (name: string) => void;
  onSetRepo: (repo: string | null) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cat.name);
  const [repoEditing, setRepoEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  // A short result line under the row after an import ("Imported 5 · skipped 2",
  // "Up to date", a Connect prompt, or an error). Cleared when re-importing.
  const [importMsg, setImportMsg] = useState<{ text: string; tone: "ok" | "warn" | "err" } | null>(
    null,
  );

  async function runImport() {
    if (importing) return;
    setImporting(true);
    setImportMsg(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/github/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category_id: cat.id }),
      });
      const data = (await res.json().catch(() => ({}))) as ImportSummary & { error?: string };
      if (!res.ok) {
        setImportMsg({ text: data.error ?? `Import failed (HTTP ${res.status}).`, tone: "err" });
        return;
      }
      if (data.needs_connect) {
        const verb = data.needs_connect.reason === "invalid" ? "Reconnect" : "Connect";
        setImportMsg({
          text: `${verb} GitHub for ${data.needs_connect.account} (top bar) to import.`,
          tone: "warn",
        });
        return;
      }
      const repoErr = data.repos.find((r) => r.error);
      if (repoErr) {
        setImportMsg({ text: repoErr.error ?? "Import error.", tone: "err" });
        return;
      }
      if (data.imported > 0) {
        setImportMsg({
          text: `Imported ${data.imported}${data.skipped ? ` · skipped ${data.skipped}` : ""}.`,
          tone: "ok",
        });
        onImported();
      } else {
        setImportMsg({
          text: data.skipped ? `Up to date · ${data.skipped} already imported.` : "No open issues.",
          tone: "ok",
        });
      }
    } catch {
      setImportMsg({ text: "Network error — try again.", tone: "err" });
    } finally {
      setImporting(false);
    }
  }

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

  return (
    <li className="group rounded px-2 py-1 hover:bg-[var(--color-canvas)]">
      <div className="flex items-center gap-2">
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
        <RepoPicker
          initial={cat.github_repo ?? ""}
          options={repoOptions}
          label={`GitHub repo for ${cat.name}`}
          onCommit={(repo) => {
            if (repo !== (cat.github_repo ?? null)) onSetRepo(repo);
            setRepoEditing(false);
          }}
          onCancel={() => setRepoEditing(false)}
        />
      ) : cat.github_repo ? (
        <button
          type="button"
          onClick={() => setRepoEditing(true)}
          title="Edit linked GitHub repo"
          className="shrink-0 rounded bg-[var(--color-accent-soft)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--color-accent-ink)] transition-opacity hover:opacity-80"
        >
          {cat.github_repo}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setRepoEditing(true)}
          title="Link a GitHub repo"
          className="invisible shrink-0 text-xs text-[var(--color-faint)] transition-colors hover:text-[var(--color-accent-ink)] group-hover:visible"
        >
          + repo
        </button>
      )}
      {cat.github_repo ? (
        <button
          type="button"
          onClick={() => void runImport()}
          disabled={importing}
          aria-label={`Import open issues from ${cat.github_repo}`}
          title={`Import open issues from ${cat.github_repo}`}
          className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[var(--color-muted)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)] disabled:opacity-60"
        >
          {importing ? (
            <svg
              className="h-3.5 w-3.5 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          ) : (
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
              <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
              <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
          )}
          {importing ? "Importing…" : "Import"}
        </button>
      ) : null}
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
      </div>
      {importMsg ? (
        <p
          className={`mt-1 pl-2 text-[11px] ${
            importMsg.tone === "err"
              ? "text-[var(--color-bug)]"
              : importMsg.tone === "warn"
                ? "text-[var(--color-accent-ink)]"
                : "text-[var(--color-faint)]"
          }`}
        >
          {importMsg.text}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Typeahead for binding a GitHub repo to an area. Opens on focus showing the
 * repos the user's PAT can see under the project's account; typing filters by
 * substring; ↑/↓ move, Enter picks the highlighted row, clicking picks it, and a
 * "Use "<typed>"" row lets you commit a name that isn't in the list. Esc cancels;
 * clearing the field and committing unbinds. Overlay — doesn't push the row.
 */
function RepoPicker({
  initial,
  options,
  label,
  onCommit,
  onCancel,
}: {
  initial: string;
  options: string[];
  label: string;
  /** repo name to bind, or null to unbind. */
  onCommit: (repo: string | null) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [hi, setHi] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Viewport coords for the dropdown. It renders `fixed` so it escapes the
  // Areas panel's scroll container (which would otherwise clip it) and paints
  // above the footer. Measured when the input mounts, and kept fresh on
  // focus / scroll / resize.
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);

  const measure = useCallback(() => {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setCoords({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);

  // Stable ref callback: measure the moment the input attaches to the DOM, so
  // `coords` is set on mount regardless of whether the autofocus focus event
  // fires the onFocus handler. (Relying on onFocus alone left coords null and
  // the dropdown never rendered.) A useCallback ref runs only on attach/detach,
  // not every render, so this can't loop.
  const attachInput = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (node) {
      const r = node.getBoundingClientRect();
      setCoords({ top: r.bottom + 4, left: r.left, width: r.width });
    }
  }, []);

  // Keep the dropdown pinned to the input while it's open (list scroll / resize).
  // The listeners fire measure() → setCoords in a callback, not synchronously in
  // the effect body, so this stays clear of the setState-in-effect rule.
  useEffect(() => {
    const onMove = () => measure();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [measure]);

  const trimmed = draft.trim();
  const q = trimmed.toLowerCase();
  const filtered = useMemo(
    () => (q ? options.filter((o) => o.toLowerCase().includes(q)) : options),
    [q, options],
  );
  // Offer a "use what I typed" row unless the typed text is already an exact
  // option — so type-your-own always works, even when it substring-matches.
  const showTyped = trimmed.length > 0 && !options.some((o) => o.toLowerCase() === q);
  const items: { value: string; typed?: boolean }[] = [
    ...filtered.map((v) => ({ value: v })),
    ...(showTyped ? [{ value: trimmed, typed: true }] : []),
  ];
  const open = items.length > 0 && coords !== null;

  function scrollHiIntoView(n: number) {
    (listRef.current?.children?.[n] as HTMLElement | undefined)?.scrollIntoView({
      block: "nearest",
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const n = Math.min(items.length - 1, hi + 1);
      setHi(n);
      scrollHiIntoView(n);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const n = Math.max(0, hi - 1);
      setHi(n);
      scrollHiIntoView(n);
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Empty field → unbind. Otherwise take the highlighted row, or the typed
      // text if the dropdown is somehow empty.
      if (!trimmed) onCommit(null);
      else onCommit(items[Math.min(hi, items.length - 1)]?.value ?? trimmed);
    }
  }

  return (
    <span className="inline-block shrink-0">
      <input
        ref={attachInput}
        autoFocus
        value={draft}
        onFocus={measure}
        onChange={(e) => {
          setDraft(e.target.value);
          setHi(0);
        }}
        onKeyDown={onKeyDown}
        // Blur commits exactly what's typed (or unbinds if cleared); picking a
        // suggestion goes through onMouseDown below, which fires first.
        onBlur={() => onCommit(trimmed || null)}
        placeholder="repo name"
        aria-label={label}
        className="w-44 rounded border border-[var(--color-accent)] bg-transparent px-1.5 py-0.5 font-mono text-[11px] outline-none placeholder:text-[var(--color-faint)]"
      />
      {open && coords ? (
        <div
          ref={listRef}
          style={{ top: coords.top, left: coords.left, width: Math.max(coords.width, 176) }}
          className="fixed z-50 max-h-56 overflow-y-auto overscroll-contain rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-lg"
        >
          {items.map((it, i) => (
            <button
              key={(it.typed ? "typed:" : "opt:") + it.value}
              type="button"
              // onMouseDown (not onClick) so it fires before the input blur.
              onMouseDown={(e) => {
                e.preventDefault();
                onCommit(it.value);
              }}
              onMouseEnter={() => setHi(i)}
              className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left font-mono text-[11px] ${
                i === hi ? "bg-[var(--color-accent-soft)]" : ""
              }`}
            >
              {it.typed ? (
                <span className="font-sans text-[var(--color-faint)]">
                  Use “<span className="font-mono text-[var(--color-ink)]">{it.value}</span>”
                </span>
              ) : (
                <span className="truncate">{it.value}</span>
              )}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
