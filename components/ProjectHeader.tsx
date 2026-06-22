"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { Byline } from "@/components/Byline";
import type { Project } from "@/lib/types";

type Status = "idle" | "saving" | "error";

/**
 * The project title in the nav, with an inline pencil-edit affordance.
 * Editing follows mykan's implicit-save feel: opening the editor seeds drafts
 * from the current values; Esc, a click-off, or the ✓ button all commit and
 * close (leaving the editor keeps your work). The Shared/Private toggle is the
 * same setting shown on the projects list — surfaced here too for the owner.
 */
export function ProjectHeader({
  project: initial,
  isOwner,
  viewerEmail,
}: {
  project: Project;
  isOwner: boolean;
  viewerEmail: string;
}) {
  const router = useRouter();
  const [project, setProject] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [isPrivate, setIsPrivate] = useState(initial.is_private);
  const [status, setStatus] = useState<Status>("idle");

  const wrapRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLTextAreaElement>(null);
  // Always points at the latest commit() so the click-off listener (registered
  // once when the editor opens) sees current draft values, not stale ones.
  const commitRef = useRef<() => void>(() => {});

  const canToggleVisibility =
    isOwner && project.created_by?.toLowerCase() === viewerEmail.toLowerCase();

  function open() {
    setName(project.name);
    setDescription(project.description ?? "");
    setIsPrivate(project.is_private);
    setStatus("idle");
    setEditing(true);
  }

  // The set of fields that actually differ from the saved project. Drives both
  // the save (what to PATCH) and whether the ✓ button is enabled.
  function buildPatch(): Record<string, unknown> {
    const trimmedName = name.trim();
    const nextDescription = description.trim() || null;
    const patch: Record<string, unknown> = {};
    if (trimmedName && trimmedName !== project.name) patch.name = trimmedName;
    if (nextDescription !== project.description) patch.description = nextDescription;
    if (canToggleVisibility && isPrivate !== project.is_private) {
      patch.isPrivate = isPrivate;
    }
    return patch;
  }

  async function commit() {
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }

    setStatus("saving");
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = (await res.json()) as Project;
      setProject(updated);
      setEditing(false);
      setStatus("idle");
      // Refresh server components (page title fetch, projects list) in the bg.
      router.refresh();
    } catch {
      setStatus("error");
    }
  }

  // Keep the ref pointed at the latest commit (every render).
  useEffect(() => {
    commitRef.current = commit;
  });

  // Esc commits + closes (mykan "I'm done" semantics); click-off does too.
  useEffect(() => {
    if (!editing) return;
    nameRef.current?.focus();
    nameRef.current?.select();

    function onPointerDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        commitRef.current();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [editing]);

  function onFieldKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void commit();
    }
  }

  const dirty = editing && Object.keys(buildPatch()).length > 0;

  return (
    <div ref={wrapRef} className="relative flex min-w-0 items-center gap-1.5">
      <div className="flex min-w-0 items-baseline gap-2">
        <h1
          className="truncate text-base font-semibold tracking-tight"
          title={project.description ?? undefined}
        >
          {project.name}
        </h1>
        <Byline
          createdBy={project.created_by}
          updatedBy={project.updated_by}
          updatedAt={project.updated_at}
          className="hidden shrink-0 sm:inline"
        />
      </div>

      <button
        type="button"
        onClick={() => (editing ? void commit() : open())}
        aria-label="Edit project"
        title="Edit project"
        aria-expanded={editing}
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)] ${
          editing ? "text-[var(--color-accent-ink)]" : "text-[var(--color-faint)]"
        }`}
      >
        <svg
          className="h-[18px] w-[18px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      </button>

      {editing ? (
        <div className="absolute left-0 top-full z-30 mt-2 w-[min(90vw,24rem)] rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3 shadow-lg">
          <label className="block text-[10px] font-medium uppercase tracking-wide text-[var(--color-faint)]">
            Name
          </label>
          <AutoGrowTextarea
            ref={nameRef}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onFieldKeyDown}
            placeholder="Project name…"
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

          {canToggleVisibility ? (
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

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void commit()}
              disabled={status === "saving" || !dirty}
              aria-label="Save project"
              title={dirty ? "Save" : "No changes to save"}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[var(--color-accent)] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg
                className="h-[18px] w-[18px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </button>
            <span className="text-[10px] text-[var(--color-faint)]">
              {status === "saving"
                ? "Saving…"
                : status === "error"
                  ? "Save failed — retry"
                  : dirty
                    ? "Esc or click away to save"
                    : "No changes"}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
