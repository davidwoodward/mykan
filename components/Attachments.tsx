"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { formatBytes, isViewable, type Attachment, type Item } from "@/lib/types";

export function Attachments({
  item,
  onItemChange,
}: {
  item: Item;
  onItemChange: (item: Item) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const list = item.attachments;
  const base = `/api/items/${item.id}/attachments`;

  async function upload(files: FileList) {
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const res = await fetch(base, {
          method: "POST",
          headers: {
            "content-type": file.type || "application/octet-stream",
            "x-file-name": encodeURIComponent(file.name),
          },
          body: file,
        });
        if (!res.ok) {
          const msg = await res
            .json()
            .then((d: { error?: string }) => d.error)
            .catch(() => null);
          throw new Error(msg ?? `Upload failed (${res.status})`);
        }
        onItemChange((await res.json()) as Item);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(att: Attachment) {
    setError(null);
    try {
      const res = await fetch(`${base}/${att.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onItemChange((await res.json()) as Item);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove");
    }
  }

  async function commitRename(att: Attachment) {
    const name = draft.trim();
    setRenamingId(null);
    if (!name || name === att.name) return;
    setError(null);
    try {
      const res = await fetch(`${base}/${att.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onItemChange((await res.json()) as Item);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to rename");
    }
  }

  function onRenameKey(e: KeyboardEvent<HTMLInputElement>, att: Attachment) {
    if (e.key === "Enter") {
      e.preventDefault();
      void commitRename(att);
    } else if (e.key === "Escape") {
      setRenamingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
          Attachments{list.length ? ` (${list.length})` : ""}
        </span>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1 text-xs text-[var(--color-muted)] transition-colors hover:text-[var(--color-accent)] disabled:opacity-50"
        >
          <Clip className="h-3.5 w-3.5" />
          {busy ? "Uploading…" : "Attach"}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => e.target.files && upload(e.target.files)}
        />
      </div>

      {list.length > 0 ? (
        <ul className="mt-2 divide-y divide-[var(--color-line)] rounded-md border border-[var(--color-line)]">
          {list.map((att) => {
            const viewable = isViewable(att.content_type);
            return (
              <li key={att.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
                {renamingId === att.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => void commitRename(att)}
                    onKeyDown={(e) => onRenameKey(e, att)}
                    className="min-w-0 flex-1 rounded border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-1.5 py-0.5 text-sm outline-none focus:border-[var(--color-accent)]"
                  />
                ) : viewable ? (
                  <a
                    href={`${base}/${att.id}/raw`}
                    target="_blank"
                    rel="noreferrer"
                    title="View"
                    className="min-w-0 flex-1 truncate text-[var(--color-accent)] hover:underline"
                  >
                    {att.name}
                  </a>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      setNotice(
                        `No viewer for "${att.name}" (${att.content_type}). Use Download.`,
                      )
                    }
                    title="No inline viewer for this type"
                    className="min-w-0 flex-1 truncate text-left hover:underline"
                  >
                    {att.name}
                  </button>
                )}

                <span className="shrink-0 text-xs text-[var(--color-faint)]">
                  {formatBytes(att.size)}
                </span>

                <div className="flex shrink-0 items-center gap-2 text-xs text-[var(--color-muted)]">
                  <a
                    href={`${base}/${att.id}/raw?download=1`}
                    className="transition-colors hover:text-[var(--color-ink)]"
                  >
                    Download
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingId(att.id);
                      setDraft(att.name);
                    }}
                    className="transition-colors hover:text-[var(--color-ink)]"
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(att)}
                    className="transition-colors hover:text-[var(--color-bug)]"
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {notice ? (
        <p className="mt-1.5 text-xs text-[var(--color-muted)]">{notice}</p>
      ) : null}
      {error ? (
        <p className="mt-1.5 text-xs text-[var(--color-bug)]">{error}</p>
      ) : null}
    </div>
  );
}

function Clip({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
