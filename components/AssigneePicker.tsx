"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { displayName } from "@/lib/format";
import { sameMembers } from "@/lib/abandon";
import { AbandonButton } from "@/components/AbandonButton";
import type { Item } from "@/lib/types";

type AssigneeConfig = {
  /** Candidate members (whitelist emails). */
  members: string[];
  /** Assignees are only meaningful on shared projects. */
  enabled: boolean;
  /** Called once when the list closes with a changed selection. */
  onChange: (id: string, assignees: string[]) => void | Promise<unknown>;
};

const AssigneeContext = createContext<AssigneeConfig | null>(null);
export const AssigneeProvider = AssigneeContext.Provider;

function initial(email: string): string {
  return displayName(email).charAt(0).toUpperCase() || "?";
}

/** A small circular initial for a member. */
function Avatar({ email, dim = false }: { email: string; dim?: boolean }) {
  return (
    <span
      title={displayName(email)}
      className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-medium ${
        dim
          ? "bg-[var(--color-canvas)] text-[var(--color-faint)] ring-1 ring-inset ring-[var(--color-line)]"
          : "bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
      }`}
    >
      {initial(email)}
    </span>
  );
}

/**
 * Inline, keyboard-first multi-assignee control for an item — mirrors the tag
 * UX: a compact trigger that opens a floating member list (overlay, doesn't
 * push content). ↑/↓ move, Enter toggles, Esc closes; mouse works too. Renders
 * nothing on private projects (assignees there are meaningless).
 */
export function ItemAssignees({
  item,
  className = "",
}: {
  item: Item;
  className?: string;
}) {
  const cfg = useContext(AssigneeContext);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Draft model (KANBAN-42): toggles change a local list while it's open;
  // closing it (Esc, click-off, the trigger) saves once if the list changed,
  // and Abandon changes closes without writing.
  const [draft, setDraft] = useState<string[]>([]);
  const opened = useRef<string[]>([]);
  const finishRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        finishRef.current();
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    finishRef.current = finish;
  });

  if (!cfg || !cfg.enabled || cfg.members.length === 0) return null;
  const { members } = cfg;
  const assignees = open ? draft : (item.assignees ?? []);

  function toggle(email: string) {
    setDraft((cur) => (cur.includes(email) ? cur.filter((e) => e !== email) : [...cur, email]));
  }

  function openList() {
    const current = item.assignees ?? [];
    opened.current = [...current];
    setDraft([...current]);
    setOpen(true);
  }

  // One save when the list closes, only if it changed.
  function finish() {
    setOpen(false);
    if (!sameMembers(draft, opened.current)) void cfg?.onChange(item.id, draft);
  }

  function abandon() {
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      finish();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(members.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      toggle(members[hi]);
    }
  }

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => (open ? finish() : openList())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Assignees"
        title="Assign members"
        className="flex items-center gap-0.5 rounded transition-opacity hover:opacity-90"
      >
        {assignees.length === 0 ? (
          <span className="text-[11px] text-[var(--color-faint)] hover:text-[var(--color-muted)]">
            + assign
          </span>
        ) : (
          assignees.map((e) => <Avatar key={e} email={e} />)
        )}
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1 min-w-40 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-lg">
          <div className="flex items-center justify-between gap-2 pl-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
            Assignees
            <AbandonButton size="sm" onAbandon={abandon} />
          </div>
          <div role="listbox" aria-label="Members">
          {members.map((m, i) => {
            const checked = assignees.includes(m);
            return (
              <button
                key={m}
                type="button"
                role="option"
                aria-selected={checked}
                onMouseEnter={() => setHi(i)}
                onClick={() => toggle(m)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${
                  i === hi ? "bg-[var(--color-accent-soft)]" : ""
                }`}
              >
                <span className="w-3 text-[var(--color-accent-ink)]">
                  {checked ? "✓" : ""}
                </span>
                <Avatar email={m} dim={!checked} />
                <span className="truncate">{displayName(m)}</span>
              </button>
            );
          })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
