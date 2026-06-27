"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent,
} from "react";
import Link from "next/link";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { Byline } from "@/components/Byline";
import type { Project } from "@/lib/types";

export function ProjectsView({
  isOwner,
  viewerEmail,
}: {
  isOwner: boolean;
  viewerEmail: string;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [key, setKey] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const nameRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Project[]) => !cancelled && setProjects(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, []);

  // Focus the name field as soon as the add form opens (keyboard-first).
  useEffect(() => {
    if (adding) nameRef.current?.focus();
  }, [adding]);

  function openAdd() {
    setName("");
    setDescription("");
    setKey("");
    setIsPrivate(false);
    setError(null);
    setAdding(true);
  }

  // Esc / click the + again abandons the in-progress add (mykan add semantics).
  function closeAdd() {
    setAdding(false);
    setName("");
    setDescription("");
    setKey("");
    setIsPrivate(false);
  }

  // Live-suggested key from the typed name, matching the project-edit panel.
  const suggestedKey = (name.match(/[A-Za-z0-9]/g) ?? [])
    .join("")
    .slice(0, 4)
    .toUpperCase();

  async function createProject() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          description: description.trim() || null,
          key: key.trim().toUpperCase() || null,
          isPrivate,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = (await res.json()) as Project;
      startTransition(() => {
        setProjects((prev) => (prev ? [created, ...prev] : [created]));
        closeAdd();
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  }

  async function toggleVisibility(id: string, isPrivate: boolean) {
    const before = projects;
    setProjects((prev) =>
      prev?.map((p) => (p.id === id ? { ...p, is_private: isPrivate } : p)) ?? prev,
    );
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isPrivate }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = (await res.json()) as Project;
      setProjects((prev) => prev?.map((p) => (p.id === id ? updated : p)) ?? prev);
    } catch (e) {
      setProjects(before ?? null);
      setError(e instanceof Error ? e.message : "Failed to update visibility");
    }
  }

  async function deleteProject(id: string) {
    if (!confirm("Delete this project and all its items?")) return;
    const before = projects;
    setProjects((prev) => prev?.filter((p) => p.id !== id) ?? prev);
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      setProjects(before ?? null);
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  // Multi-line fields: ⌘/Ctrl+Enter creates, Esc abandons the in-progress add.
  function onFieldKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeAdd();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void createProject();
    }
  }

  // Key is a single-line input, so plain Enter creates; Esc abandons.
  function onKeyInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeAdd();
    } else if (e.key === "Enter") {
      e.preventDefault();
      void createProject();
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-[var(--color-muted)]">Projects</h2>
        <button
          type="button"
          onClick={() => (adding ? closeAdd() : openAdd())}
          aria-label={adding ? "Cancel new project" : "New project"}
          aria-expanded={adding}
          title={adding ? "Cancel" : "New project"}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#5b58d6] text-white transition-opacity hover:opacity-90"
        >
          <svg
            className={`h-4 w-4 transition-transform ${adding ? "rotate-45" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
      </div>

      {adding ? (
        <section className="mt-3 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <label className="block text-[10px] font-medium uppercase tracking-wide text-[var(--color-faint)]">
            Name
          </label>
          <AutoGrowTextarea
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onFieldKeyDown}
            placeholder="New project name…"
            className="mt-1 text-base font-semibold placeholder:text-[var(--color-faint)]"
            aria-label="Project name"
          />

          <label className="mt-3 block text-[10px] font-medium uppercase tracking-wide text-[var(--color-faint)]">
            Description
          </label>
          <AutoGrowTextarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={onFieldKeyDown}
            placeholder="Description (optional)"
            className="mt-1 text-sm text-[var(--color-muted)] placeholder:text-[var(--color-faint)]"
            aria-label="Project description"
          />

          <label className="mt-3 block text-[10px] font-medium uppercase tracking-wide text-[var(--color-faint)]">
            Key
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              value={key}
              onChange={(e) =>
                setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))
              }
              onKeyDown={onKeyInputKeyDown}
              placeholder={suggestedKey || "KEY"}
              maxLength={6}
              aria-label="Project key"
              className="w-24 rounded border border-[var(--color-line)] bg-transparent px-2 py-1 font-mono text-sm uppercase tracking-wide outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
            />
            <span className="font-mono text-xs text-[var(--color-faint)]">
              {(key.trim() || suggestedKey || "KEY")}-12 · prefixes item refs
            </span>
          </div>

          {isOwner ? (
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-xs text-[var(--color-faint)]">Visibility</span>
              <button
                type="button"
                onClick={() => setIsPrivate((v) => !v)}
                className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                  isPrivate
                    ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                    : "border-[var(--color-line)] text-[var(--color-faint)] hover:text-[var(--color-muted)]"
                }`}
                aria-pressed={isPrivate}
                aria-label={isPrivate ? "Make project shared" : "Make project private"}
                title={
                  isPrivate
                    ? "Private — only you can see this. Click to share."
                    : "Shared with everyone. Click to make private (only you)."
                }
              >
                {isPrivate ? "Private" : "Shared"}
              </button>
            </div>
          ) : null}

          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-[var(--color-faint)]">
              Enter for newline · ⌘/Ctrl+Enter to create · Esc to cancel
            </span>
            <button
              type="button"
              onClick={createProject}
              disabled={busy || !name.trim()}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Create
            </button>
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="mt-4 text-sm text-[var(--color-bug)]">{error}</p>
      ) : null}

      <section className="mt-6">
        {projects === null ? (
          <p className="text-sm text-[var(--color-faint)]">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--color-line)] px-4 py-10 text-center text-sm text-[var(--color-muted)]">
            No projects yet. Use “New project” to add one.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-line)]">
            {projects.map((p) => (
              <li key={p.id} className="group flex items-start gap-4 py-3">
                <Link
                  href={`/projects/${p.id}`}
                  className="flex min-w-0 flex-1 flex-col py-0.5"
                >
                  <span className="truncate font-medium group-hover:text-[var(--color-accent-ink)]">
                    {p.name}
                  </span>
                  {p.description ? (
                    <span className="mt-0.5 line-clamp-1 text-sm text-[var(--color-muted)]">
                      {p.description}
                    </span>
                  ) : null}
                  <Byline
                    createdBy={p.created_by}
                    updatedBy={p.updated_by}
                    updatedAt={p.updated_at}
                    className="mt-1"
                  />
                </Link>
                <div className="flex items-center gap-3 self-center">
                  {isOwner && p.created_by?.toLowerCase() === viewerEmail.toLowerCase() ? (
                    <button
                      type="button"
                      onClick={() => toggleVisibility(p.id, !p.is_private)}
                      className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                        p.is_private
                          ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                          : "border-[var(--color-line)] text-[var(--color-faint)] hover:text-[var(--color-muted)]"
                      }`}
                      aria-label={
                        p.is_private ? `Make ${p.name} shared` : `Make ${p.name} private`
                      }
                      title={
                        p.is_private
                          ? "Private — only you can see this. Click to share."
                          : "Shared with everyone. Click to make private (only you)."
                      }
                    >
                      {p.is_private ? "Private" : "Shared"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => deleteProject(p.id)}
                    className="invisible text-xs text-[var(--color-faint)] transition-colors hover:text-[var(--color-bug)] group-hover:visible"
                    aria-label={`Delete ${p.name}`}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
