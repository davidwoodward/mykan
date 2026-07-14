"use client";

import { useState } from "react";
import { githubIssueUrl, parseGithubIssue, type Item } from "@/lib/types";
import { shortDate } from "@/lib/format";

/**
 * At-a-glance GitHub provenance for a linked item (KANBAN-24): the issue link,
 * when the issue was opened on GitHub, when it was pulled into mykan, and a
 * manual Refresh. Refresh is the ONLY way a linked item re-syncs from GitHub —
 * it OVERWRITES the item's title/body + tags with the issue's current state
 * (recoverable from history) — so it confirms first. Renders nothing for an
 * unlinked item. `className` lets callers control layout/visibility (e.g. the
 * list row shows it far-right on large screens only; the detail modal always).
 */
export function GithubItemMeta({
  item,
  onItemChange,
  className = "",
}: {
  item: Item;
  onItemChange: (item: Item) => void;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!item.github_issue) return null;

  const parts = parseGithubIssue(item.github_issue);
  const url = githubIssueUrl(item.github_issue);
  const opened = shortDate(item.github_issue_created_at);
  const imported = shortDate(item.github_imported_at);

  async function refresh() {
    if (busy) return;
    if (
      !window.confirm(
        "Refresh from GitHub? This overwrites this item's title, body, and tags with the issue's current content. (The previous version stays in history.)",
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/items/${item.id}/github/refresh`, { method: "POST" });
      if (res.ok) {
        onItemChange((await res.json()) as Item);
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setErr(body?.error ?? `Refresh failed (${res.status})`);
      }
    } catch {
      setErr("Couldn’t reach the server — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span
      className={`flex items-center gap-x-2 gap-y-0.5 text-[10px] leading-none text-[var(--color-faint)] ${className}`}
    >
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`Open ${item.github_issue} on GitHub`}
          className="inline-flex items-center gap-1 transition-colors hover:text-[var(--color-ink)]"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3" aria-hidden="true">
            <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.42c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.3-1.7-1.3-1.7-1.06-.72.08-.71.08-.71 1.17.08 1.79 1.2 1.79 1.2 1.04 1.79 2.73 1.27 3.4.97.1-.76.4-1.27.74-1.56-2.56-.29-5.26-1.28-5.26-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.5 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.7 5.4-5.28 5.69.42.36.79 1.07.79 2.16v3.2c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
          </svg>
          {parts ? `${parts.repo}#${parts.number}` : "issue"}
        </a>
      ) : null}
      {opened ? <span title="Opened on GitHub">· opened {opened}</span> : null}
      {imported ? <span title="Imported into mykan">· imported {imported}</span> : null}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void refresh();
        }}
        disabled={busy}
        title="Re-pull from GitHub — overwrites this item's content"
        className="underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--color-accent)] disabled:opacity-50"
      >
        {busy ? "Refreshing…" : "Refresh"}
      </button>
      {err ? <span className="text-[var(--color-bug)]">{err}</span> : null}
    </span>
  );
}
