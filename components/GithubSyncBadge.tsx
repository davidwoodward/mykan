"use client";

import { useState } from "react";
import type { Item } from "@/lib/types";

/**
 * The write-back "not synced" flag (GH-5): shown only when a GitHub-linked item's
 * last Done→close / un-done→reopen didn't land. Clicking retries the write-back
 * against the item's CURRENT status. `no_pat` (no usable PAT for the account) and
 * `failed` (GitHub rejected/was unreachable) differ only in the tooltip — both are
 * retry-able. Absent (returns null) when the item is in sync.
 */
export function GithubSyncBadge({
  item,
  onItemChange,
}: {
  item: Item;
  onItemChange: (item: Item) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!item.github_sync) return null;

  const label =
    item.github_sync === "no_pat"
      ? "GitHub issue not updated — connect your GitHub account, then retry"
      : "GitHub issue not synced — click to retry";

  async function retry() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/items/${item.id}/github/sync`, { method: "POST" });
      if (res.ok) onItemChange((await res.json()) as Item);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={retry}
      disabled={busy}
      title={label}
      aria-label={label}
      className="inline-flex shrink-0 items-center gap-1 self-center text-[10px] font-medium text-[var(--color-bug)] transition-opacity hover:opacity-80 disabled:opacity-50"
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
        <path
          d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {busy ? "syncing…" : "not synced"}
    </button>
  );
}
