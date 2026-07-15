"use client";

import { useEffect, useRef, useState } from "react";
import { signOutAction } from "@/app/actions";
import { useKeyboardNav } from "@/components/useKeyboardNav";

/**
 * The top-bar profile menu (KANBAN-31). Replaces the old plaintext email + Sign
 * out cluster: an initials avatar opens a floating dropdown holding the user's
 * identity (top), Settings — the keyboard-forward navigation toggle — and Sign
 * out (bottom).
 *
 * The keyboard toggle shares `useKeyboardNav` with the board/list, so flipping
 * it here immediately arms/disarms the vim navigation over there (same tab, via
 * the store's listeners).
 */
export function ProfileMenu({
  name,
  email,
  keyboardDefault,
}: {
  name?: string | null;
  email: string;
  keyboardDefault: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { enabled: keyboardEnabled, setEnabled: setKeyboardEnabled } =
    useKeyboardNav(keyboardDefault);

  // Dismiss on click-off / Esc — the app-wide overlay convention.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const initials = deriveInitials(name, email);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title={name ? `${name} — ${email}` : email}
        className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-accent)] text-[13px] font-semibold text-white ring-1 ring-[var(--color-accent)]/40 transition-opacity hover:opacity-90"
      >
        {initials}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Profile"
          className="absolute right-0 top-full z-30 mt-2 w-[min(94vw,17rem)] overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] text-sm shadow-lg"
        >
          {/* Identity */}
          <div className="flex items-center gap-3 border-b border-[var(--color-line)] px-3 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--color-accent)] text-[13px] font-semibold text-white">
              {initials}
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
              {name ? (
                <span className="truncate font-medium text-[var(--color-ink)]">{name}</span>
              ) : null}
              <span className="truncate text-[var(--color-faint)]" title={email}>
                {email}
              </span>
            </span>
          </div>

          {/* Settings */}
          <div className="border-b border-[var(--color-line)] px-3 py-3">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
              Settings
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={keyboardEnabled}
              onClick={() => setKeyboardEnabled(!keyboardEnabled)}
              className="flex w-full items-start justify-between gap-3 text-left"
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-medium text-[var(--color-ink)]">
                  Keyboard-forward navigation
                </span>
                <span className="text-[11px] leading-snug text-[var(--color-faint)]">
                  Vim-style board keys: j/k select, g/G/0 jump, u/d reorder,
                  Ctrl-f/b move.
                </span>
              </span>
              <span
                aria-hidden="true"
                className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                  keyboardEnabled
                    ? "bg-[var(--color-accent)]"
                    : "bg-[var(--color-line)]"
                }`}
              >
                <span
                  className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                    keyboardEnabled ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </span>
            </button>
          </div>

          {/* Sign out */}
          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              className="block w-full px-3 py-2.5 text-left text-[var(--color-muted)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-ink)]"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Two-letter monogram: first letters of the first two name words, else the
 * first two of the email local part, always uppercased.
 */
function deriveInitials(name: string | null | undefined, email: string): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  const local = email.split("@")[0] ?? email;
  return local.slice(0, 2).toUpperCase();
}
