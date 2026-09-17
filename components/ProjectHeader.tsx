"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { Byline } from "@/components/Byline";
import { AbandonButton } from "@/components/AbandonButton";
import { ProjectShareControl } from "@/components/ProjectShareControl";
import type { Project } from "@/lib/types";
import { KEY_MAX, keyError, normalizeKeyInput, projectPath } from "@/lib/card-url";
import { keyRenameWarning, pathAfterRename } from "@/lib/key-rename";

type Status = "idle" | "saving" | "error";

/** Order-insensitive equality for two member-email lists. */
function sameMembers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((x, i) => x === sb[i]);
}

/**
 * The project title in the nav, with an inline pencil-edit affordance.
 * Editing follows mykan's implicit-save feel: opening the editor seeds drafts
 * from the current values; Esc, a click-off, or the ✓ button all commit and
 * close (leaving the editor keeps your work). The Shared/Private toggle is the
 * same setting shown on the projects list — surfaced here too for the owner.
 *
 * The key can be renamed (KANBAN-45). A changed key is never saved silently:
 * finishing the editor first shows a warning (what changes, what keeps
 * working). Enter or "Rename key" confirms and saves; Esc, "Keep OLD" or a
 * press outside the warning drops just the key change and keeps editing.
 */
export function ProjectHeader({
  project: initial,
  isOwner,
  viewerEmail,
  allMembers,
}: {
  project: Project;
  isOwner: boolean;
  viewerEmail: string;
  /** The full whitelist — share candidates offered to the owner. */
  allMembers: string[];
}) {
  const router = useRouter();
  const [project, setProject] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [key, setKey] = useState(initial.key ?? "");
  const [sharedWith, setSharedWith] = useState<string[]>(initial.shared_with ?? []);
  const [githubAccountId, setGithubAccountId] = useState<string | null>(
    initial.github_account_id ?? null,
  );
  const [ghAccounts, setGhAccounts] = useState<{ id: string; login: string }[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  /** The project's old keys, which still redirect here (KANBAN-45). Loaded on open. */
  const [keyAliases, setKeyAliases] = useState<string[]>([]);
  /** A key change is waiting for its warning to be confirmed. */
  const [confirmingKey, setConfirmingKey] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLTextAreaElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);
  const warningRef = useRef<HTMLDivElement>(null);
  // Always points at the latest commit() so the click-off listener (registered
  // once when the editor opens) sees current draft values, not stale ones.
  const commitRef = useRef<(opts?: { keyConfirmed?: boolean }) => void>(() => {});
  const cancelKeyChangeRef = useRef<() => void>(() => {});

  const canToggleVisibility =
    isOwner && project.created_by?.toLowerCase() === viewerEmail.toLowerCase();

  // Load the connectable GitHub accounts for the picker. Keeps the last-good
  // list on a transient failure (a lapsed session used to blank it, so the
  // dropdown showed only "None" as if no account were connected).
  const loadAccounts = useCallback(() => {
    fetch("/api/github/accounts/all")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { accounts: { id: string; login: string }[] }) => setGhAccounts(d.accounts ?? []))
      .catch(() => {});
  }, []);

  // Prefetch on mount so the accounts are ready the moment the panel opens —
  // one less thing depending on a well-timed request when you hit Edit.
  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  function open() {
    setName(project.name);
    setDescription(project.description ?? "");
    setKey(project.key ?? "");
    setSharedWith(project.shared_with ?? []);
    setGithubAccountId(project.github_account_id ?? null);
    setStatus("idle");
    setSaveError(null);
    setConfirmingKey(false);
    setEditing(true);
    loadAccounts(); // refresh in case an account was just connected
    // Old keys: only the panel shows them, so they're fetched here rather than
    // on every board/card page render. Keeps the last-good list on failure.
    fetch(`/api/projects/${project.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Project) => {
        if (Array.isArray(d.key_aliases)) setKeyAliases(d.key_aliases);
      })
      .catch(() => {});
  }

  // The set of fields that actually differ from the saved project. Drives both
  // the save (what to PATCH) and whether the ✓ button is enabled.
  function buildPatch(): Record<string, unknown> {
    const trimmedName = name.trim();
    const nextDescription = description.trim() || null;
    const nextKey = normalizeKeyInput(key);
    const patch: Record<string, unknown> = {};
    if (trimmedName && trimmedName !== project.name) patch.name = trimmedName;
    if (nextDescription !== project.description) patch.description = nextDescription;
    // A blank key field means "leave it"; a key can't be cleared.
    if (nextKey && nextKey !== project.key) patch.key = nextKey;
    if (canToggleVisibility && !sameMembers(sharedWith, project.shared_with ?? [])) {
      patch.sharedWith = sharedWith;
    }
    if (githubAccountId !== (project.github_account_id ?? null)) {
      patch.github_account_id = githubAccountId;
    }
    return patch;
  }

  async function commit(opts: { keyConfirmed?: boolean } = {}) {
    if (status === "saving") return;
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    const nextKey = typeof patch.key === "string" ? patch.key : null;
    if (nextKey) {
      const problem = keyError(nextKey);
      if (problem) {
        setSaveError(problem);
        setStatus("error");
        keyInputRef.current?.focus();
        return;
      }
      // Renaming a key is never silent: warn first.
      if (!opts.keyConfirmed) {
        setConfirmingKey(true);
        return;
      }
    }

    setStatus("saving");
    setSaveError(null);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const msg = await res
          .json()
          .then((d: { error?: unknown }) => (typeof d.error === "string" ? d.error : null))
          .catch(() => null);
        throw new Error(msg ?? `HTTP ${res.status}`);
      }
      const updated = (await res.json()) as Project;
      const oldKey = project.key;
      setProject(updated);
      if (updated.key_aliases) setKeyAliases(updated.key_aliases);
      setConfirmingKey(false);
      setEditing(false);
      setStatus("idle");
      // A renamed key moves this page: /OLD -> /NEW, /OLD-7 -> /NEW-7 (the old
      // URL would redirect anyway; going there directly skips the hop).
      const moved =
        nextKey && oldKey && updated.key
          ? pathAfterRename(window.location.pathname, oldKey, updated.key)
          : null;
      if (moved) {
        router.replace(`${moved}${window.location.search}`);
      } else {
        // Refresh server components (page title fetch, projects list) in the bg.
        router.refresh();
      }
    } catch (err) {
      setConfirmingKey(false);
      setSaveError(err instanceof Error ? err.message : null);
      setStatus("error");
    }
  }

  /** Drop just the key change (the warning's cancel) and keep editing. */
  function cancelKeyChange() {
    setConfirmingKey(false);
    setKey(project.key ?? "");
    requestAnimationFrame(() => keyInputRef.current?.focus());
  }

  // Keep the ref pointed at the latest commit (every render).
  useEffect(() => {
    commitRef.current = commit;
    cancelKeyChangeRef.current = cancelKeyChange;
  });

  // Esc commits + closes (mykan "I'm done" semantics); click-off does too.
  // While the rename warning is up, a press outside the warning cancels just
  // the key change (it never saves the rename silently).
  const confirmingRef = useRef(false);
  useEffect(() => {
    confirmingRef.current = confirmingKey;
  }, [confirmingKey]);

  useEffect(() => {
    if (!editing) return;
    nameRef.current?.focus();
    nameRef.current?.select();

    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (confirmingRef.current) {
        if (!warningRef.current?.contains(target)) cancelKeyChangeRef.current();
        return;
      }
      if (wrapRef.current && !wrapRef.current.contains(target)) {
        commitRef.current();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [editing]);

  // The warning owns Enter (confirm) and Esc (cancel) while it is up. Captured
  // at the document and stopped there, so no field, board shortcut or card page
  // Esc handler also acts on the same key. Enter on the warning's other button
  // (Keep OLD, reached with Tab) presses that button instead.
  useEffect(() => {
    if (!confirmingKey) return;
    warningRef.current?.querySelector<HTMLButtonElement>("button[data-primary]")?.focus();
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        cancelKeyChangeRef.current();
        return;
      }
      const active = document.activeElement;
      if (active instanceof HTMLButtonElement && warningRef.current?.contains(active)) {
        active.click();
      } else {
        void commitRef.current({ keyConfirmed: true });
      }
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [confirmingKey]);

  function onFieldKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void commit();
    }
  }

  // Key is a single-line input, so plain Enter (not ⌘/Ctrl+Enter) commits.
  function onKeyInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape" || e.key === "Enter") {
      e.preventDefault();
      void commit();
    }
  }

  const dirty = editing && Object.keys(buildPatch()).length > 0;
  const draftKey = normalizeKeyInput(key);
  const keyChanged = !!draftKey && draftKey !== project.key;
  const keyProblem = keyChanged ? keyError(draftKey) : null;
  const warning =
    confirmingKey && project.key && keyChanged
      ? keyRenameWarning({
          from: project.key,
          to: draftKey,
          ownOldKey: keyAliases.includes(draftKey),
        })
      : null;

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

          <label className="mt-3 block text-[10px] font-medium uppercase tracking-wide text-[var(--color-faint)]">
            Key
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              ref={keyInputRef}
              value={key}
              onChange={(e) => {
                setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, KEY_MAX));
                if (status === "error") setStatus("idle");
              }}
              onKeyDown={onKeyInputKeyDown}
              placeholder={project.key ?? "KEY"}
              maxLength={KEY_MAX}
              aria-label="Project key"
              aria-invalid={keyProblem ? true : undefined}
              aria-describedby="project-key-hint"
              disabled={confirmingKey || status === "saving"}
              className="w-28 rounded border border-[var(--color-line)] bg-transparent px-2 py-1 font-mono text-sm uppercase tracking-wide outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)] disabled:opacity-60"
            />
            <span className="font-mono text-xs text-[var(--color-faint)]">
              {projectPath(draftKey || project.key || "KEY")} · {draftKey || project.key || "KEY"}-12
            </span>
          </div>
          <p
            id="project-key-hint"
            className={`mt-1 text-[11px] leading-snug ${
              keyProblem ? "text-[var(--color-bug)]" : "text-[var(--color-faint)]"
            }`}
          >
            {keyProblem ??
              (keyChanged
                ? `Renames every card ref. Old ${project.key} links keep working.`
                : "The project's address and card prefix. Renaming keeps old links working.")}
          </p>
          {keyAliases.length > 0 ? (
            <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-faint)]">
              Old keys, still redirecting here:{" "}
              <span className="font-mono">{keyAliases.join(", ")}</span>
            </p>
          ) : null}

          <label className="mt-3 block text-[10px] font-medium uppercase tracking-wide text-[var(--color-faint)]">
            GitHub account
          </label>
          <select
            value={githubAccountId ?? ""}
            onChange={(e) => setGithubAccountId(e.target.value || null)}
            aria-label="GitHub account"
            className="mt-1 w-full rounded border border-[var(--color-line)] bg-transparent px-2 py-1 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
          >
            <option value="">None</option>
            {ghAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.login}
              </option>
            ))}
            {githubAccountId && !ghAccounts.some((a) => a.id === githubAccountId) ? (
              <option value={githubAccountId}>
                {project.github_account ?? "connected account"}
              </option>
            ) : null}
          </select>
          <p className="mt-1 text-[11px] leading-snug text-[var(--color-faint)]">
            Issues import into this project&rsquo;s areas that are mapped to repos in this account.
          </p>

          {canToggleVisibility ? (
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-xs text-[var(--color-faint)]">Shared with</span>
              <ProjectShareControl
                sharedWith={sharedWith}
                candidates={allMembers}
                ownerEmail={project.created_by}
                canEdit
                onChange={setSharedWith}
              />
            </div>
          ) : null}

          {warning ? (
            <div
              ref={warningRef}
              role="alertdialog"
              aria-labelledby="project-key-warning-title"
              aria-describedby="project-key-warning-body"
              className="mt-3 rounded-md border border-[var(--color-line-strong)] bg-[var(--color-canvas)] p-3"
            >
              <p
                id="project-key-warning-title"
                className="text-sm font-semibold text-[var(--color-ink)]"
              >
                {warning.title}
              </p>
              <div id="project-key-warning-body" className="mt-1 space-y-1">
                {warning.lines.map((line) => (
                  <p key={line} className="text-xs leading-snug text-[var(--color-muted)]">
                    {line}
                  </p>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-primary
                  onClick={() => void commit({ keyConfirmed: true })}
                  disabled={status === "saving"}
                  className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {status === "saving" ? "Renaming…" : "Rename key"}
                </button>
                <button
                  type="button"
                  onClick={cancelKeyChange}
                  disabled={status === "saving"}
                  className="rounded-md px-3 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
                >
                  Keep {project.key}
                </button>
                <span className="text-[10px] text-[var(--color-faint)]">Enter renames · Esc keeps {project.key}</span>
              </div>
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
            {/* Nothing saves until commit, so abandoning drops the drafts. */}
            <AbandonButton
              tooltipAlign="left"
              disabled={status === "saving"}
              onAbandon={() => {
                setStatus("idle");
                setSaveError(null);
                setConfirmingKey(false);
                setEditing(false);
              }}
            />
            <span className="text-[10px] text-[var(--color-faint)]">
              {status === "saving"
                ? "Saving…"
                : status === "error"
                  ? saveError
                    ? `Save failed: ${saveError}`
                    : "Save failed — retry"
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
