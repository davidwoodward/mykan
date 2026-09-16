"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { RichTextEditor, type EditorRead } from "@/components/RichTextEditor";
import { AbandonButton } from "@/components/AbandonButton";
import { useAbandonable, type PendingRestore } from "@/components/useAbandonable";
import { fieldEqual, type TrackedField } from "@/lib/item-snapshot";
import { TagEditor, type TagEditorHandle } from "@/components/TagEditor";
import { Attachments } from "@/components/Attachments";
import { TypeBadge } from "@/components/TypeBadge";
import { RefBadge } from "@/components/RefBadge";
import { GithubItemMeta } from "@/components/GithubItemMeta";
import { GithubSyncBadge } from "@/components/GithubSyncBadge";
import { EpicChildren, EpicProgress, ParentRow } from "@/components/EpicLinks";
import { STATUS_LABEL, type Item, type RichDoc } from "@/lib/types";

/** The fields this modal drafts and saves on close. */
export type ItemEditPatch = { body?: RichDoc | null; tags?: string[] };
type Fields = { body: RichDoc | null; tags: string[] };

/**
 * The item detail modal (KANBAN-42 draft model). Editing the body and tags
 * writes nothing: changes live in a local draft (mirrored to localStorage).
 * Esc, a click off the panel, ✕, or following a link to another card saves
 * ONCE with only what changed (nothing changed, no write). A failed save keeps
 * the modal open with the text intact. Abandon drops the draft: no write.
 */
export function ItemDetailModal({
  item,
  allTags,
  onClose,
  onSave,
  onItemChange,
  leaveGuardRef,
}: {
  item: Item;
  allTags: string[];
  onClose: () => void;
  /** The one save on close. Rejects with the server's message on failure. */
  onSave: (id: string, patch: ItemEditPatch, editSession: string) => Promise<void>;
  onItemChange: (item: Item) => void;
  /**
   * Set while mounted to "finish editing": save if needed, resolve whether the
   * modal may be left. The page calls it before swapping to another card.
   */
  leaveGuardRef?: MutableRefObject<(() => Promise<boolean>) | null>;
}) {
  // One id per modal open, sent with every save of this open. Normally there is
  // one save per open; if a best-effort tab-close save lands and the page comes
  // back (bfcache), the later close save coalesces into the same history entry.
  const [editSession] = useState(() => crypto.randomUUID());

  const draft = useAbandonable<Fields>({
    opened: { body: item.body, tags: item.tags ?? [] },
    scope: "item",
    id: item.id,
    equal: (key, a, b) => fieldEqual(key as TrackedField, a, b),
    baseUpdatedAt: item.updated_at,
  });
  const { session, set, close, abandon, restore, applyRestore, discardRestore } = draft;

  // The body the editor was seeded with at this revision (as opened, or a
  // restored draft): "unchanged" from the editor means this value.
  const seededBody = useRef<RichDoc | null>(item.body);
  const readBody = useRef<(() => EditorRead) | null>(null);
  const tagEditor = useRef<TagEditorHandle>(null);
  // Set once this open is over (saved-and-closing, or abandoned): late events
  // (a blur, the editor's last debounce, unmount) must not revive the draft.
  const ended = useRef(false);
  // Mirrors "restore prompt showing": until answered, nothing may touch the
  // stored draft (syncing an unedited body would erase the leftover one).
  const restorePending = useRef(restore !== null);
  useEffect(() => {
    restorePending.current = restore !== null;
  }, [restore]);

  const takeBody = useCallback(
    (read: EditorRead) => {
      if (ended.current || restorePending.current) return;
      set("body", read.changed ? read.doc : seededBody.current);
    },
    [set],
  );
  const takeTags = useCallback(
    (tags: string[]) => {
      if (ended.current || restorePending.current) return;
      set("tags", tags);
    },
    [set],
  );
  // Pull the latest body text and any typed-but-unconfirmed tag into the draft.
  const syncDraft = useCallback(() => {
    const read = readBody.current?.();
    if (read) takeBody(read);
    if (!restorePending.current) tagEditor.current?.flush();
  }, [takeBody]);

  const finish = useCallback(async (): Promise<boolean> => {
    if (ended.current) return true;
    syncDraft();
    const ok = await close((patch) => onSave(item.id, patch, editSession));
    if (ok) ended.current = true;
    return ok;
  }, [syncDraft, close, onSave, item.id, editSession]);

  const requestClose = useCallback(async () => {
    if (await finish()) onClose();
  }, [finish, onClose]);

  const onAbandon = useCallback(() => {
    ended.current = true;
    abandon();
    onClose();
  }, [abandon, onClose]);

  const onRestore = useCallback(() => {
    if (restore?.values.body !== undefined) {
      seededBody.current = restore.values.body as RichDoc | null;
    }
    applyRestore();
  }, [restore, applyRestore]);

  // Let the page finish this edit before it swaps to another card.
  useEffect(() => {
    if (!leaveGuardRef) return;
    leaveGuardRef.current = finish;
    return () => {
      leaveGuardRef.current = null;
    };
  }, [leaveGuardRef, finish]);

  // Keys: while the restore prompt is up, Enter restores and Esc discards;
  // otherwise Esc finishes (saves) and closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (restore) {
        const onPromptButton =
          e.target instanceof HTMLElement && e.target.closest("[data-restore-prompt] button");
        if (e.key === "Enter" && !onPromptButton) {
          e.preventDefault();
          onRestore();
        } else if (e.key === "Escape") {
          e.preventDefault();
          discardRestore();
        }
        return;
      }
      if (e.key === "Escape") void requestClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [restore, onRestore, discardRestore, requestClose]);

  // Leaving the page (tab closed, reload, navigation): best-effort save with a
  // keepalive request, which outlives the page. The localStorage draft covers
  // the case where it doesn't land (keepalive bodies are capped at ~64KB; the
  // body references images by URL, so that's rarely hit). Switching tabs only
  // flushes the draft to storage; it doesn't write the card.
  useEffect(() => {
    function beacon() {
      if (ended.current) return;
      syncDraft();
      const patch = session.patch();
      if (!patch) return;
      try {
        void fetch(`/api/items/${item.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...patch, edit_session: editSession }),
          keepalive: true,
        }).catch(() => {});
      } catch {
        // Too large for keepalive, or the page is already gone: the draft stays.
      }
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") syncDraft();
    }
    window.addEventListener("pagehide", beacon);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", beacon);
      document.removeEventListener("visibilitychange", onVisibility);
      // Unmounted with unsaved changes by something other than a close (e.g.
      // client-side navigation away from the project): same best-effort save.
      beacon();
    };
  }, [session, syncDraft, item.id, editSession]);

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
      onMouseDown={() => void requestClose()}
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-4 border-b border-[var(--color-line)] px-4 py-2.5">
          <div className="flex items-center gap-2">
            <RefBadge number={item.number} />
            <TypeBadge type={item.type} />
            <EpicProgress item={item} />
            <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
              {STATUS_LABEL[item.status]}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <AbandonButton onAbandon={onAbandon} disabled={draft.status === "saving"} />
            <button
              type="button"
              onClick={() => void requestClose()}
              aria-label="Close"
              title="Close (saves changes)"
              className="shrink-0 rounded p-1 text-[var(--color-faint)] transition-colors hover:text-[var(--color-ink)]"
            >
              ✕
            </button>
          </div>
        </header>

        {restore ? (
          <RestorePrompt restore={restore} onRestore={onRestore} onDiscard={discardRestore} />
        ) : null}

        {/* Until the restore prompt is answered the editing area is inert, so
            nothing typed can overwrite the leftover draft. */}
        <div inert={restore ? true : undefined} className={restore ? "opacity-60" : undefined}>
          <RichTextEditor
            key={draft.revision}
            value={draft.revision === 0 ? item.body : draft.values.body}
            onChange={takeBody}
            onUploadImage={uploadImage}
            readRef={readBody}
            autoFocus={!restore}
          />

          {item.type === "epic" ? (
            <div className="border-t border-[var(--color-line)] px-4 py-2.5">
              <EpicChildren item={item} />
            </div>
          ) : (
            <ParentRow item={item} />
          )}

          <div className="border-t border-[var(--color-line)] px-4 py-2.5">
            <TagEditor
              ref={tagEditor}
              value={draft.values.tags}
              suggestions={allTags}
              onChange={takeTags}
            />
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
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[var(--color-line)] px-4 py-2 text-xs text-[var(--color-faint)]">
          <span>Paste or drop an image to embed it</span>
          <DraftIndicator
            status={draft.status}
            error={draft.error}
            dirty={draft.dirty}
          />
        </footer>
      </div>
    </div>
  );
}

/**
 * Honest save state for the draft model: nothing is claimed saved while it
 * isn't. The modal closes on a successful save, so there is no "Saved" here.
 */
function DraftIndicator({
  status,
  error,
  dirty,
}: {
  status: "idle" | "saving" | "failed";
  error: string | null;
  dirty: boolean;
}) {
  if (status === "saving") return <span>Saving…</span>;
  if (status === "failed")
    return (
      <span role="alert" className="text-[var(--color-bug)]">
        Save failed{error ? ` (${error})` : ""}. Still editing, nothing lost. Esc to retry.
      </span>
    );
  if (dirty) return <span>Unsaved changes · Esc or click away to save</span>;
  return null;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "earlier";
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const FIELD_LABEL: Record<string, string> = { body: "description", tags: "tags" };

/** Offer back a draft left by an earlier open that never got saved. */
function RestorePrompt({
  restore,
  onRestore,
  onDiscard,
}: {
  restore: PendingRestore<Fields>;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  const stale = restore.staleFields.map((f) => FIELD_LABEL[f] ?? f).join(" and ");
  return (
    <div
      data-restore-prompt
      role="alertdialog"
      aria-label="Unsaved draft"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--color-line)] bg-[var(--color-accent-soft)] px-4 py-2 text-xs text-[var(--color-ink)]"
    >
      <span className="min-w-0 flex-1">
        You have unsaved changes to this card from {formatWhen(restore.startedAt)}.
        {restore.stale ? (
          <strong className="mt-0.5 block font-medium text-[var(--color-bug)]">
            The card&rsquo;s {stale} changed since then. Restoring replaces the newer{" "}
            {stale} when you close.
          </strong>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onDiscard}
          title="Discard the draft (Esc)"
          className="rounded-md px-2 py-1 text-[var(--color-muted)] ring-1 ring-inset ring-[var(--color-line-strong)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
        >
          Discard
        </button>
        <button
          type="button"
          autoFocus
          onClick={onRestore}
          title="Restore the draft (Enter)"
          className="rounded-md bg-[var(--color-accent)] px-2 py-1 font-medium text-white transition-opacity hover:opacity-90"
        >
          Restore
        </button>
      </span>
    </div>
  );
}
