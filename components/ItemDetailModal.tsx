"use client";

import { useCallback, useEffect, useState } from "react";
import { RichTextEditor } from "@/components/RichTextEditor";
import { TagEditor } from "@/components/TagEditor";
import { Attachments } from "@/components/Attachments";
import { TypeBadge } from "@/components/TypeBadge";
import { RefBadge } from "@/components/RefBadge";
import { GithubItemMeta } from "@/components/GithubItemMeta";
import { GithubSyncBadge } from "@/components/GithubSyncBadge";
import { STATUS_LABEL, type Item, type RichDoc } from "@/lib/types";

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function ItemDetailModal({
  item,
  allTags,
  onClose,
  onSaveBody,
  onSaveTags,
  onItemChange,
}: {
  item: Item;
  allTags: string[];
  onClose: () => void;
  onSaveBody: (id: string, body: RichDoc, editSession?: string) => Promise<void>;
  onSaveTags: (id: string, tags: string[]) => Promise<void>;
  onItemChange: (item: Item) => void;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  // One id per modal open: the autosaves of this editing session coalesce into
  // a single history entry, and closing the modal seals it.
  const [editSession] = useState(() => crypto.randomUUID());

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleChange = useCallback(
    async (body: RichDoc) => {
      setStatus("saving");
      try {
        await onSaveBody(item.id, body, editSession);
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    },
    [item.id, onSaveBody, editSession],
  );

  const handleTags = useCallback(
    async (tags: string[]) => {
      setStatus("saving");
      try {
        await onSaveTags(item.id, tags);
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    },
    [item.id, onSaveTags],
  );

  const uploadImage = useCallback(
    async (file: File): Promise<string> => {
      const res = await fetch(`/api/items/${item.id}/images`, {
        method: "POST",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!res.ok) {
        const msg = await res
          .json()
          .then((d: { error?: string }) => d.error)
          .catch(() => null);
        throw new Error(msg ?? `Upload failed (${res.status})`);
      }
      const { url } = (await res.json()) as { url: string };
      return url;
    },
    [item.id],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[8vh]"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-[var(--color-line)] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <RefBadge number={item.number} />
            <TypeBadge type={item.type} />
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
              {STATUS_LABEL[item.status]}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded p-1 text-[var(--color-faint)] transition-colors hover:text-[var(--color-ink)]"
          >
            ✕
          </button>
        </header>

        <RichTextEditor
          value={item.body}
          onChange={handleChange}
          onUploadImage={uploadImage}
          autoFocus
        />

        <div className="border-t border-[var(--color-line)] px-4 py-2.5">
          <TagEditor value={item.tags} suggestions={allTags} onChange={handleTags} />
        </div>

        <div className="border-t border-[var(--color-line)] px-4 py-2.5">
          <Attachments item={item} onItemChange={onItemChange} />
        </div>

        {item.github_issue ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-line)] px-4 py-2.5">
            <GithubItemMeta item={item} onItemChange={onItemChange} />
            <GithubSyncBadge item={item} onItemChange={onItemChange} />
          </div>
        ) : null}

        <footer className="flex items-center justify-between border-t border-[var(--color-line)] px-4 py-2 text-xs text-[var(--color-faint)]">
          <span>Paste or drop an image to embed it</span>
          <SaveIndicator status={status} />
        </footer>
      </div>
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "saving") return <span>Saving…</span>;
  if (status === "saved") return <span className="text-[var(--color-feature)]">Saved</span>;
  if (status === "error")
    return <span className="text-[var(--color-bug)]">Save failed</span>;
  return null;
}
