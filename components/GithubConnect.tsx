"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GithubConnection } from "@/lib/types";

/**
 * "Connect GitHub Account" control for the top bar (KANBAN-21 / GH-2). A GitHub
 * icon opens a floating panel where the current user connects an account by
 * pasting a fine-grained PAT. The PAT is validated against GitHub, encrypted, and
 * stored server-side — it is write-only and never rendered back (see
 * docs/github-integration.md §Authentication).
 *
 * Connections are per-user: the account is shared/global, but each user attaches
 * their own credential. An `invalid` status (set when GitHub later rejects the
 * token) surfaces a "Reconnect" prompt for that user alone.
 */
export function GithubConnect() {
  const [open, setOpen] = useState(false);
  const [connections, setConnections] = useState<GithubConnection[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [login, setLogin] = useState("");
  const [pat, setPat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const patRef = useRef<HTMLInputElement>(null);
  const fetchedRef = useRef(false);

  const load = useCallback(() => {
    fetch("/api/github/accounts")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { configured: boolean; accounts: GithubConnection[] }) => {
        setConfigured(d.configured);
        setConnections(d.accounts);
      })
      .catch(() => setConnections([]));
  }, []);

  // Load once on first open (fetch-in-callback, not synchronous setState-in-effect).
  useEffect(() => {
    if (!open || fetchedRef.current) return;
    fetchedRef.current = true;
    load();
  }, [open, load]);

  // Dismiss on click-off / Esc.
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

  const hasInvalid = (connections ?? []).some((c) => c.status === "invalid");

  async function connect() {
    if (busy) return;
    setError(null);
    if (!login.trim() || !pat.trim()) {
      setError("Enter both an account name and a token.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/github/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ login: login.trim(), pat: pat.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? `Couldn’t connect (HTTP ${res.status}).`);
        return;
      }
      // Success — clear the PAT immediately (never keep it around) and refresh.
      setPat("");
      setLogin("");
      load();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect(accountId: string) {
    try {
      await fetch(`/api/github/accounts/${accountId}`, { method: "DELETE" });
    } finally {
      load();
    }
  }

  function reconnect(accountLogin: string) {
    setLogin(accountLogin);
    setPat("");
    setError(null);
    patRef.current?.focus();
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Connect GitHub account"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Connect GitHub account"
        className="relative grid h-8 w-8 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)]"
      >
        <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="currentColor"
            d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.67 0-1.25.45-2.27 1.19-3.07-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.17a11.1 11.1 0 0 1 5.79 0c2.2-1.48 3.17-1.17 3.17-1.17.63 1.59.23 2.76.11 3.05.74.8 1.19 1.82 1.19 3.07 0 4.4-2.69 5.37-5.25 5.66.41.35.78 1.05.78 2.12 0 1.53-.01 2.77-.01 3.15 0 .31.21.68.8.56A10.52 10.52 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z"
          />
        </svg>
        {hasInvalid ? (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[var(--color-bug)] ring-2 ring-[var(--color-canvas)]"
          />
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="GitHub connections"
          className="absolute right-0 top-full z-30 mt-2 w-[min(92vw,24rem)] rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-sm shadow-lg"
        >
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
            GitHub connections
          </div>

          {/* Existing connections for this user. */}
          {connections === null ? (
            <div className="px-1 py-1 text-xs text-[var(--color-faint)]">Loading…</div>
          ) : connections.length === 0 ? (
            <div className="px-1 py-1 text-xs text-[var(--color-faint)]">
              No accounts connected yet.
            </div>
          ) : (
            <ul className="mb-3 flex flex-col gap-1">
              {connections.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded px-1 py-1"
                >
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <span className="truncate font-medium">{c.login}</span>
                    {c.status === "invalid" ? (
                      <span className="text-xs text-[var(--color-bug)]">
                        needs reconnect
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--color-accent-ink)]">Connected ✓</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {c.status === "invalid" ? (
                      <button
                        type="button"
                        onClick={() => reconnect(c.login)}
                        className="text-xs text-[var(--color-accent-ink)] hover:underline"
                      >
                        Reconnect
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => disconnect(c.id)}
                      aria-label={`Disconnect ${c.login}`}
                      title={`Disconnect ${c.login}`}
                      className="text-[var(--color-faint)] transition-colors hover:text-[var(--color-bug)]"
                    >
                      ✕
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Connect / reconnect form. */}
          {!configured ? (
            <div className="rounded border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-2 text-xs text-[var(--color-muted)]">
              GitHub connect isn’t set up on the server yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2 border-t border-[var(--color-line)] pt-3">
              <label className="block text-[10px] font-medium uppercase tracking-wide text-[var(--color-faint)]">
                Account or org
                <input
                  type="text"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="e.g. davidwoodward"
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-1 w-full rounded border border-[var(--color-line)] bg-transparent px-2 py-1 text-sm normal-case tracking-normal text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none"
                />
              </label>
              <label className="block text-[10px] font-medium uppercase tracking-wide text-[var(--color-faint)]">
                Fine-grained PAT
                <input
                  ref={patRef}
                  type="password"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  placeholder="github_pat_…"
                  autoComplete="off"
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void connect();
                    }
                  }}
                  className="mt-1 w-full rounded border border-[var(--color-line)] bg-transparent px-2 py-1 text-sm normal-case tracking-normal text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none"
                />
              </label>
              <p className="text-[11px] leading-snug text-[var(--color-faint)]">
                Create a fine-grained token with <span className="font-medium">Metadata: read</span>{" "}
                and <span className="font-medium">Issues: read &amp; write</span>, then paste it
                here.{" "}
                <a
                  href="https://github.com/settings/personal-access-tokens/new"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--color-accent-ink)] hover:underline"
                >
                  New token ↗
                </a>
              </p>
              {error ? (
                <p className="text-xs text-[var(--color-bug)]">{error}</p>
              ) : null}
              <button
                type="button"
                onClick={() => void connect()}
                disabled={busy}
                className="mt-1 rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Connecting…" : "Connect"}
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
