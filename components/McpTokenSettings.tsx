"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { McpTokenSummary } from "@/lib/types";

/**
 * Personal MCP token manager for the top bar (KANBAN-30, Phase I.5a). A key icon
 * opens a floating panel where the current user mints, copies-once, and revokes
 * their own MCP bearer tokens. The plaintext `mk_…` value is shown exactly once
 * at creation and never returned again (only its hash is stored server-side).
 *
 * These tokens replace the single shared MYKAN_SERVICE_API_KEY: each call over
 * MCP is then attributed to the token's user → their GitHub PAT. Human-UI-only —
 * there is deliberately no MCP tool to mint a token. See docs/mcp-setup.md.
 */
const MCP_URL = "https://kanban.dbwoodward.com/mcp";

export function McpTokenSettings() {
  const [open, setOpen] = useState(false);
  const [tokens, setTokens] = useState<McpTokenSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The just-minted plaintext token, shown once. Cleared on close.
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<"token" | "command" | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef(false);

  const load = useCallback(() => {
    fetch("/api/mcp-tokens")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { tokens: McpTokenSummary[] }) => {
        setTokens(d.tokens);
        setListError(null);
      })
      // Keep the last-good list on a transient failure — never blank it (that
      // reads as "all my tokens got deleted"). Surface the error instead.
      .catch(() => setListError("Couldn’t load tokens — try reopening."));
  }, []);

  useEffect(() => {
    if (!open || fetchedRef.current) return;
    fetchedRef.current = true;
    load();
  }, [open, load]);

  // Dismiss on click-off / Esc. Closing also clears the one-time token reveal.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setFreshToken(null);
    setError(null);
    setCopied(null);
  }

  async function copy(text: string, which: "token" | "command") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      window.setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
    } catch {
      /* clipboard blocked — the value is selectable in the field anyway */
    }
  }

  async function generate() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/mcp-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label: label.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        token?: string;
        summary?: McpTokenSummary;
        error?: string;
      };
      if (!res.ok || !data.token) {
        setError(data.error ?? `Couldn’t generate (HTTP ${res.status}).`);
        return;
      }
      setFreshToken(data.token);
      setLabel("");
      // Prepend the new summary so the list reflects it without a refetch.
      if (data.summary) setTokens((prev) => [data.summary as McpTokenSummary, ...(prev ?? [])]);
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    const before = tokens;
    setTokens((prev) => (prev ? prev.filter((t) => t.id !== id) : prev));
    try {
      const res = await fetch(`/api/mcp-tokens/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setListError(null);
    } catch {
      setTokens(before ?? null);
      setListError("Couldn’t revoke — try again.");
    }
  }

  const command = freshToken
    ? `claude mcp add --transport http --scope user mykan ${MCP_URL} --header "Authorization: Bearer ${freshToken}"`
    : "";

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-label="MCP access tokens"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="MCP access tokens"
        className="grid h-8 w-8 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)]"
      >
        {/* Key icon */}
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
          <circle cx="7.5" cy="15.5" r="4.5" />
          <path d="M10.7 12.3 21 2m-4 4 2.5 2.5M14 9l2.5 2.5" />
        </svg>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="MCP access tokens"
          className="absolute right-0 top-full z-30 mt-2 w-[min(94vw,26rem)] rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-sm shadow-lg"
        >
          <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
            MCP access tokens
          </div>

          {/* One-time reveal of a just-minted token. */}
          {freshToken ? (
            <div className="mb-3 rounded border border-[var(--color-accent)] bg-[var(--color-accent-soft)] p-2">
              <p className="mb-1.5 text-[11px] font-medium text-[var(--color-accent-ink)]">
                Copy this token now — it won’t be shown again.
              </p>
              <div className="flex items-center gap-1.5">
                <input
                  readOnly
                  value={freshToken}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 rounded border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1 font-mono text-xs text-[var(--color-ink)]"
                />
                <button
                  type="button"
                  onClick={() => copy(freshToken, "token")}
                  className="shrink-0 rounded bg-[var(--color-accent)] px-2 py-1 text-xs font-medium text-white hover:opacity-90"
                >
                  {copied === "token" ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="mt-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wide text-[var(--color-faint)]">
                    Connect Claude Code
                  </span>
                  <button
                    type="button"
                    onClick={() => copy(command, "command")}
                    className="text-[11px] text-[var(--color-accent-ink)] hover:underline"
                  >
                    {copied === "command" ? "Copied" : "Copy command"}
                  </button>
                </div>
                <pre className="overflow-x-auto rounded border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-[var(--color-muted)]">
                  {command}
                </pre>
              </div>
            </div>
          ) : null}

          {/* Existing active tokens. */}
          {listError ? (
            <div className="mb-2 px-1 py-1 text-xs text-[var(--color-bug)]">{listError}</div>
          ) : null}
          {tokens === null ? (
            <div className="px-1 py-1 text-xs text-[var(--color-faint)]">
              {listError ? "" : "Loading…"}
            </div>
          ) : tokens.length === 0 ? (
            <div className="px-1 py-1 text-xs text-[var(--color-faint)]">
              No tokens yet. Generate one below to connect over MCP.
            </div>
          ) : (
            <ul className="mb-3 flex flex-col gap-1">
              {tokens.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-2 rounded px-1 py-1"
                >
                  <span className="inline-flex min-w-0 flex-col">
                    <span className="truncate font-medium">
                      {t.label || <span className="text-[var(--color-faint)]">Unlabeled</span>}
                    </span>
                    <span className="text-[10px] text-[var(--color-faint)]">
                      {t.last_used_at
                        ? `last used ${fmt(t.last_used_at)}`
                        : `created ${fmt(t.created_at)} · never used`}
                      {t.expires_at ? ` · expires ${fmt(t.expires_at)}` : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => revoke(t.id)}
                    aria-label={`Revoke ${t.label || "token"}`}
                    title="Revoke this token"
                    className="shrink-0 text-[var(--color-faint)] transition-colors hover:text-[var(--color-bug)]"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Generate form. */}
          <div className="flex flex-col gap-2 border-t border-[var(--color-line)] pt-3">
            <label className="block text-[10px] font-medium uppercase tracking-wide text-[var(--color-faint)]">
              Label (optional)
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. laptop, cron agent"
                autoComplete="off"
                spellCheck={false}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void generate();
                  }
                }}
                className="mt-1 w-full rounded border border-[var(--color-line)] bg-transparent px-2 py-1 text-sm normal-case tracking-normal text-[var(--color-ink)] focus:border-[var(--color-accent)] focus:outline-none"
              />
            </label>
            <p className="text-[11px] leading-snug text-[var(--color-faint)]">
              One token works for both interactive and headless/cron agents — no browser step. It
              carries your identity and your GitHub PAT reach, so treat it like a password and revoke
              any you don’t recognise.
            </p>
            {error ? <p className="text-xs text-[var(--color-bug)]">{error}</p> : null}
            <button
              type="button"
              onClick={() => void generate()}
              disabled={busy}
              className="mt-1 rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Generating…" : "Generate token"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
