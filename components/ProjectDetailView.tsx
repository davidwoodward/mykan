"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { ItemList } from "@/components/ItemList";
import { Board } from "@/components/Board";
import { ItemDetailModal } from "@/components/ItemDetailModal";
import { ProjectKeyProvider } from "@/components/RefBadge";
import { AssigneeProvider } from "@/components/AssigneePicker";
import { Tag } from "@/components/Tag";
import { TagEditor, type TagEditorHandle } from "@/components/TagEditor";
import { uploadAttachment } from "@/lib/client-attachments";
import { localPart } from "@/lib/format";
import {
  ITEM_STATUSES,
  ITEM_TYPES,
  STATUS_LABEL,
  TYPE_LABEL,
  type Category,
  type Item,
  type ItemStatus,
  type ItemType,
  type RichDoc,
} from "@/lib/types";
import {
  CategoryProvider,
  DraftCategory,
  buildPathOf,
  subtreeIdSet,
} from "@/components/CategoryPicker";
import { CategoryManager } from "@/components/CategoryManager";

type View = "list" | "board";

export function ProjectDetailView({
  projectId,
  projectKey,
  members,
  isPrivate,
}: {
  projectId: string;
  projectKey: string | null;
  members: string[];
  isPrivate: boolean;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [creatorFilter, setCreatorFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<ItemType>("feature");
  const [newTags, setNewTags] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const addFileRef = useRef<HTMLInputElement>(null);
  const tagEditorRef = useRef<TagEditorHandle>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [newCategoryId, setNewCategoryId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [areaFilter, setAreaFilter] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"status" | "area" | "flat">("status");
  const [statusFilter, setStatusFilter] = useState<ItemStatus[]>([]);
  const [showCategoryManager, setShowCategoryManager] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/items`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Item[]) => !cancelled && setItems(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    fetch(`/api/projects/${projectId}/categories`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Category[]) => !cancelled && setCategories(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Pull the latest items on demand (the Refresh button) so the board reflects
  // edits made elsewhere — e.g. by the other whitelisted user or the MCP server
  // — without a full browser reload and renavigation.
  const refetch = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/items`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setItems((await r.json()) as Item[]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }, [projectId]);

  const createItem = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    // Pull in a tag the user typed but never confirmed with Enter.
    const tags = tagEditorRef.current?.flush() ?? newTags;
    try {
      const res = await fetch(`/api/projects/${projectId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed, type, tags, category_id: newCategoryId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = (await res.json()) as Item;
      const final = newFiles.length
        ? ((await uploadFilesTo(created.id, newFiles)) ?? created)
        : created;
      setItems((prev) => (prev ? [...prev, final] : [final]));
      setName("");
      setNewTags([]);
      setNewFiles([]);
      setNewCategoryId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  }, [name, type, newTags, newFiles, newCategoryId, busy, projectId]);

  const patchItem = useCallback(
    async (
      id: string,
      patch: Partial<Pick<Item, "name" | "type" | "status" | "position" | "body">>,
    ) => {
      const before = items;
      setItems((prev) =>
        prev ? prev.map((it) => (it.id === id ? { ...it, ...patch } : it)) : prev,
      );
      try {
        const res = await fetch(`/api/items/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const updated = (await res.json()) as Item;
        setItems((prev) =>
          prev ? prev.map((it) => (it.id === id ? updated : it)) : prev,
        );
      } catch (e) {
        setItems(before ?? null);
        setError(e instanceof Error ? e.message : "Failed to update");
      }
    },
    [items],
  );

  // Rich-text body saves go through the same optimistic PATCH path. Re-thrown so
  // the modal can show a save-failed state.
  const saveBody = useCallback(
    async (id: string, body: RichDoc) => {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = (await res.json()) as Item;
      setItems((prev) =>
        prev ? prev.map((it) => (it.id === id ? updated : it)) : prev,
      );
    },
    [],
  );

  const saveTags = useCallback(async (id: string, tags: string[]) => {
    setItems((prev) =>
      prev ? prev.map((it) => (it.id === id ? { ...it, tags } : it)) : prev,
    );
    const res = await fetch(`/api/items/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tags }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const updated = (await res.json()) as Item;
    setItems((prev) =>
      prev ? prev.map((it) => (it.id === id ? updated : it)) : prev,
    );
  }, []);

  const replaceItem = useCallback((updated: Item) => {
    setItems((prev) =>
      prev ? prev.map((it) => (it.id === updated.id ? updated : it)) : prev,
    );
  }, []);

  // Fire-and-forget inline assignee edits from rows/cards (optimistic).
  const changeItemAssignees = useCallback((id: string, assignees: string[]) => {
    setItems((prev) =>
      prev ? prev.map((it) => (it.id === id ? { ...it, assignees } : it)) : prev,
    );
    void (async () => {
      try {
        const res = await fetch(`/api/items/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assignees }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const updated = (await res.json()) as Item;
        setItems((prev) =>
          prev ? prev.map((it) => (it.id === id ? updated : it)) : prev,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to update assignees");
      }
    })();
  }, []);

  // Assign (or clear with null) an item's category. Optimistic + PATCH.
  const changeItemCategory = useCallback(
    (id: string, categoryId: string | null) => {
      setItems((prev) =>
        prev
          ? prev.map((it) =>
              it.id === id ? { ...it, category_id: categoryId } : it,
            )
          : prev,
      );
      void (async () => {
        try {
          const res = await fetch(`/api/items/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ category_id: categoryId }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const updated = (await res.json()) as Item;
          setItems((prev) =>
            prev ? prev.map((it) => (it.id === id ? updated : it)) : prev,
          );
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to set area");
        }
      })();
    },
    [],
  );

  // Find-or-create the node at a "/"-path, adding any new nodes to local state.
  // Calls are SERIALISED (chained) so rattling off siblings fast can't race —
  // each create waits for the previous to commit, so a shared parent is reused
  // (not duplicated) the moment the next path is submitted.
  const ensureChain = useRef<Promise<unknown>>(Promise.resolve());
  const ensureCategory = useCallback(
    (path: string): Promise<Category | null> => {
      const run = ensureChain.current.then(async (): Promise<Category | null> => {
        try {
          const res = await fetch(`/api/projects/${projectId}/categories`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ path }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const leaf = (await res.json()) as Category;
          // The POST may have created ancestors too — re-pull to stay exact.
          const list = await fetch(`/api/projects/${projectId}/categories`).then(
            (r) => (r.ok ? (r.json() as Promise<Category[]>) : []),
          );
          setCategories(list);
          return leaf;
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to create area");
          return null;
        }
      });
      // Keep the chain alive even if a link rejects.
      ensureChain.current = run.catch(() => {});
      return run;
    },
    [projectId],
  );

  const renameCategory = useCallback((id: string, name: string) => {
    setCategories((prev) =>
      prev.map((c) => (c.id === id ? { ...c, name } : c)),
    );
    void fetch(`/api/categories/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch((e) =>
      setError(e instanceof Error ? e.message : "Failed to rename area"),
    );
  }, []);

  const removeCategory = useCallback(
    (id: string) => {
      // Optimistic: reparent children up, un-file items, drop the node.
      setCategories((prev) => {
        const node = prev.find((c) => c.id === id);
        const parentId = node?.parent_id ?? null;
        return prev
          .filter((c) => c.id !== id)
          .map((c) => (c.parent_id === id ? { ...c, parent_id: parentId } : c));
      });
      setItems((prev) =>
        prev
          ? prev.map((it) =>
              it.category_id === id ? { ...it, category_id: null } : it,
            )
          : prev,
      );
      if (areaFilter === id) setAreaFilter(null);
      void fetch(`/api/categories/${id}`, { method: "DELETE" }).catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to delete area"),
      );
    },
    [areaFilter],
  );

  const toggleTag = useCallback((tag: string) => {
    setTagFilter((cur) =>
      cur.includes(tag) ? cur.filter((t) => t !== tag) : [...cur, tag],
    );
  }, []);

  // Fire-and-forget inline tag edits from rows/cards (saveTags is optimistic).
  const changeItemTags = useCallback(
    (id: string, tags: string[]) => {
      void saveTags(id, tags).catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to update tags"),
      );
    },
    [saveTags],
  );

  const deleteItem = useCallback(
    async (id: string) => {
      const before = items;
      setItems((prev) => prev?.filter((it) => it.id !== id) ?? prev);
      try {
        const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        setItems(before ?? null);
        setError(e instanceof Error ? e.message : "Failed to delete");
      }
    },
    [items],
  );

  // Soft delete / restore. Optimistically flips archived_at so the item moves
  // between the active and archived views immediately.
  const setArchived = useCallback(
    async (id: string, archived: boolean) => {
      const before = items;
      const stamp = archived ? new Date().toISOString() : null;
      setItems((prev) =>
        prev ? prev.map((it) => (it.id === id ? { ...it, archived_at: stamp } : it)) : prev,
      );
      try {
        const res = await fetch(`/api/items/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ archived }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const updated = (await res.json()) as Item;
        setItems((prev) =>
          prev ? prev.map((it) => (it.id === id ? updated : it)) : prev,
        );
      } catch (e) {
        setItems(before ?? null);
        setError(e instanceof Error ? e.message : "Failed to update");
      }
    },
    [items],
  );
  const archiveItem = useCallback((id: string) => void setArchived(id, true), [setArchived]);
  const restoreItem = useCallback((id: string) => void setArchived(id, false), [setArchived]);

  function onNameKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void createItem();
    }
  }

  // Pasting a screenshot into the add field: create the item, keep any text the
  // user already typed as the first line, append the image(s) below it, then
  // open the editor so they land right where their screenshot is.
  const createItemWithImages = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || busy) return;
      setBusy(true);
      setError(null);
      try {
        const itemText = name.trim();
        const createRes = await fetch(`/api/projects/${projectId}/items`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: itemText, type, tags: newTags }),
        });
        if (!createRes.ok) throw new Error(`HTTP ${createRes.status}`);
        const created = (await createRes.json()) as Item;

        const urls: string[] = [];
        for (const file of files) {
          const up = await fetch(`/api/items/${created.id}/images`, {
            method: "POST",
            headers: { "content-type": file.type },
            body: file,
          });
          if (!up.ok) {
            const msg = await up
              .json()
              .then((d: { error?: string }) => d.error)
              .catch(() => null);
            throw new Error(msg ?? `Upload failed (${up.status})`);
          }
          urls.push(((await up.json()) as { url: string }).url);
        }

        const content: unknown[] = [];
        if (itemText) {
          content.push({
            type: "paragraph",
            content: [{ type: "text", text: itemText }],
          });
        }
        for (const src of urls) content.push({ type: "image", attrs: { src } });
        const body: RichDoc = { type: "doc", content };

        const patchRes = await fetch(`/api/items/${created.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body }),
        });
        const withBody = patchRes.ok
          ? ((await patchRes.json()) as Item)
          : { ...created, body };
        const final = newFiles.length
          ? ((await uploadFilesTo(created.id, newFiles)) ?? withBody)
          : withBody;

        setItems((prev) => (prev ? [...prev, final] : [final]));
        setName("");
        setNewTags([]);
        setNewFiles([]);
        setOpenItemId(final.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to add image");
      } finally {
        setBusy(false);
      }
    },
    [name, type, newTags, newFiles, busy, projectId],
  );

  function onNamePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length === 0) return; // plain text paste — leave it alone
    e.preventDefault();
    void createItemWithImages(files);
  }

  const toggleCreatorFilter = useCallback((email: string) => {
    setCreatorFilter((cur) => (cur === email ? null : email));
  }, []);

  const archivedCount = useMemo(
    () => (items ?? []).filter((it) => it.archived_at).length,
    [items],
  );

  // The pool for the current view: archived items when the archived view is on,
  // active items otherwise. All filters/derivations work off this pool.
  const pool = useMemo(
    () => (items ?? []).filter((it) => (showArchived ? it.archived_at : !it.archived_at)),
    [items, showArchived],
  );

  const creators = useMemo(() => {
    const set = new Set<string>();
    for (const it of pool) if (it.created_by) set.add(it.created_by);
    return Array.from(set).sort();
  }, [pool]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const it of pool) for (const t of it.tags ?? []) set.add(t);
    return Array.from(set).sort();
  }, [pool]);

  const pathOf = useMemo(() => buildPathOf(categories), [categories]);

  // All nodes as full-path strings, for the typeahead.
  const categoryPaths = useMemo(
    () =>
      categories
        .map((c) => ({ id: c.id, path: pathOf(c.id) }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    [categories, pathOf],
  );

  const categoryCtx = useMemo(
    () => ({
      categories,
      pathOf,
      paths: categoryPaths,
      assign: changeItemCategory,
      ensure: ensureCategory,
      rename: renameCategory,
      remove: removeCategory,
    }),
    [
      categories,
      pathOf,
      categoryPaths,
      changeItemCategory,
      ensureCategory,
      renameCategory,
      removeCategory,
    ],
  );

  const visibleItems = useMemo(() => {
    let list = pool;
    if (creatorFilter) list = list.filter((it) => it.created_by === creatorFilter);
    // AND semantics: an item must carry every selected tag.
    if (tagFilter.length) {
      list = list.filter((it) => tagFilter.every((t) => it.tags?.includes(t)));
    }
    // Area filter: the selected node and its whole subtree.
    if (areaFilter) {
      const ids = subtreeIdSet(categories, areaFilter);
      list = list.filter((it) => it.category_id && ids.has(it.category_id));
    }
    // Status filter (multi-select): empty = all.
    if (statusFilter.length) {
      list = list.filter((it) => statusFilter.includes(it.status));
    }
    return list;
  }, [pool, creatorFilter, tagFilter, areaFilter, statusFilter, categories]);

  const grouped = useMemo(() => groupByStatus(visibleItems), [visibleItems]);

  // The flat, draggable list: every visible item by global position.
  const flatItems = useMemo(
    () => [...visibleItems].sort((a, b) => a.position - b.position),
    [visibleItems],
  );

  // Items grouped by Area path (with an "Uncategorized" bucket), for the
  // group-by-area list view. Sorted so parent paths read before their children.
  const groupedByArea = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const it of visibleItems) {
      const key = it.category_id ? pathOf(it.category_id) : "";
      const list = map.get(key) ?? [];
      list.push(it);
      map.set(key, list);
    }
    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === "") return 1;
      if (b === "") return -1;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({
      key: k || "Uncategorized",
      items: (map.get(k) ?? []).sort((a, b) => a.position - b.position),
    }));
  }, [visibleItems, pathOf]);

  const openItem = useMemo(
    () => (openItemId ? (items?.find((it) => it.id === openItemId) ?? null) : null),
    [openItemId, items],
  );

  return (
    <ProjectKeyProvider value={projectKey}>
      <AssigneeProvider
        value={{ members, enabled: !isPrivate, onChange: changeItemAssignees }}
      >
      <CategoryProvider value={categoryCtx}>
      {!showArchived ? (
      <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2">
        <AutoGrowTextarea
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onNameKeyDown}
          onPaste={onNamePaste}
          placeholder="Add an item…  (or paste a screenshot)"
          className="text-base placeholder:text-[var(--color-faint)]"
          aria-label="Item name"
        />
        <div className="mt-2">
          <TagEditor ref={tagEditorRef} value={newTags} suggestions={allTags} onChange={setNewTags} />
        </div>

        {newFiles.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {newFiles.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--color-line)] bg-[var(--color-canvas)] px-2 py-0.5 text-xs text-[var(--color-muted)]"
              >
                <span className="max-w-40 truncate">{f.name}</span>
                <button
                  type="button"
                  onClick={() => setNewFiles((prev) => prev.filter((_, j) => j !== i))}
                  aria-label={`Remove ${f.name}`}
                  className="opacity-60 transition-opacity hover:opacity-100"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <TypeSegmented value={type} onChange={setType} />
            <DraftCategory categoryId={newCategoryId} onChange={setNewCategoryId} />
            <button
              type="button"
              onClick={() => addFileRef.current?.click()}
              aria-label="Attach files"
              className="inline-flex items-center justify-center rounded-md border border-[var(--color-line)] p-1.5 text-[var(--color-muted)] transition-colors hover:border-[var(--color-line-strong)] hover:text-[var(--color-accent)]"
            >
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                <path
                  d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <input
              ref={addFileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                // Materialise the File list NOW: resetting input.value below
                // empties the live FileList, and the setState updater runs
                // afterwards — reading Array.from(picked) there yields nothing.
                const files = e.target.files ? Array.from(e.target.files) : [];
                e.target.value = "";
                if (files.length) setNewFiles((prev) => [...prev, ...files]);
              }}
            />
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-[var(--color-faint)] sm:inline">
              Enter for newline · ⌘/Ctrl+Enter to add
            </span>
            <button
              type="button"
              onClick={createItem}
              disabled={!name.trim() || busy}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      </section>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-[var(--color-bug)]">{error}</p>
      ) : null}

      <div className="mt-4 mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* LEFT — how you look at items: view, then filters. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* View cluster */}
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5 text-sm">
              <ViewTab active={view === "list"} onClick={() => setView("list")}>
                List
              </ViewTab>
              <ViewTab active={view === "board"} onClick={() => setView("board")}>
                Board
              </ViewTab>
            </div>
            {!showArchived && view === "list" ? (
              <div className="inline-flex items-center gap-1.5 text-xs text-[var(--color-faint)]">
                <span>Group</span>
                <div className="inline-flex rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5">
                  <ViewTab
                    active={groupBy === "status"}
                    onClick={() => setGroupBy("status")}
                  >
                    Status
                  </ViewTab>
                  <ViewTab
                    active={groupBy === "area"}
                    onClick={() => setGroupBy("area")}
                  >
                    Area
                  </ViewTab>
                  <ViewTab
                    active={groupBy === "flat"}
                    onClick={() => setGroupBy("flat")}
                  >
                    Flat
                  </ViewTab>
                </div>
              </div>
            ) : null}
          </div>

          {/* Filter cluster — status filter is always available. */}
          <>
            <span
              className="hidden h-5 w-px self-center bg-[var(--color-line)] sm:block"
              aria-hidden="true"
            />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-[var(--color-faint)]">Filter</span>
                <div className="inline-flex items-center gap-1">
                  {ITEM_STATUSES.map((s) => {
                    const on = statusFilter.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() =>
                          setStatusFilter((cur) =>
                            on ? cur.filter((x) => x !== s) : [...cur, s],
                          )
                        }
                        aria-pressed={on}
                        title={`Filter: ${STATUS_LABEL[s]}`}
                        className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                          on
                            ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                            : "border-[var(--color-line)] text-[var(--color-faint)] hover:text-[var(--color-muted)]"
                        }`}
                      >
                        {STATUS_LABEL[s]}
                      </button>
                    );
                  })}
                </div>
                {!showArchived && categoryPaths.length > 0 ? (
                  <select
                    value={areaFilter ?? ""}
                    onChange={(e) => setAreaFilter(e.target.value || null)}
                    aria-label="Filter by area"
                    title="Filter by area (includes sub-areas)"
                    className="max-w-[12rem] rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1 text-sm text-[var(--color-muted)] outline-none focus:border-[var(--color-accent)]"
                  >
                    <option value="">All areas</option>
                    {categoryPaths.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.path}
                      </option>
                    ))}
                  </select>
                ) : null}
                {allTags.length > 0 ? (
                  <TagFilterBar
                    tags={allTags}
                    active={tagFilter}
                    onToggle={toggleTag}
                    onClear={() => setTagFilter([])}
                  />
                ) : null}
                {creators.length > 0 ? (
                  <CreatorFilter
                    creators={creators}
                    value={creatorFilter}
                    onChange={setCreatorFilter}
                  />
                ) : null}
              </div>
          </>
        </div>

        {/* RIGHT — actions you take: refresh, manage areas, archived. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={refreshing}
            aria-label="Refresh"
            title="Refresh"
            className="grid h-8 w-8 place-items-center rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-60"
          >
            <svg
              className={`h-[15px] w-[15px] ${refreshing ? "animate-spin" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </button>
          {!showArchived ? (
            <button
              type="button"
              onClick={() => setShowCategoryManager(true)}
              title="Manage areas"
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm transition-colors ${
                showCategoryManager
                  ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                  : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent-ink)]"
              }`}
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              </svg>
              Areas
            </button>
          ) : null}
          {showArchived || archivedCount > 0 ? (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className={`rounded-md border px-3 py-1 text-sm transition-colors ${
                showArchived
                  ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-canvas)]"
                  : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
              }`}
              title="Show archived items"
            >
              {showArchived ? "← Active" : `Archived${archivedCount ? ` (${archivedCount})` : ""}`}
            </button>
          ) : null}
        </div>
      </div>

      {/* The board/list gets its own scroll region (capped to the viewport) so
          its contents scroll under a static toolbar, while the page itself
          still scrolls normally for everything above (e.g. a tall add form).
          Mobile keeps plain full-page scroll. */}
      <div className="sm:max-h-[calc(100svh-13rem)] sm:overflow-y-auto sm:overscroll-contain">
      {items === null ? (
        <p className="text-sm text-[var(--color-faint)]">Loading…</p>
      ) : view === "list" ? (
        <ItemList
          grouped={grouped}
          onPatch={patchItem}
          archivedView={showArchived}
          onArchive={archiveItem}
          onRestore={restoreItem}
          onPurge={deleteItem}
          onOpen={(it) => setOpenItemId(it.id)}
          onCreatorClick={toggleCreatorFilter}
          activeCreator={creatorFilter}
          onTagClick={toggleTag}
          activeTags={tagFilter}
          tagSuggestions={allTags}
          onTagsChange={changeItemTags}
          onItemChange={replaceItem}
          areaGroups={
            groupBy === "area" && !showArchived ? groupedByArea : undefined
          }
          flatItems={groupBy === "flat" && !showArchived ? flatItems : undefined}
        />
      ) : (
        <Board
          grouped={grouped}
          onPatch={patchItem}
          archivedView={showArchived}
          onArchive={archiveItem}
          onRestore={restoreItem}
          onPurge={deleteItem}
          onOpen={(it) => setOpenItemId(it.id)}
          onCreatorClick={toggleCreatorFilter}
          activeCreator={creatorFilter}
          onTagClick={toggleTag}
          activeTags={tagFilter}
          tagSuggestions={allTags}
          onTagsChange={changeItemTags}
          onItemChange={replaceItem}
        />
      )}
      </div>

      {openItem ? (
        <ItemDetailModal
          item={openItem}
          allTags={allTags}
          onClose={() => setOpenItemId(null)}
          onSaveBody={saveBody}
          onSaveTags={saveTags}
          onItemChange={replaceItem}
        />
      ) : null}
      {showCategoryManager ? (
        <CategoryManager onClose={() => setShowCategoryManager(false)} />
      ) : null}
      </CategoryProvider>
      </AssigneeProvider>
    </ProjectKeyProvider>
  );
}

function TagFilterBar({
  tags,
  active,
  onToggle,
  onClear,
}: {
  tags: string[];
  active: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(false);
  const [hi, setHi] = useState(0);

  const query = q.trim().toLowerCase();
  // Drop down on focus: with no query, show every not-yet-active tag; typing
  // narrows by substring.
  const matches = tags.filter((t) => !active.includes(t) && t.includes(query));
  const shown = matches.slice(0, 10);
  const more = matches.length - shown.length;

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((h) => Math.min(shown.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = shown[hi];
      if (pick) {
        onToggle(pick);
        setQ("");
        setHi(0);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setFocused(false);
      (e.target as HTMLInputElement).blur();
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-[var(--color-faint)]">filter</span>

      {active.map((t) => (
        <Tag key={t} label={t} active onClick={() => onToggle(t)} />
      ))}

      <div className="relative">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setHi(0);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={active.length ? "+ tag" : "filter by tag…"}
          aria-label="Filter by tag"
          className="h-6 w-28 rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-xs outline-none focus:border-[var(--color-accent)]"
        />
        {focused && shown.length > 0 ? (
          <div className="absolute left-0 top-7 z-20 flex max-h-56 w-48 flex-col gap-1 overflow-y-auto rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-md">
            {shown.map((t, i) => (
              <button
                key={t}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onToggle(t);
                  setQ("");
                  setHi(0);
                }}
                onMouseEnter={() => setHi(i)}
                className={`flex rounded text-left ${
                  i === hi ? "bg-[var(--color-accent-soft)]" : ""
                }`}
              >
                <Tag label={t} />
              </button>
            ))}
            {more > 0 ? (
              <span className="px-1 py-0.5 text-[10px] text-[var(--color-faint)]">
                +{more} more — keep typing
              </span>
            ) : null}
          </div>
        ) : focused && query && shown.length === 0 ? (
          <div className="absolute left-0 top-7 z-20 w-48 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-2 py-1.5 text-xs text-[var(--color-faint)] shadow-md">
            No matching tags
          </div>
        ) : null}
      </div>

      {active.length > 0 ? (
        <button
          type="button"
          onClick={onClear}
          className="ml-1 text-xs text-[var(--color-faint)] underline-offset-2 transition-colors hover:text-[var(--color-ink)] hover:underline"
        >
          clear
        </button>
      ) : null}
    </div>
  );
}

/** Uploads staged files to a freshly-created item; returns the latest item. */
async function uploadFilesTo(itemId: string, files: File[]): Promise<Item | null> {
  let latest: Item | null = null;
  for (const file of files) {
    latest = await uploadAttachment(itemId, file);
  }
  return latest;
}

function groupByStatus(items: Item[]): Record<ItemStatus, Item[]> {
  const result = Object.fromEntries(
    ITEM_STATUSES.map((s) => [s, [] as Item[]]),
  ) as Record<ItemStatus, Item[]>;
  for (const it of items) result[it.status].push(it);
  for (const k of Object.keys(result) as ItemStatus[]) {
    result[k].sort((a, b) => a.position - b.position);
  }
  return result;
}

function TypeSegmented({
  value,
  onChange,
}: {
  value: ItemType;
  onChange: (v: ItemType) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Item type"
      className="inline-flex rounded-md border border-[var(--color-line)] p-0.5 text-xs"
    >
      {ITEM_TYPES.map((t) => {
        const active = t === value;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(t)}
            className={`rounded px-2 py-1 transition-colors ${
              active
                ? "bg-[var(--color-ink)] text-[var(--color-canvas)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            {TYPE_LABEL[t]}
          </button>
        );
      })}
    </div>
  );
}

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1 transition-colors ${
        active
          ? "bg-[var(--color-ink)] text-[var(--color-canvas)]"
          : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      }`}
    >
      {children}
    </button>
  );
}

function CreatorFilter({
  creators,
  value,
  onChange,
}: {
  creators: string[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5 text-xs">
      <span className="px-1.5 text-[var(--color-faint)]">by</span>
      <FilterPill active={value === null} onClick={() => onChange(null)}>
        all
      </FilterPill>
      {creators.map((c) => (
        <FilterPill key={c} active={value === c} onClick={() => onChange(c)}>
          {localPart(c)}
        </FilterPill>
      ))}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2 py-1 transition-colors ${
        active
          ? "bg-[var(--color-ink)] text-[var(--color-canvas)]"
          : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      }`}
    >
      {children}
    </button>
  );
}
