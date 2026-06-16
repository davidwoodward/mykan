"use client";

import { useEffect, useState, useTransition, type KeyboardEvent } from "react";
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
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

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

  async function createProject() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed, description: description.trim() || null }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = (await res.json()) as Project;
      startTransition(() => {
        setProjects((prev) => (prev ? [created, ...prev] : [created]));
        setName("");
        setDescription("");
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

  function onNameKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void createProject();
    }
  }

  return (
    <>
      <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <AutoGrowTextarea
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onNameKeyDown}
          placeholder="New project name…"
          className="text-base placeholder:text-[var(--color-faint)]"
          aria-label="Project name"
        />
        {name.trim() ? (
          <>
            <AutoGrowTextarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onKeyDown={onNameKeyDown}
              placeholder="Description (optional)"
              className="mt-2 text-sm text-[var(--color-muted)] placeholder:text-[var(--color-faint)]"
              aria-label="Project description"
            />
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-[var(--color-faint)]">
                Enter for newline · ⌘/Ctrl+Enter to create
              </span>
              <button
                type="button"
                onClick={createProject}
                disabled={busy}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Create
              </button>
            </div>
          </>
        ) : null}
      </section>

      {error ? (
        <p className="mt-4 text-sm text-[var(--color-bug)]">{error}</p>
      ) : null}

      <section className="mt-8">
        {projects === null ? (
          <p className="text-sm text-[var(--color-faint)]">Loading…</p>
        ) : projects.length === 0 ? (
          <p className="rounded-md border border-dashed border-[var(--color-line)] px-4 py-10 text-center text-sm text-[var(--color-muted)]">
            No projects yet. Add one above.
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
