"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ItemList } from "@/components/ItemList";
import { Board } from "@/components/Board";
import { ItemDetailModal } from "@/components/ItemDetailModal";
import { AddItemModal } from "@/components/AddItemModal";
import { ProjectKeyProvider } from "@/components/RefBadge";
import { AssigneeProvider } from "@/components/AssigneePicker";
import { Tag } from "@/components/Tag";
import { localPart } from "@/lib/format";
import {
  ITEM_STATUSES,
  STATUS_LABEL,
  type Category,
  type Item,
  type ItemStatus,
  type RichDoc,
} from "@/lib/types";
import {
  CategoryProvider,
  buildPathOf,
  subtreeIdSet,
} from "@/components/CategoryPicker";
import { CategoryManager } from "@/components/CategoryManager";
import { useColumnCollapse } from "@/components/useColumnCollapse";
import { useKeyboardNav } from "@/components/useKeyboardNav";
import { computePosition } from "@/lib/position";

type View = "list" | "board";

export function ProjectDetailView({
  projectId,
  projectKey,
  members,
  isPrivate,
  keyboardDefault,
}: {
  projectId: string;
  projectKey: string | null;
  members: string[];
  isPrivate: boolean;
  keyboardDefault: boolean;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [creatorFilter, setCreatorFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [areaFilter, setAreaFilter] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"status" | "area" | "flat">("status");
  const [statusFilter, setStatusFilter] = useState<ItemStatus[]>([]);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  // The row "selected" in the status-grouped list — drives the highlight, the
  // j/k/g/G/u/d keyboard model, and where a new item is inserted.
  // Raw last-selected id; the effective `selectedId` is derived below, clamped
  // to the items actually on screen.
  const [rawSelectedId, setSelectedId] = useState<string | null>(null);
  // Per-viewer column collapse (Board + status List share one source of truth,
  // so both views tell the same story). Done ships collapsed.
  const { isCollapsed, toggle: toggleCollapse } = useColumnCollapse(projectId);
  // Per-viewer opt-in for the vim-style board/list navigation (KANBAN-31).
  // Off by default; on for the owner. When off, no selection cursor and no key
  // handlers — the board/list is a plain pointer-first surface.
  const { enabled: keyboardEnabled } = useKeyboardNav(keyboardDefault);

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

  // A new item was created in the AddItemModal — append it to the local list.
  const addCreated = useCallback((created: Item) => {
    setItems((prev) => (prev ? [...prev, created] : [created]));
  }, []);

  const patchItem = useCallback(
    async (
      id: string,
      patch: Partial<Pick<Item, "type" | "status" | "position" | "body">>,
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
  // the modal can show a save-failed state. `editSession` (minted per modal
  // open) makes one editing session read as one history entry.
  const saveBody = useCallback(
    async (id: string, body: RichDoc, editSession?: string) => {
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, edit_session: editSession }),
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

  // Rename an area. Optimistic, but the write is VERIFIED: on any non-ok
  // response the optimistic name is rolled back and the failure surfaced —
  // otherwise a failed save (e.g. a lapsed session) would silently revert only
  // on the next reload, reading as "it didn't save and never told me".
  const renameCategory = useCallback(
    (id: string, name: string) => {
      const before = categories;
      setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, name } : c)));
      void (async () => {
        try {
          const res = await fetch(`/api/categories/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const updated = (await res.json()) as Category;
          setCategories((prev) => prev.map((c) => (c.id === id ? updated : c)));
        } catch (e) {
          setCategories(before);
          setError(e instanceof Error ? e.message : "Failed to rename area");
        }
      })();
    },
    [categories],
  );

  // Bind/unbind an area's GitHub repo — same verified-optimistic pattern.
  const setCategoryRepo = useCallback(
    (id: string, repo: string | null) => {
      const before = categories;
      setCategories((prev) =>
        prev.map((c) => (c.id === id ? { ...c, github_repo: repo } : c)),
      );
      void (async () => {
        try {
          const res = await fetch(`/api/categories/${id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ github_repo: repo }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const updated = (await res.json()) as Category;
          setCategories((prev) => prev.map((c) => (c.id === id ? updated : c)));
        } catch (e) {
          setCategories(before);
          setError(e instanceof Error ? e.message : "Failed to link repo");
        }
      })();
    },
    [categories],
  );

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
      setRepo: setCategoryRepo,
      remove: removeCategory,
    }),
    [
      categories,
      pathOf,
      categoryPaths,
      changeItemCategory,
      ensureCategory,
      renameCategory,
      setCategoryRepo,
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

  // Selection + keyboard nav run on the status-grouped list and on the board
  // (which is always status-grouped). The model is entirely status-based.
  const selectionActive =
    keyboardEnabled &&
    !showArchived &&
    ((view === "list" && groupBy === "status") || view === "board");

  // The effective selection, derived at render (no state-sync effect): it only
  // exists while the status-grouped list/board is showing AND the item is
  // still visible — filtered-out/deleted items and other views read as no
  // selection, so no stale highlight lingers.
  const selectedId =
    selectionActive &&
    rawSelectedId &&
    visibleItems.some((it) => it.id === rawSelectedId)
      ? rawSelectedId
      : null;

  // Where a new item lands: right after the selected row when it's in Not
  // Started, otherwise the end of the Not Started column. New items are always
  // Not Started, so a selection in another status falls back to the end.
  const addPosition = useMemo(() => {
    const news = grouped.new;
    const sel = selectedId ? visibleItems.find((it) => it.id === selectedId) : null;
    if (sel && sel.status === "new") {
      const i = news.findIndex((it) => it.id === sel.id);
      return computePosition(sel.position, news[i + 1]?.position);
    }
    return computePosition(news[news.length - 1]?.position, undefined);
  }, [grouped, selectedId, visibleItems]);

  // j/k move the selection (across status sections in display order); 0/g jump
  // to the top item of the current category and G to the bottom; Ctrl-f/Ctrl-b
  // move the selected item forward/back one status; u/d move it one slot within
  // its own status section (never crossing into another status).
  useEffect(() => {
    if (!selectionActive) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (adding || openItemId || showCategoryManager) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))
      ) {
        return;
      }
      const sel = selectedId
        ? visibleItems.find((it) => it.id === selectedId) ?? null
        : null;

      // Ctrl-f / Ctrl-b move the selected item forward/back one status
      // (new → in_progress → blocked → testing → done), landing it at the TOP
      // of the destination category. It stays selected, so the focus effect scrolls
      // it into view at its new home. Clamped at the ends.
      if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "f" || e.key === "b")) {
        if (!sel) return;
        const i = ITEM_STATUSES.indexOf(sel.status);
        const target = e.key === "f" ? i + 1 : i - 1;
        if (target < 0 || target >= ITEM_STATUSES.length) return;
        e.preventDefault();
        const destStatus = ITEM_STATUSES[target];
        const pos = computePosition(undefined, grouped[destStatus][0]?.position);
        void patchItem(sel.id, { status: destStatus, position: pos });
        return;
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!"jkgG0ud".includes(e.key)) return;

      // u/d move the selected item one slot within its own status column,
      // clamped so it never leaves that status. Identical for list and board.
      if (e.key === "u" || e.key === "d") {
        if (!sel) return;
        const section = grouped[sel.status];
        const i = section.findIndex((it) => it.id === sel.id);
        const target = e.key === "u" ? i - 1 : i + 1;
        if (target < 0 || target >= section.length) return; // clamp within status
        e.preventDefault();
        const reordered = [...section];
        reordered.splice(i, 1);
        reordered.splice(target, 0, sel);
        const pos = computePosition(
          reordered[target - 1]?.position,
          reordered[target + 1]?.position,
        );
        void patchItem(sel.id, { position: pos });
        return;
      }

      // The current category: the selected card's column/section, or Not
      // Started as the default entry point when nothing is selected.
      const cat = grouped[sel ? sel.status : "new"];

      // 0/g jump to the top item of the current category, G to the bottom.
      // Identical in list and board.
      if (e.key === "0" || e.key === "g" || e.key === "G") {
        if (cat.length === 0) return;
        e.preventDefault();
        setSelectedId(cat[e.key === "G" ? cat.length - 1 : 0].id);
        return;
      }

      // j/k move the selection. On the board they stay inside the selected
      // card's column (no cross-column flow); on the list they flow across
      // status sections in display order.
      if (view === "board") {
        if (cat.length === 0) return;
        const i = sel ? cat.findIndex((it) => it.id === sel.id) : -1;
        e.preventDefault();
        if (e.key === "j") setSelectedId(cat[i < 0 ? 0 : Math.min(i + 1, cat.length - 1)].id);
        else if (e.key === "k") setSelectedId(cat[i < 0 ? 0 : Math.max(i - 1, 0)].id);
      } else {
        const order = ITEM_STATUSES.flatMap((s) => grouped[s]);
        if (order.length === 0) return;
        const idx = selectedId ? order.findIndex((it) => it.id === selectedId) : -1;
        if (e.key === "j") {
          e.preventDefault();
          setSelectedId((order[idx < 0 ? 0 : Math.min(idx + 1, order.length - 1)]).id);
        } else if (e.key === "k") {
          e.preventDefault();
          setSelectedId((order[idx < 0 ? 0 : Math.max(idx - 1, 0)]).id);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    selectionActive,
    adding,
    openItemId,
    showCategoryManager,
    grouped,
    visibleItems,
    view,
    selectedId,
    patchItem,
  ]);

  // Keep the selected row visible as j/k/g/G move the selection and u/d reorder
  // it. `block: "nearest"` only scrolls when the row is actually out of view.
  const selectedPos = selectedId
    ? visibleItems.find((it) => it.id === selectedId)?.position
    : undefined;
  useEffect(() => {
    if (!selectionActive || !selectedId) return;
    const el = document.querySelector(`[data-item-id="${selectedId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selectionActive, selectedId, selectedPos]);

  // Click-off to deselect. A pointer-down anywhere that isn't a card row or an
  // interactive control clears the selection — including the page margins (which
  // sit OUTSIDE `main`) and the toolbar space ABOVE the grid, neither of which
  // lives inside the board's own scroll box. That's why this is a document-level
  // listener rather than an onClick on a wrapper: only the document spans those
  // regions. Interactive targets (buttons, links, inputs, the add form, pickers)
  // are skipped so their own clicks still fire and, e.g., "Add item" still reads
  // the current selection.
  useEffect(() => {
    if (!selectionActive || !selectedId) return;
    if (adding || openItemId || showCategoryManager) return;
    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (t.closest("[data-item-id]")) return; // a row — its own click selects it
      if (
        t.closest(
          "button, a, input, textarea, select, label, [role='button'], [role='menuitem'], [role='option'], [contenteditable='true']",
        )
      ) {
        return; // interactive control — leave its click alone
      }
      setSelectedId(null);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [selectionActive, selectedId, adding, openItemId, showCategoryManager]);

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
        <div className="lg:shrink-0">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="group inline-flex items-center gap-2 text-sm font-medium text-[var(--color-ink)] transition-opacity hover:opacity-80"
          >
            <span
              className="grid h-8 w-8 place-items-center rounded-full bg-[#5b58d6] text-white shadow-sm"
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                className="h-5 w-5"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            Add item
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-[var(--color-bug)]">{error}</p>
      ) : null}

      <div className="mt-4 mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 lg:shrink-0">
        {/* LEFT — how you look at items: view, then filters. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* View cluster */}
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

        {/* RIGHT — actions you take: manage areas, archived. */}
        <div className="flex items-center gap-2">
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
          Only desktop (≥lg) gets this contained scroll; phones (both
          orientations — landscape is ~960px wide) and tablets keep plain
          full-page scroll, so only the pinned top bar stays put. */}
      <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain">
      {items === null ? (
        <p className="text-sm text-[var(--color-faint)]">Loading…</p>
      ) : view === "list" ? (
        <ItemList
          grouped={grouped}
          selectedId={selectedId}
          onSelect={setSelectedId}
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
          isCollapsed={isCollapsed}
          onToggleCollapse={toggleCollapse}
          areaGroups={
            groupBy === "area" && !showArchived ? groupedByArea : undefined
          }
          flatItems={groupBy === "flat" && !showArchived ? flatItems : undefined}
        />
      ) : (
        <Board
          grouped={grouped}
          selectedId={selectedId}
          onSelect={setSelectedId}
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
          isCollapsed={isCollapsed}
          onToggleCollapse={toggleCollapse}
        />
      )}
      </div>

      {adding ? (
        <AddItemModal
          projectId={projectId}
          allTags={allTags}
          position={addPosition}
          onClose={() => setAdding(false)}
          onCreated={addCreated}
        />
      ) : null}
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
        <CategoryManager
          projectId={projectId}
          onImported={refetch}
          onClose={() => setShowCategoryManager(false)}
        />
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
function groupByStatus(items: Item[]): Record<ItemStatus, Item[]> {
  const result = Object.fromEntries(
    ITEM_STATUSES.map((s) => [s, [] as Item[]]),
  ) as Record<ItemStatus, Item[]>;
  for (const it of items) result[it.status].push(it);
  for (const k of Object.keys(result) as ItemStatus[]) {
    if (k === "done") {
      // Done is ordered by when each item entered Done (oldest first, newest at
      // the bottom); fall back to position when done_at is missing.
      result[k].sort((a, b) => {
        const at = a.done_at ? Date.parse(a.done_at) : Infinity;
        const bt = b.done_at ? Date.parse(b.done_at) : Infinity;
        return at - bt || a.position - b.position;
      });
    } else {
      result[k].sort((a, b) => a.position - b.position);
    }
  }
  return result;
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
