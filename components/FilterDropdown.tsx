"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

/**
 * A desktop toolbar dropdown (KANBAN-67): one trigger whose label is the
 * current value ("Status: All", "Type: Epic", "Group: Area") and a floating
 * list beneath it. `multiple` makes it a checkbox list (Status, Type) that
 * stays open while you toggle; otherwise one pick applies and closes (Group).
 *
 * Opens on click, or ↓/Enter/Space on the trigger; first row highlighted;
 * ↑/↓ move; Enter or Space toggles/picks; Esc and a press outside close; Tab
 * moves on and closes. Keys handled here never reach the board's j/k/Enter.
 */
export function FilterDropdown<T extends string>({
  label,
  options,
  value,
  onChange,
  multiple = false,
  allLabel = "All",
}: {
  label: string;
  options: readonly (readonly [T, string])[];
  value: readonly T[];
  onChange: (next: T[]) => void;
  multiple?: boolean;
  /** Trigger text when nothing is picked (multi-select only). */
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    // Esc closes even when focus isn't in the menu (Safari doesn't focus a
    // clicked button); stopped here so the board underneath doesn't act on it.
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const nameOf = (v: T) => options.find(([k]) => k === v)?.[1] ?? v;
  const summary =
    value.length === 0
      ? allLabel
      : value.length === 1
        ? nameOf(value[0])
        : `${nameOf(value[0])} +${value.length - 1}`;
  const filtered = multiple && value.length > 0;

  function choose(v: T) {
    if (!multiple) {
      onChange([v]);
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  }

  function openMenu() {
    // Highlight the current pick (single) or the first row (multi).
    const cur = multiple ? -1 : options.findIndex(([k]) => k === value[0]);
    setHi(cur >= 0 ? cur : 0);
    setOpen(true);
    // Keys go to the menu however it was opened (a click may not focus).
    triggerRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Tab") {
      setOpen(false);
      return;
    }
    if (!open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        openMenu();
      }
      return;
    }
    // Everything else stays inside the open menu (no board j/k/Enter/Esc).
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(options.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = options[hi];
      if (opt) choose(opt[0]);
    }
  }

  return (
    <div ref={wrapRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${summary}`}
        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm transition-colors ${
          filtered
            ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
            : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
        }`}
      >
        <span className={filtered ? "" : "text-[var(--color-faint)]"}>{label}:</span>
        <span className="max-w-[9rem] truncate">{summary}</span>
        <svg
          className="h-3.5 w-3.5 opacity-70"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={label}
          aria-multiselectable={multiple || undefined}
          className="absolute left-0 top-full z-30 mt-1 min-w-[10rem] rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-1 text-sm shadow-md"
        >
          {options.map(([v, name], i) => {
            const on = value.includes(v);
            return (
              <button
                key={v}
                type="button"
                role="option"
                aria-selected={on}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(v)}
                onMouseEnter={() => setHi(i)}
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[var(--color-ink)] ${
                  i === hi ? "bg-[var(--color-accent-soft)]" : ""
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`grid h-4 w-4 shrink-0 place-items-center ${
                    multiple
                      ? `rounded border ${
                          on
                            ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white"
                            : "border-[var(--color-line-strong)]"
                        }`
                      : "text-[var(--color-accent-ink)]"
                  }`}
                >
                  {on ? (
                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12.5 10 17 19 7" />
                    </svg>
                  ) : null}
                </span>
                {name}
              </button>
            );
          })}
          {multiple && value.length > 0 ? (
            <button
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onChange([])}
              className="mt-1 w-full border-t border-[var(--color-line)] px-2 pb-0.5 pt-1.5 text-left text-xs text-[var(--color-faint)] hover:text-[var(--color-ink)]"
            >
              Show all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
