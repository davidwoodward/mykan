"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RichTextEditor } from "@/components/RichTextEditor";
import { TagEditor } from "@/components/TagEditor";
import { TypeSegmented } from "@/components/TypeSegmented";
import { DraftCategory } from "@/components/CategoryPicker";
import { richDocText, type Item, type ItemType, type RichDoc } from "@/lib/types";

const EMPTY_DOC: RichDoc = { type: "doc", content: [] };

/**
 * Create a new item through the same surface as the edit popup — a rich-text
 * body editor in a modal. Unlike the edit modal there is no row to autosave
 * against yet, so the item is POSTed once on an explicit commit (the Add
 * button or ⌘/Ctrl+Enter); Esc / click-off / ✕ abandon the draft. Inline
 * images need an item id, so they are added after creating (open the item).
 */
export function AddItemModal({
  projectId,
  allTags,
  onClose,
  onCreated,
}: {
  projectId: string;
  allTags: string[];
  onClose: () => void;
  onCreated: (item: Item) => void;
}) {
  const [type, setType] = useState<ItemType>("feature");
  const [tags, setTags] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const bodyRef = useRef<RichDoc>(EMPTY_DOC);
  const [hasContent, setHasContent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onBodyChange = useCallback((doc: RichDoc) => {
    bodyRef.current = doc;
    setHasContent(richDocText(doc).trim().length > 0);
  }, []);

  const submit = useCallback(async () => {
    const body = bodyRef.current;
    if (!richDocText(body).trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, type, tags, category_id: categoryId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = (await res.json()) as Item;
      onCreated(created);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
      setBusy(false);
    }
  }, [projectId, type, tags, categoryId, busy, onCreated, onClose]);

  // Esc abandons the draft; ⌘/Ctrl+Enter commits (Enter alone makes newlines).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void submit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submit]);

  // No item exists yet, so inline image embedding is unavailable here.
  const uploadImage = useCallback(async (): Promise<string> => {
    throw new Error("Add the item first, then open it to embed images");
  }, []);

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
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
              New item
            </span>
            <TypeSegmented value={type} onChange={setType} />
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
          value={null}
          onChange={onBodyChange}
          onUploadImage={uploadImage}
          autoFocus
        />

        <div className="flex items-center gap-2 border-t border-[var(--color-line)] px-4 py-2.5">
          <DraftCategory categoryId={categoryId} onChange={setCategoryId} />
        </div>

        <div className="border-t border-[var(--color-line)] px-4 py-2.5">
          <TagEditor value={tags} suggestions={allTags} onChange={setTags} />
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-[var(--color-line)] px-4 py-2 text-xs text-[var(--color-faint)]">
          {error ? (
            <span className="text-[var(--color-bug)]">{error}</span>
          ) : (
            <span className="hidden sm:inline">⌘/Ctrl+Enter to add · Esc to cancel</span>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!hasContent || busy}
            className="shrink-0 rounded-md bg-[var(--color-accent)] px-3 py-1 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Add item
          </button>
        </footer>
      </div>
    </div>
  );
}
