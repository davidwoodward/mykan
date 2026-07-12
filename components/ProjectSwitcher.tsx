"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Project } from "@/lib/types";

type Option =
  | { kind: "home" }
  | { kind: "project"; project: Project }
  | { kind: "new" };

/**
 * The back-chevron in the project nav opens a project picker instead of
 * navigating blindly: Home, every other project, and "+ New project" — the
 * three places that button was really taking people. Keyboard-first: opens
 * with the first row highlighted, ↑/↓ move, Enter goes, Esc closes; the list
 * is an overlay that floats over the content below.
 */
export function ProjectSwitcher({ currentId }: { currentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Load the project list once, lazily — but PREFETCH it rather than waiting for
  // the click. `/api/projects` is a different serverless function than the ones
  // the project page loads (items, categories), so it's stone cold on first
  // open: a click would pay a full Vercel cold start + first Supabase
  // connection (~2s). Prefetching on mount (deferred so it yields to the page's
  // own initial fetches) warms both the data and the function, so the menu opens
  // instantly. Guarded by a ref so it runs at most once regardless of trigger.
  const fetchedRef = useRef(false);
  const ensureProjects = useCallback(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Project[]) => setProjects(d))
      .catch(() => {
        // Let a later open retry a failed prefetch.
        fetchedRef.current = false;
        setProjects((prev) => prev ?? []);
      });
  }, []);

  useEffect(() => {
    const id = setTimeout(ensureProjects, 400);
    return () => clearTimeout(id);
  }, [ensureProjects]);

  // Click-off closes.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const options: Option[] = [
    { kind: "home" },
    ...(projects ?? [])
      .filter((p) => p.id !== currentId)
      .map((project) => ({ kind: "project" as const, project })),
    { kind: "new" },
  ];

  function toggle() {
    setHighlighted(0);
    ensureProjects(); // in case the deferred prefetch hasn't fired (or failed)
    setOpen((o) => !o);
  }

  function go(opt: Option) {
    setOpen(false);
    if (opt.kind === "home") router.push("/");
    else if (opt.kind === "new") router.push("/?new=1");
    else router.push(`/projects/${opt.project.id}`);
  }

  // Keyboard driving is document-level while open (not focus-dependent), so
  // ↑/↓/Enter/Esc work no matter where the click left the focus. Re-registers
  // when the list or highlight changes — cheap, and keeps the closure fresh.
  useEffect(() => {
    if (!open) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, options.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const opt = options[highlighted];
        if (opt) go(opt);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <div ref={wrapRef} className="relative ml-3 shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        onPointerEnter={ensureProjects}
        onFocus={ensureProjects}
        aria-label="Switch project"
        title="Switch project"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`grid h-8 w-8 place-items-center rounded-md transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)] ${
          open
            ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
            : "text-[var(--color-muted)]"
        }`}
      >
        <svg
          className="h-[18px] w-[18px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Switch project"
          className="absolute left-0 top-full z-30 mt-2 max-h-[60vh] w-64 overflow-y-auto rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] py-1 shadow-lg"
        >
          {options.map((opt, i) => {
            const highlight = i === highlighted;
            const rowClass = `flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors ${
              highlight
                ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                : "text-[var(--color-ink)]"
            }`;
            if (opt.kind === "home") {
              return (
                <button
                  key="home"
                  type="button"
                  role="menuitem"
                  onClick={() => go(opt)}
                  onMouseMove={() => setHighlighted(i)}
                  className={`${rowClass} border-b border-[var(--color-line)] pb-2 font-medium`}
                >
                  <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 10.5 12 3l9 7.5" />
                    <path d="M5 9.5V21h14V9.5" />
                  </svg>
                  Home — all projects
                </button>
              );
            }
            if (opt.kind === "new") {
              return (
                <button
                  key="new"
                  type="button"
                  role="menuitem"
                  onClick={() => go(opt)}
                  onMouseMove={() => setHighlighted(i)}
                  className={`${rowClass} border-t border-[var(--color-line)] pt-2 font-medium`}
                >
                  <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  New project
                </button>
              );
            }
            return (
              <button
                key={opt.project.id}
                type="button"
                role="menuitem"
                onClick={() => go(opt)}
                onMouseMove={() => setHighlighted(i)}
                className={rowClass}
              >
                <span className="min-w-0 flex-1 truncate">{opt.project.name}</span>
                {opt.project.key ? (
                  <span className="shrink-0 font-mono text-[10px] text-[var(--color-faint)]">
                    {opt.project.key}
                  </span>
                ) : null}
              </button>
            );
          })}
          {projects === null ? (
            <p className="px-3 py-1.5 text-sm text-[var(--color-faint)]">Loading…</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
