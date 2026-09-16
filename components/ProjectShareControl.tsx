"use client";

import { useEffect, useRef, useState } from "react";
import { displayName } from "@/lib/format";
import { createAbandonSession, type AbandonSession } from "@/lib/abandon";
import { AbandonButton } from "@/components/AbandonButton";

/** A small circular initial for a shared member (mirrors the assignee avatar). */
function ShareAvatar({ email }: { email: string }) {
  return (
    <span
      title={displayName(email)}
      className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[10px] font-medium text-[var(--color-accent-ink)] ring-1 ring-inset ring-[var(--color-line)]"
    >
      {displayName(email).charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function LockIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

/**
 * Manage (or, for non-owners, just display) who a project is shared with.
 * Empty = Private (owner only). The trigger shows "Private" or the shared
 * members' avatars; the owner opens a floating checklist to toggle members.
 * `candidates` is the full whitelist; the owner is excluded (always implicit).
 */
export function ProjectShareControl({
  sharedWith,
  candidates,
  ownerEmail,
  canEdit,
  onChange,
  className = "",
}: {
  sharedWith: string[];
  candidates: string[];
  ownerEmail: string | null;
  canEdit: boolean;
  /** May return the save's promise, so Abandon can wait for it. */
  onChange: (next: string[]) => void | Promise<unknown>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // Abandon changes (KANBAN-42): the sharing as it was when the checklist
  // opened. Each toggle is saved (or, inside a draft form, staged) at once, so
  // abandoning writes the as-opened list back through onChange.
  const session = useRef<AbandonSession<{ sharedWith: string[] }> | null>(null);
  const [reverting, setReverting] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const owner = (ownerEmail ?? "").toLowerCase();
  const options = candidates.filter((e) => e.toLowerCase() !== owner);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function toggle(email: string) {
    const next = sharedWith.includes(email)
      ? sharedWith.filter((e) => e !== email)
      : [...sharedWith, email];
    const run = async () => {
      await onChange(next);
    };
    if (session.current) void session.current.save({ sharedWith: next }, run).catch(() => {});
    else void run();
  }

  function openChecklist() {
    session.current = createAbandonSession(
      { sharedWith: [...sharedWith] },
      { equal: (_k, a, b) => sameSet(a as string[], b as string[]) },
    );
    setOpen(true);
  }

  async function abandon() {
    const s = session.current;
    if (!s || reverting) return;
    setReverting(true);
    try {
      await s.abandon({
        revert: async (patch) => {
          await onChange(patch.sharedWith ?? []);
        },
      });
      setOpen(false);
    } catch {
      // The revert failed; keep the checklist open (the parent surfaces errors).
    } finally {
      setReverting(false);
    }
  }

  const label =
    sharedWith.length === 0 ? (
      <span className="inline-flex items-center gap-1 text-[var(--color-muted)]">
        <LockIcon /> Private
      </span>
    ) : (
      <span className="inline-flex items-center gap-1">
        <span className="text-[var(--color-muted)]">Shared</span>
        <span className="flex -space-x-1">
          {sharedWith.map((e) => (
            <ShareAvatar key={e} email={e} />
          ))}
        </span>
      </span>
    );

  // Non-owners see the state read-only (no popover).
  if (!canEdit) {
    return (
      <span className={`inline-flex items-center text-xs ${className}`}>{label}</span>
    );
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openChecklist())}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Manage who this project is shared with"
        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ring-1 ring-inset ring-[var(--color-line)] transition-colors hover:bg-[var(--color-canvas)]"
      >
        {label}
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label="Share with"
          className="absolute right-0 z-30 mt-1 min-w-48 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 pl-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
            Shared with
            <AbandonButton size="sm" onAbandon={() => void abandon()} disabled={reverting} />
          </div>
          {options.length === 0 ? (
            <div className="px-2 py-1 text-xs text-[var(--color-faint)]">
              No other members
            </div>
          ) : (
            options.map((m) => {
              const checked = sharedWith.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggle(m)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-[var(--color-canvas)]"
                >
                  <span className="w-3 text-[var(--color-accent-ink)]">
                    {checked ? "✓" : ""}
                  </span>
                  <ShareAvatar email={m} />
                  <span className="truncate">{displayName(m)}</span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Order-insensitive equality for two email lists. */
function sameSet(a: string[] = [], b: string[] = []): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b.map((e) => e.toLowerCase()));
  return a.every((e) => sb.has(e.toLowerCase()));
}
