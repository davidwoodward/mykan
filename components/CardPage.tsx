"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RichTextEditor, type EditorRead } from "@/components/RichTextEditor";
import { AbandonButton } from "@/components/AbandonButton";
import { useAbandonable, type PendingRestore } from "@/components/useAbandonable";
import { TagEditor, type TagEditorHandle } from "@/components/TagEditor";
import { Attachments } from "@/components/Attachments";
import { TypeBadge } from "@/components/TypeBadge";
import { GithubItemMeta } from "@/components/GithubItemMeta";
import { GithubSyncBadge } from "@/components/GithubSyncBadge";
import { HistoryList } from "@/components/ItemHistory";
import { ProjectKeyProvider } from "@/components/RefBadge";
import {
  EpicChildren,
  EpicProgress,
  EpicProvider,
  ParentRow,
  useEpicValue,
} from "@/components/EpicLinks";
import {
  markCardFromBoard,
  takeCardFromBoard,
  trackPendingSave,
} from "@/components/boardReturn";
import { fieldEqual, type TrackedField } from "@/lib/item-snapshot";
import { cardEscAction, cardPath, projectPath } from "@/lib/card-url";
import { STATUS_LABEL, type Item, type RichDoc } from "@/lib/types";

/** The fields the card page drafts and saves when editing finishes. */
type Fields = { body: RichDoc | null; tags: string[] };

/** The API's `{ error }` message for a failed response, else "HTTP <status>". */
async function responseError(res: Response): Promise<string> {
  const msg = await res
    .json()
    .then((d: { error?: unknown }) => (typeof d.error === "string" ? d.error : null))
    .catch(() => null);
  return msg ?? `HTTP ${res.status}`;
}

/**
 * The sections beside the description, in tab order. One definition, so the
 * page's layout has one obvious place to grow.
 *
 * KANBAN-38 adds its two panels HERE, e.g.
 *   { id: "progress", label: "Progress" },
 *   { id: "decisions", label: "Decisions & Questions" },
 * and renders them in `PanelBody` below. Nothing else about the layout changes.
 */
type PanelId = "children" | "attachments" | "history";
type PanelDef = { id: PanelId; label: string; show: (item: Item) => boolean };
const PANELS: PanelDef[] = [
  { id: "children", label: "Child items", show: (it) => it.type === "epic" },
  { id: "attachments", label: "Attachments", show: () => true },
  { id: "history", label: "History", show: () => true },
];

/**
 * A card's own page, /KEY-N (KANBAN-44). One layout for every card, replacing
 * the item modal (there is one layout): the description is the main column; child items,
 * attachments and history sit beside it as tabbed sections (stacked below it on
 * a phone). On desktop the page is locked to the viewport and each column
 * scrolls on its own, so a long description never pushes the rest off screen.
 *
 * Loads the project's items (for the epic links and tag suggestions) the same
 * way the board does, through the same API.
 */
export function CardPage({
  projectId,
  projectKey,
  initialItem,
}: {
  projectId: string;
  projectKey: string;
  initialItem: Item;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  // This card, as last written (updated by saves, links, attachments).
  const [own, setOwn] = useState<Item>(initialItem);
  const [error, setError] = useState<string | null>(null);
  // Bumped to remount the editor over new stored values (an abandon, or the
  // card changing under an editor with nothing unsaved: history restore,
  // GitHub refresh).
  const [epoch, setEpoch] = useState(0);
  const [panel, setPanel] = useState<PanelId>(
    initialItem.type === "epic" ? "children" : "attachments",
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/items`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Item[]) => {
        if (cancelled) return;
        setItems(d);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const item = useMemo(
    () => items?.find((it) => it.id === own.id) ?? own,
    [items, own],
  );

  /** Put a written item into local state (this card and the project list). */
  const applyItem = useCallback((updated: Item) => {
    setItems((prev) => (prev ? prev.map((it) => (it.id === updated.id ? updated : it)) : prev));
    setOwn((cur) => (cur.id === updated.id ? updated : cur));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/projects/${projectId}/items`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const list = (await r.json()) as Item[];
      setItems(list);
      const mine = list.find((it) => it.id === own.id);
      if (mine) setOwn(mine);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    }
  }, [projectId, own.id]);

  // Parent/child link writes: the same PATCHes the board uses.
  const setParent = useCallback(
    async (id: string, parentId: string | null): Promise<void> => {
      try {
        const res = await fetch(`/api/items/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parent_id: parentId }),
        });
        if (!res.ok) throw new Error(await responseError(res));
        applyItem((await res.json()) as Item);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to set epic");
      }
    },
    [applyItem],
  );
  const linkParent = useCallback(
    async (id: string, parentId: string | null): Promise<string | null> => {
      try {
        const res = await fetch(`/api/items/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parent_id: parentId }),
        });
        if (!res.ok) return await responseError(res);
        applyItem((await res.json()) as Item);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Failed to set epic";
      }
    },
    [applyItem],
  );

  // Set by the editor while mounted: finish editing (save once if needed).
  const finishRef = useRef<(() => Promise<boolean>) | null>(null);
  // Opened from this project's board in this tab: history Back returns there.
  const fromBoard = useRef(false);
  useEffect(() => {
    // (Only ever set true: React may run this effect twice in development.)
    if (takeCardFromBoard(projectKey)) fromBoard.current = true;
  }, [projectKey]);

  // Following a link to another card: finish this edit first (a failed save
  // stays here), then REPLACE this history entry, so Back and Esc from the
  // next card still go to the board in one step.
  const openCard = useCallback(
    (id: string) => {
      const target = items?.find((it) => it.id === id);
      if (!target) return;
      void (async () => {
        const finish = finishRef.current;
        if (finish && !(await finish())) return;
        if (fromBoard.current) markCardFromBoard(projectKey);
        router.replace(cardPath(projectKey, target.number));
      })();
    },
    [items, projectKey, router],
  );

  // Back to the board: finish (save once if needed; a failure stays), then go
  // Back when the board is directly behind this page, else to the board URL.
  const leave = useCallback(async () => {
    const finish = finishRef.current;
    if (finish && !(await finish())) return;
    if (fromBoard.current && window.history.length > 1) router.back();
    else router.push(projectPath(projectKey));
  }, [projectKey, router]);

  const epicCtx = useEpicValue(items, openCard, setParent, linkParent, refresh);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const it of items ?? []) if (!it.archived_at) for (const t of it.tags ?? []) set.add(t);
    return Array.from(set).sort();
  }, [items]);

  return (
    <ProjectKeyProvider value={projectKey}>
      <EpicProvider value={epicCtx}>
        <CardEditor
          key={`${item.id}:${epoch}`}
          item={item}
          projectKey={projectKey}
          allTags={allTags}
          error={error}
          panel={panel}
          onPanel={setPanel}
          finishRef={finishRef}
          onLeave={() => void leave()}
          onSaved={applyItem}
          onItemChange={applyItem}
          onRemount={() => setEpoch((n) => n + 1)}
        />
      </EpicProvider>
    </ProjectKeyProvider>
  );
}

function isTextField(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName);
}

/**
 * The page itself for one mount of the editor. Editing follows the KANBAN-42
 * model exactly (docs/DESIGN.md "Save on finish"): nothing is written while
 * typing; finishing saves once with only the changed fields; abandon discards
 * with no write; a localStorage draft is offered back with Restore / Discard.
 *
 * On a page, "finishing" is:
 * - Esc in a field (description, tag input): save once if changed, and settle.
 * - A press outside the description and tags while editing them: save once.
 * - Leaving: a second Esc (or Esc with nothing being edited), the back arrow,
 *   following a link to another card (awaited, a failure stays on the page),
 *   browser Back or any client-side navigation (a best-effort save on unmount),
 *   closing the tab or reloading (a keepalive save on pagehide).
 */
function CardEditor({
  item,
  projectKey,
  allTags,
  error,
  panel,
  onPanel,
  finishRef,
  onLeave,
  onSaved,
  onItemChange,
  onRemount,
}: {
  item: Item;
  projectKey: string;
  allTags: string[];
  error: string | null;
  panel: PanelId;
  onPanel: (p: PanelId) => void;
  finishRef: React.MutableRefObject<(() => Promise<boolean>) | null>;
  onLeave: () => void;
  onSaved: (item: Item) => void;
  onItemChange: (item: Item) => void;
  onRemount: () => void;
}) {
  // One edit session per finished edit: each finish is one history entry, and
  // a rare double save of the same edit (a tab-close save that landed, then the
  // page comes back from bfcache and finishes) still coalesces.
  const editSession = useRef<string>("");
  useEffect(() => {
    editSession.current = crypto.randomUUID();
  }, []);

  const draft = useAbandonable<Fields>({
    opened: { body: item.body, tags: item.tags ?? [] },
    scope: "item",
    id: item.id,
    equal: (key, a, b) => fieldEqual(key as TrackedField, a, b),
    baseUpdatedAt: item.updated_at,
  });
  const { session, set, close, abandon, restore, applyRestore, discardRestore } = draft;

  const seededBody = useRef<RichDoc | null>(item.body);
  const readBody = useRef<(() => EditorRead) | null>(null);
  const tagEditor = useRef<TagEditorHandle>(null);
  const editorRegion = useRef<HTMLDivElement>(null);
  // Set when this mount is over (abandoned): late events must not revive the draft.
  const ended = useRef(false);
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
  const syncDraft = useCallback(() => {
    const read = readBody.current?.();
    if (read) takeBody(read);
    if (!restorePending.current) tagEditor.current?.flush();
  }, [takeBody]);

  const save = useCallback(
    async (patch: Partial<Fields>) => {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...patch, edit_session: editSession.current }),
      });
      if (!res.ok) throw new Error(await responseError(res));
      onSaved((await res.json()) as Item);
    },
    [item.id, onSaved],
  );

  // Finish editing: one save if anything changed. Concurrent finishes (Esc,
  // then a click) share the one in flight. Resolves whether it's safe to leave.
  const closing = useRef<Promise<boolean> | null>(null);
  const finish = useCallback((): Promise<boolean> => {
    if (ended.current) return Promise.resolve(true);
    if (closing.current) return closing.current;
    syncDraft();
    const hadChanges = session.patch() !== null;
    const p = close(save).then((ok) => {
      closing.current = null;
      // The next edit is a new history entry.
      if (ok && hadChanges) editSession.current = crypto.randomUUID();
      return ok;
    });
    closing.current = p;
    return p;
  }, [syncDraft, session, close, save]);

  useEffect(() => {
    finishRef.current = finish;
    return () => {
      finishRef.current = null;
    };
  }, [finishRef, finish]);

  // Abandon: drop the unsaved changes (no write) and reload the editor with the
  // stored card. Stays on the page; Esc then goes back to the board.
  const onAbandon = useCallback(() => {
    ended.current = true;
    abandon();
    onRemount();
  }, [abandon, onRemount]);

  const onRestore = useCallback(() => {
    if (restore?.values.body !== undefined) {
      seededBody.current = restore.values.body as RichDoc | null;
    }
    applyRestore();
  }, [restore, applyRestore]);

  // Something else changed this card (history restore, GitHub refresh). With
  // nothing unsaved, reload the editor over the new values; with unsaved
  // changes, keep them (finishing saves them over it: last save wins, as
  // with two tabs).
  const takeItemChange = useCallback(
    (updated: Item) => {
      onItemChange(updated);
      syncDraft();
      const changedUnder =
        !fieldEqual("body", updated.body, session.opened.body) ||
        !fieldEqual("tags", updated.tags ?? [], session.opened.tags);
      if (changedUnder && !session.dirty && !restorePending.current) {
        ended.current = true;
        onRemount();
      }
    },
    [onItemChange, syncDraft, session, onRemount],
  );

  // Esc: see cardEscAction (lib/card-url.ts). The first Esc while editing a
  // field finishes that edit and settles; the next Esc goes back to the board.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (restore && e.key === "Enter" && !e.defaultPrevented) {
        const onPromptButton =
          e.target instanceof HTMLElement && e.target.closest("[data-restore-prompt] button");
        if (!onPromptButton) {
          e.preventDefault();
          onRestore();
        }
        return;
      }
      if (e.key !== "Escape") return;
      const active = document.activeElement;
      const action = cardEscAction({
        handled: e.defaultPrevented,
        saving: closing.current !== null,
        restorePrompt: restore !== null,
        editingField: isTextField(active),
      });
      if (action === "ignore") return;
      e.preventDefault();
      if (action === "discardRestore") {
        discardRestore();
      } else if (action === "finishField") {
        // Blur first (a tag input commits its typed tag on blur), then save.
        if (active instanceof HTMLElement) active.blur();
        void finish();
      } else {
        onLeave();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [restore, onRestore, discardRestore, finish, onLeave]);

  // Click-off: a press outside the description and tags while editing them
  // finishes the edit (one save if changed). Presses on the abandon icon don't.
  useEffect(() => {
    function onDown(e: PointerEvent) {
      const region = editorRegion.current;
      if (!region || !region.contains(document.activeElement)) return;
      const t = e.target as Node | null;
      if (!t || region.contains(t)) return;
      if (t instanceof Element && t.closest("[data-keep-draft]")) return;
      void finish();
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [finish]);

  // Leaving the page: tab closed / reload (pagehide) or unmounted by a
  // client-side navigation (browser Back) with unsaved changes: a best-effort
  // keepalive save. The board waits for it before loading. The localStorage
  // draft covers a save that doesn't land.
  useEffect(() => {
    function beacon() {
      if (ended.current) return;
      syncDraft();
      const patch = session.patch();
      if (!patch) return;
      try {
        const p = fetch(`/api/items/${item.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...patch, edit_session: editSession.current }),
          keepalive: true,
        });
        trackPendingSave(p);
        void p.catch(() => {});
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
      beacon();
    };
  }, [session, syncDraft, item.id]);

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

  const ref = `${projectKey}-${item.number}`;
  const panels = PANELS.filter((p) => p.show(item));
  const activePanel = panels.some((p) => p.id === panel) ? panel : panels[0].id;

  return (
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      {/* Card header: back to the board, the ref with its copy-link action,
          type/status, save state, and the abandon icon. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2 lg:shrink-0">
        <Link
          href={projectPath(projectKey)}
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            onLeave();
          }}
          title="Back to board (Esc)"
          aria-label="Back to board"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)]"
        >
          <svg
            className="h-[18px] w-[18px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
        </Link>
        <span className="inline-flex items-center gap-1">
          <h2 className="font-mono text-sm font-medium tracking-tight text-[var(--color-ink)]">
            {ref}
          </h2>
          <CopyLinkButton path={cardPath(projectKey, item.number)} />
        </span>
        <TypeBadge type={item.type} />
        <EpicProgress item={item} />
        <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-faint)]">
          {STATUS_LABEL[item.status]}
          {item.archived_at ? " · archived" : ""}
        </span>
        <GithubSyncBadge item={item} onItemChange={takeItemChange} />
        <span className="ml-auto flex min-w-0 items-center gap-2 text-xs text-[var(--color-faint)]">
          <DraftIndicator status={draft.status} error={draft.error} dirty={draft.dirty} />
          <span data-keep-draft className="inline-flex">
            <AbandonButton onAbandon={onAbandon} disabled={draft.status === "saving"} />
          </span>
        </span>
      </div>

      {error ? <p className="text-sm text-[var(--color-bug)] lg:shrink-0">{error}</p> : null}

      {restore ? (
        <div className="lg:shrink-0">
          <RestorePrompt restore={restore} onRestore={onRestore} onDiscard={discardRestore} />
        </div>
      ) : null}

      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)]">
        {/* Main column: the description (its own scroll region on desktop),
            then tags, the parent epic, and GitHub provenance. */}
        <section
          aria-label="Description"
          className="flex min-w-0 flex-col rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] lg:min-h-0"
        >
          <div
            ref={editorRegion}
            inert={restore ? true : undefined}
            className={`flex flex-col lg:min-h-0 lg:flex-1 ${restore ? "opacity-60" : ""}`}
          >
            <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
              <RichTextEditor
                key={draft.revision}
                value={draft.revision === 0 ? item.body : draft.values.body}
                onChange={takeBody}
                onUploadImage={uploadImage}
                readRef={readBody}
                contentClassName="prose-mykan min-h-[40vh] px-4 py-3 outline-none lg:min-h-full"
              />
            </div>
            <div className="border-t border-[var(--color-line)] px-4 py-2.5 lg:shrink-0">
              <TagEditor
                ref={tagEditor}
                value={draft.values.tags}
                suggestions={allTags}
                onChange={takeTags}
              />
            </div>
          </div>
          <div inert={restore ? true : undefined} className="lg:shrink-0">
            {item.type !== "epic" ? <ParentRow item={item} /> : null}
            {item.github_issue ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-line)] px-4 py-2.5">
                <GithubItemMeta item={item} onItemChange={takeItemChange} />
              </div>
            ) : null}
            <p className="border-t border-[var(--color-line)] px-4 py-2 text-xs text-[var(--color-faint)]">
              Paste or drop an image to embed it · Esc saves, Esc again returns to the board
            </p>
          </div>
        </section>

        {/* Beside it: one tabbed column of sections, each scrolling on its own.
            KANBAN-38's Progress and Decisions & Questions join PANELS. */}
        <aside
          aria-label="Card sections"
          className="flex min-w-0 flex-col rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] lg:min-h-0"
        >
          <div
            role="tablist"
            aria-label="Card sections"
            className="flex flex-wrap gap-1 border-b border-[var(--color-line)] px-2 pt-2 lg:shrink-0"
          >
            {panels.map((p) => {
              const on = p.id === activePanel;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  id={`card-tab-${p.id}`}
                  aria-selected={on}
                  aria-controls={`card-panel-${p.id}`}
                  onClick={() => onPanel(p.id)}
                  className={`-mb-px rounded-t-md border-b-2 px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    on
                      ? "border-[var(--color-accent)] text-[var(--color-ink)]"
                      : "border-transparent text-[var(--color-faint)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {p.label}
                  {p.id === "attachments" && item.attachments.length > 0 ? (
                    <span className="ml-1 tabular-nums text-[var(--color-faint)]">
                      {item.attachments.length}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div
            role="tabpanel"
            id={`card-panel-${activePanel}`}
            aria-labelledby={`card-tab-${activePanel}`}
            className="px-4 py-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain"
          >
            <PanelBody id={activePanel} item={item} onItemChange={takeItemChange} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function PanelBody({
  id,
  item,
  onItemChange,
}: {
  id: PanelId;
  item: Item;
  onItemChange: (item: Item) => void;
}): ReactNode {
  switch (id) {
    case "children":
      return <EpicChildren item={item} />;
    case "attachments":
      return <Attachments item={item} onItemChange={onItemChange} />;
    case "history":
      return <HistoryList item={item} onItemChange={onItemChange} />;
  }
}

/** Copies the card's full URL (https://…/KEY-N), with a brief "Copied". */
function CopyLinkButton({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    } catch {
      return; // clipboard unavailable: no false "Copied"
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1200);
  }
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => void copy()}
        title="Copy link"
        aria-label="Copy link"
        className={`grid h-7 w-7 place-items-center rounded-md transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)] ${
          copied ? "text-[var(--color-accent)]" : "text-[var(--color-faint)]"
        }`}
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
          <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
        </svg>
      </button>
      {copied ? (
        <span
          role="status"
          className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 -translate-x-1/2 whitespace-nowrap rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 py-1 text-[10px] text-[var(--color-muted)] shadow-sm"
        >
          Link copied
        </span>
      ) : null}
    </span>
  );
}

/** Honest save state: nothing is claimed saved while it isn't. */
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
        Save failed{error ? ` (${error})` : ""}. Nothing lost. Esc to retry.
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

/** Offer back a draft left by an earlier visit that never got saved. */
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
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[var(--color-line)] bg-[var(--color-accent-soft)] px-4 py-2 text-xs text-[var(--color-ink)]"
    >
      <span className="min-w-0 flex-1">
        You have unsaved changes to this card from {formatWhen(restore.startedAt)}.
        {restore.stale ? (
          <strong className="mt-0.5 block font-medium text-[var(--color-bug)]">
            The card&rsquo;s {stale} changed since then. Restoring replaces the newer{" "}
            {stale} when you save.
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
