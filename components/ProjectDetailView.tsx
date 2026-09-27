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
import { useRouter, useSearchParams } from "next/navigation";
import { AddItemModal } from "@/components/AddItemModal";
import {
  boardSearch,
  boardStateFromParams,
  normAreaPath,
  type BoardState,
} from "@/lib/board-state";
import { cardPath } from "@/lib/card-url";
import {
  clearCardFromBoard,
  markCardFromBoard,
  pendingSavesSettled,
  rememberBoardScroll,
  takeBoardScroll,
} from "@/components/boardReturn";
import { ProjectKeyProvider } from "@/components/RefBadge";
import { AssigneeProvider } from "@/components/AssigneePicker";
import { Tag } from "@/components/Tag";
import { displayName, itemRef } from "@/lib/format";
import {
  ITEM_STATUSES,
  STATUS_LABEL,
  richDocText,
  type Category,
  type Item,
  type ItemStatus,
} from "@/lib/types";
import {
  CategoryProvider,
  buildPathOf,
  subtreeIdSet,
} from "@/components/CategoryPicker";
import { CategoryManager } from "@/components/CategoryManager";
import { EpicProvider, useEpicValue } from "@/components/EpicLinks";
import { OpenQuestionsProvider, openQuestionCounts } from "@/components/OpenQuestionsBadge";

/** The API's `{ error }` message for a failed response, else "HTTP <status>". */
async function responseError(res: Response): Promise<string> {
  const msg = await res
    .json()
    .then((d: { error?: unknown }) => (typeof d.error === "string" ? d.error : null))
    .catch(() => null);
  return msg ?? `HTTP ${res.status}`;
}
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
  const router = useRouter();
  // View, grouping, filters and search, read from the board's URL when the
  // board mounts. Read on the client (not passed from the server page): after
  // Back from a card page, the URL carries the filters as last written here by
  // replaceState, while a cached server render would carry the ones the board
  // was first loaded with.
  const searchParams = useSearchParams();
  const [initialState] = useState<BoardState>(() =>
    boardStateFromParams(new URLSearchParams(searchParams.toString())),
  );
  const [items, setItems] = useState<Item[] | null>(null);
  // Open questions per item (KANBAN-38 badge), taken from each items fetch and
  // kept apart from `items`, whose rows item PATCH responses replace.
  const [openQuestions, setOpenQuestions] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  // View, grouping, filters and search start from the URL and are written back
  // to it as they change (KANBAN-44), so leaving for a card page and coming
  // back (browser Back, or Esc on the card) shows the same board.
  const [view, setView] = useState<View>(initialState.view);
  const [creatorFilter, setCreatorFilter] = useState<string | null>(initialState.by);
  const [tagFilter, setTagFilter] = useState<string[]>(initialState.tags);
  const [showArchived, setShowArchived] = useState(initialState.archived);
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [chosenArea, setChosenArea] = useState<string | null>(null);
  // The URL names the area filter by path (no ids in URLs); it becomes a node
  // id once the areas load. Null once resolved (or when there was none).
  const [pendingAreaPath, setPendingAreaPath] = useState<string | null>(initialState.area);
  const [groupBy, setGroupBy] = useState<"status" | "area" | "flat">(initialState.group);
  const [statusFilter, setStatusFilter] = useState<ItemStatus[]>(initialState.status);
  // Free-text search over card content (body text + ref number), AND-composed
  // with the other filters. Shared by List/Board; kept in the URL.
  const [query, setQuery] = useState(initialState.q);
  // The list/board scroll region (desktop), for remembering its position.
  const scrollRef = useRef<HTMLDivElement>(null);
  // The effective area filter: the one picked here, else the URL's path once
  // an area with that path has loaded.
  const areaFilter = useMemo(() => {
    if (chosenArea) return chosenArea;
    if (!pendingAreaPath) return null;
    const pathOfNode = buildPathOf(categories);
    return categories.find((c) => normAreaPath(pathOfNode(c.id)) === pendingAreaPath)?.id ?? null;
  }, [chosenArea, pendingAreaPath, categories]);
  const setAreaFilter = useCallback((id: string | null) => {
    setChosenArea(id);
    setPendingAreaPath(null);
  }, []);
  const searchRef = useRef<HTMLInputElement>(null);
  // The compact (touch) toolbar's own search box; "/" focuses whichever shows.
  const compactSearchRef = useRef<HTMLInputElement>(null);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  // The touch layout's "View & filters" sheet (KANBAN-52).
  const [showFilters, setShowFilters] = useState(false);
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
    // The board is showing: no card page sits on top of it any more.
    clearCardFromBoard();
    // Coming back from a card page whose save is still landing (browser Back
    // unmounts it mid-save): wait for it so the board never shows the old text.
    pendingSavesSettled()
      .then(() => fetch(`/api/projects/${projectId}/items`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Item[]) => {
        if (cancelled) return;
        setItems(d);
        setOpenQuestions(openQuestionCounts(d));
      })
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
      const list = (await r.json()) as Item[];
      setItems(list);
      setOpenQuestions(openQuestionCounts(list));
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
      patch: Partial<Pick<Item, "type" | "status" | "position" | "body" | "parent_id">>,
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
        if (!res.ok) throw new Error(await responseError(res));
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

  // Link (or clear with null) an item's parent epic. Optimistic + PATCH; the
  // server applies the epic rules and its message is shown on refusal.
  // Resolves once the write settles (it never rejects).
  const setItemParent = useCallback((id: string, parentId: string | null): Promise<void> => {
    let before: Item | undefined;
    setItems((prev) =>
      prev
        ? prev.map((it) => {
            if (it.id !== id) return it;
            before = it;
            return { ...it, parent_id: parentId };
          })
        : prev,
    );
    return (async () => {
      try {
        const res = await fetch(`/api/items/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parent_id: parentId }),
        });
        if (!res.ok) throw new Error(await responseError(res));
        const updated = (await res.json()) as Item;
        setItems((prev) =>
          prev ? prev.map((it) => (it.id === id ? updated : it)) : prev,
        );
      } catch (e) {
        const restore = before;
        if (restore) {
          setItems((prev) =>
            prev ? prev.map((it) => (it.id === id ? restore : it)) : prev,
          );
        }
        setError(e instanceof Error ? e.message : "Failed to set epic");
      }
    })();
  }, []);
  // Awaited variant for batch linking (the multi-select Add child picker): the
  // same PATCH, not optimistic, and the server's refusal is RETURNED (null on
  // success) so the picker can report it per card instead of via the banner.
  const linkItemParent = useCallback(
    async (id: string, parentId: string | null): Promise<string | null> => {
      try {
        const res = await fetch(`/api/items/${id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ parent_id: parentId }),
        });
        if (!res.ok) return await responseError(res);
        const updated = (await res.json()) as Item;
        setItems((prev) =>
          prev ? prev.map((it) => (it.id === id ? updated : it)) : prev,
        );
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "Failed to set epic";
      }
    },
    [],
  );
  // Opening a card is a navigation to its page, /KEY-N (KANBAN-44; the item
  // modal is gone). Before leaving, remember where the board was scrolled and
  // which card was opened, and mark that the card page sits on top of this
  // board, so Esc there can go Back to exactly this board.
  const openCard = useCallback(
    (it: Pick<Item, "number">) => {
      if (!projectKey) return;
      rememberBoardScroll(projectKey, {
        listTop: scrollRef.current?.scrollTop ?? 0,
        windowY: window.scrollY,
        number: it.number,
      });
      markCardFromBoard(projectKey);
      router.push(cardPath(projectKey, it.number));
    },
    [projectKey, router],
  );
  const openCardById = useCallback(
    (id: string) => {
      const it = items?.find((x) => x.id === id);
      if (it) openCard(it);
    },
    [items, openCard],
  );
  const epicCtx = useEpicValue(items, openCardById, setItemParent, linkItemParent, refetch);

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

  // Inline assignee edits from rows/cards (optimistic): the picker calls this
  // once, when its list closes with a changed selection. Never rejects.
  const changeItemAssignees = useCallback((id: string, assignees: string[]): Promise<void> => {
    setItems((prev) =>
      prev ? prev.map((it) => (it.id === id ? { ...it, assignees } : it)) : prev,
    );
    return (async () => {
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
      // (A pending URL area naming the deleted node simply stops matching.)
      void fetch(`/api/categories/${id}`, { method: "DELETE" }).catch((e) =>
        setError(e instanceof Error ? e.message : "Failed to delete area"),
      );
    },
    [areaFilter, setAreaFilter],
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
      // Deleting an epic un-links its children first (server-side, with a
      // history entry on each), so mirror that locally.
      const hadChildren = (before ?? []).some((it) => it.parent_id === id);
      setItems(
        (prev) =>
          prev
            ?.filter((it) => it.id !== id)
            .map((it) => (it.parent_id === id ? { ...it, parent_id: null } : it)) ?? prev,
      );
      try {
        const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(await responseError(res));
      } catch (e) {
        setItems(before ?? null);
        const msg = e instanceof Error ? e.message : "Failed to delete";
        setError(msg);
        // A failed epic delete re-links its children server-side, and a re-link
        // can itself fail — re-pull so the board shows what actually happened
        // (keeping the message, which a successful refetch would clear).
        if (hadChildren) void refetch().then(() => setError(msg));
      }
    },
    [items, refetch],
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

  // Keep the board's URL in step with its view state (replaceState: no history
  // entry per change, so Back from a card still lands here in one step).
  const boardQuery = boardSearch({
    view,
    group: groupBy,
    status: statusFilter,
    tags: tagFilter,
    area: areaFilter ? normAreaPath(pathOf(areaFilter)) : pendingAreaPath,
    by: creatorFilter,
    q: query,
    archived: showArchived,
  });
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    if (search === boardQuery) return;
    window.history.replaceState(null, "", `${pathname}${boardQuery}${hash}`);
  }, [boardQuery]);

  // Back from a card page: put the scroll position back (the desktop list is
  // its own scroll box, which the browser never restores) and reselect the
  // card that was opened. Once, when the items first arrive.
  const scrollRestored = useRef(false);
  useEffect(() => {
    if (items === null || scrollRestored.current || !projectKey) return;
    scrollRestored.current = true;
    const saved = takeBoardScroll(projectKey);
    if (!saved) return;
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = saved.listTop;
      if (saved.windowY) window.scrollTo(0, saved.windowY);
    });
    const opened = saved.number === null ? null : items.find((it) => it.number === saved.number);
    if (opened) setSelectedId(opened.id);
  }, [items, projectKey]);

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

  // Per-item lowercased haystack for content search: the body's plain text plus
  // the ref string (e.g. "amos-12" / "#12"), so a bare number like "12" matches
  // both the ref and any body text. Precomputed so keystrokes are just includes.
  const searchIndex = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of pool) {
      const ref = itemRef(projectKey, it.number) ?? "";
      map.set(it.id, `${richDocText(it.body)} ${ref}`.toLowerCase());
    }
    return map;
  }, [pool, projectKey]);

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
    // Content search: substring over body text + ref (see searchIndex).
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((it) => (searchIndex.get(it.id) ?? "").includes(q));
    }
    return list;
  }, [pool, creatorFilter, tagFilter, areaFilter, statusFilter, categories, query, searchIndex]);

  const grouped = useMemo(() => groupByStatus(visibleItems), [visibleItems]);

  // A column with zero (visible) entries always shows collapsed, regardless of
  // the saved per-project setting — an empty column is just clutter. This is a
  // DISPLAY-ONLY override: it never writes to the persisted collapse state, and
  // toggling is suppressed while empty so a stray click on the rail can't
  // silently save a preference. When the column gets items again it reverts to
  // whatever the saved setting was.
  const isColumnCollapsed = useCallback(
    (status: ItemStatus) => grouped[status].length === 0 || isCollapsed(status),
    [grouped, isCollapsed],
  );
  const onToggleColumnCollapse = useCallback(
    (status: ItemStatus) => {
      if (grouped[status].length === 0) return; // forced-collapsed; don't persist
      toggleCollapse(status);
    },
    [grouped, toggleCollapse],
  );

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

  // Selection runs on the status-grouped list and on the board (which is always
  // status-grouped). The model is entirely status-based.
  //
  // Selection is POINTER-FIRST and always available: clicking a card selects it,
  // which is how you choose the anchor a newly added item is ordered right
  // below. It is deliberately NOT behind the keyboard setting.
  const selectionActive =
    !showArchived &&
    ((view === "list" && groupBy === "status") || view === "board");

  // The vim-style keyboard navigation on top of that selection (j/k, g/G/0, u/d,
  // Ctrl-f/b) is the part gated by the per-user setting (KANBAN-31).
  const keyboardNavActive = selectionActive && keyboardEnabled;

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
    if (!keyboardNavActive) return;
    function onKey(e: globalThis.KeyboardEvent) {
      if (adding || showCategoryManager || showFilters) return;
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

      // Enter opens the selected card's page (Enter = primary action). A
      // focused button or link keeps its own Enter.
      if (e.key === "Enter") {
        if (!sel || t?.closest("button, a, [role='button'], [role='option']")) return;
        e.preventDefault();
        openCard(sel);
        return;
      }

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
    keyboardNavActive,
    adding,
    showCategoryManager,
    showFilters,
    grouped,
    visibleItems,
    view,
    selectedId,
    patchItem,
    openCard,
  ]);

  // "/" focuses the card search from anywhere on the page. Independent of the
  // vim-nav toggle, and it yields when you're already typing in a field (so a
  // literal "/" in an input/editor still types).
  useEffect(() => {
    function onSlash(e: globalThis.KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (adding || showCategoryManager || showFilters) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))
      ) {
        return;
      }
      e.preventDefault();
      // Only one of the two search boxes is laid out (offsetParent is null
      // for the hidden one).
      const compact = compactSearchRef.current;
      (compact?.offsetParent ? compact : searchRef.current)?.focus();
    }
    window.addEventListener("keydown", onSlash);
    return () => window.removeEventListener("keydown", onSlash);
  }, [adding, showCategoryManager, showFilters]);

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
    if (adding || showCategoryManager || showFilters) return;
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
  }, [selectionActive, selectedId, adding, showCategoryManager, showFilters]);


  // Filters applied to the board, for the touch toolbar's badge and pills.
  // Archived counts: it changes which cards are shown.
  const activeFilterCount =
    statusFilter.length +
    tagFilter.length +
    (areaFilter ? 1 : 0) +
    (creatorFilter ? 1 : 0) +
    (showArchived ? 1 : 0);
  const clearAllFilters = () => {
    setStatusFilter([]);
    setTagFilter([]);
    setAreaFilter(null);
    setCreatorFilter(null);
    setShowArchived(false);
  };

  return (
    <ProjectKeyProvider value={projectKey}>
      <AssigneeProvider
        value={{ members, enabled: !isPrivate, onChange: changeItemAssignees }}
      >
      <CategoryProvider value={categoryCtx}>
      <EpicProvider value={epicCtx}>
      <OpenQuestionsProvider value={openQuestions}>
      {error ? (
        <p className="mt-3 text-sm text-[var(--color-bug)]">{error}</p>
      ) : null}

      {/* Touch layouts (phones, tablets, touch iPads): one line of full-size
          targets — search, List/Board, and a Filters button carrying the
          active-filter count — with the applied filters as removable pills
          under it. Everything else lives in the View & filters sheet. */}
      <div className="mb-3 hidden flex-col gap-2 compact:flex lg:shrink-0">
        <div className="flex items-center gap-2">
          <div className="relative flex min-w-0 flex-1 items-center">
            <svg
              className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--color-faint)]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={compactSearchRef}
              type="search"
              enterKeyHint="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  e.currentTarget.blur();
                } else if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
              placeholder="Search cards…"
              aria-label="Search cards"
              className="h-10 w-full min-w-0 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] pl-9 pr-9 text-base text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)] [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                title="Clear search"
                className="absolute right-1 grid h-8 w-8 place-items-center rounded-md text-[var(--color-faint)] hover:text-[var(--color-ink)]"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            ) : null}
          </div>
          <div className="inline-flex h-10 shrink-0 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5 text-sm">
            <ViewTab active={view === "list"} onClick={() => setView("list")}>
              List
            </ViewTab>
            <ViewTab active={view === "board"} onClick={() => setView("board")}>
              Board
            </ViewTab>
          </div>
          <button
            type="button"
            onClick={() => setShowFilters(true)}
            aria-label={`View and filters${activeFilterCount ? `, ${activeFilterCount} active` : ""}`}
            title="View & filters"
            className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-lg border transition-colors ${
              activeFilterCount
                ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-muted)]"
            }`}
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            {activeFilterCount ? (
              <span className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-[#5b58d6] px-1 text-[11px] font-medium tabular-nums text-white">
                {activeFilterCount}
              </span>
            ) : null}
          </button>
        </div>
        {activeFilterCount ? (
          <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
            {showArchived ? (
              <ActivePill label="Archived" onRemove={() => setShowArchived(false)} />
            ) : null}
            {statusFilter.map((st) => (
              <ActivePill
                key={st}
                label={STATUS_LABEL[st]}
                onRemove={() => setStatusFilter((cur) => cur.filter((x) => x !== st))}
              />
            ))}
            {areaFilter ? (
              <ActivePill
                label={categoryPaths.find((c) => c.id === areaFilter)?.path ?? "Area"}
                onRemove={() => setAreaFilter(null)}
              />
            ) : null}
            {tagFilter.map((t) => (
              <ActivePill key={t} label={`#${t}`} onRemove={() => toggleTag(t)} />
            ))}
            {creatorFilter ? (
              <ActivePill
                label={`by ${displayName(creatorFilter)}`}
                onRemove={() => setCreatorFilter(null)}
              />
            ) : null}
            <button
              type="button"
              onClick={clearAllFilters}
              className="shrink-0 px-2 text-sm text-[var(--color-faint)] underline-offset-2 hover:text-[var(--color-ink)] hover:underline"
            >
              Clear
            </button>
          </div>
        ) : null}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 compact:hidden lg:shrink-0">
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
                <div className="relative inline-flex items-center">
                  <svg
                    className="pointer-events-none absolute left-2 h-[15px] w-[15px] text-[var(--color-faint)]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  <input
                    ref={searchRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setQuery("");
                        e.currentTarget.blur();
                      }
                    }}
                    placeholder="Search cards…"
                    aria-label="Search cards"
                    className="w-40 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] py-1 pl-7 pr-6 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-accent)]"
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        searchRef.current?.focus();
                      }}
                      aria-label="Clear search"
                      title="Clear search"
                      className="absolute right-1 grid h-5 w-5 place-items-center rounded text-[var(--color-faint)] transition-colors hover:text-[var(--color-ink)]"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M18 6 6 18M6 6l12 12" />
                      </svg>
                    </button>
                  ) : null}
                </div>
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
      <div
        ref={scrollRef}
        className="pb-24 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain"
      >
      {items === null ? (
        <p className="text-sm text-[var(--color-faint)]">Loading…</p>
      ) : query.trim() && visibleItems.length === 0 ? (
        <p className="text-sm text-[var(--color-faint)]">
          No cards match your search.
        </p>
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
          onOpen={openCard}
          onCreatorClick={toggleCreatorFilter}
          activeCreator={creatorFilter}
          onTagClick={toggleTag}
          activeTags={tagFilter}
          tagSuggestions={allTags}
          onTagsChange={changeItemTags}
          onItemChange={replaceItem}
          isCollapsed={isColumnCollapsed}
          onToggleCollapse={onToggleColumnCollapse}
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
          onOpen={openCard}
          onCreatorClick={toggleCreatorFilter}
          activeCreator={creatorFilter}
          onTagClick={toggleTag}
          activeTags={tagFilter}
          tagSuggestions={allTags}
          onTagsChange={changeItemTags}
          onItemChange={replaceItem}
          isCollapsed={isColumnCollapsed}
          onToggleCollapse={onToggleColumnCollapse}
        />
      )}
      </div>

      {/* Add item is a floating action button, the same on every form factor:
          a 56px accent circle pinned bottom-right (clear of the phone's
          safe-area inset), with a white "+". The list's bottom padding keeps
          its last row from sitting under it. Its right offset is the app
          shell's gutter (px-3, or sm: 2.5vw + px-4) plus 1.5rem, so it sits
          inside the content column, clear of the desktop list's own
          scrollbar at that column's right edge. */}
      {!showArchived ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label="Add item"
          title="Add item"
          className="fixed right-[calc(2.25rem+env(safe-area-inset-right,0px))] sm:right-[calc(2.5vw+2.5rem+env(safe-area-inset-right,0px))] bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] z-30 grid h-14 w-14 place-items-center rounded-full bg-[#5b58d6] text-white shadow-lg transition-[filter,box-shadow] hover:shadow-xl hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] active:brightness-95"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-6 w-6"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      ) : null}

      {adding ? (
        <AddItemModal
          projectId={projectId}
          allTags={allTags}
          position={addPosition}
          onClose={() => setAdding(false)}
          onCreated={addCreated}
        />
      ) : null}
      {showFilters ? (
        <FilterSheet onClose={() => setShowFilters(false)}>
          <SheetSection label="View">
            <div className="flex flex-wrap gap-2">
              <Segmented
                options={[
                  ["list", "List"],
                  ["board", "Board"],
                ]}
                value={view}
                onChange={(v) => setView(v as View)}
              />
              {!showArchived && view === "list" ? (
                <Segmented
                  label="Group by"
                  options={[
                    ["status", "Status"],
                    ["area", "Area"],
                    ["flat", "Flat"],
                  ]}
                  value={groupBy}
                  onChange={(v) => setGroupBy(v as "status" | "area" | "flat")}
                />
              ) : null}
            </div>
          </SheetSection>
          <SheetSection label="Status">
            <div className="flex flex-wrap gap-2">
              {ITEM_STATUSES.map((st) => {
                const on = statusFilter.includes(st);
                return (
                  <button
                    key={st}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setStatusFilter((cur) => (on ? cur.filter((x) => x !== st) : [...cur, st]))
                    }
                    className={`h-10 rounded-full border px-4 text-sm transition-colors ${
                      on
                        ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent-ink)]"
                        : "border-[var(--color-line)] text-[var(--color-muted)]"
                    }`}
                  >
                    {STATUS_LABEL[st]}
                  </button>
                );
              })}
            </div>
          </SheetSection>
          {!showArchived && categoryPaths.length > 0 ? (
            <SheetSection label="Area">
              <select
                value={areaFilter ?? ""}
                onChange={(e) => setAreaFilter(e.target.value || null)}
                aria-label="Filter by area"
                className="h-11 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-base text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
              >
                <option value="">All areas</option>
                {categoryPaths.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.path}
                  </option>
                ))}
              </select>
            </SheetSection>
          ) : null}
          {allTags.length > 0 ? (
            <SheetSection label="Tags">
              <TagFilterBar
                tags={allTags}
                active={tagFilter}
                onToggle={toggleTag}
                onClear={() => setTagFilter([])}
                large
              />
            </SheetSection>
          ) : null}
          {creators.length > 0 ? (
            <SheetSection label="Created by">
              <Segmented
                options={[["", "Anyone"], ...creators.map((c) => [c, displayName(c)] as [string, string])]}
                value={creatorFilter ?? ""}
                onChange={(v) => setCreatorFilter(v || null)}
              />
            </SheetSection>
          ) : null}
          <div className="flex flex-wrap gap-2 border-t border-[var(--color-line)] pt-4">
            <SheetButton onClick={() => void refetch()} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </SheetButton>
            {!showArchived ? (
              <SheetButton
                onClick={() => {
                  setShowFilters(false);
                  setShowCategoryManager(true);
                }}
              >
                Manage areas
              </SheetButton>
            ) : null}
            {showArchived || archivedCount > 0 ? (
              <SheetButton onClick={() => setShowArchived((v) => !v)} active={showArchived}>
                {showArchived ? "Showing archived" : `Archived (${archivedCount})`}
              </SheetButton>
            ) : null}
            {activeFilterCount ? (
              <SheetButton onClick={clearAllFilters}>Clear filters</SheetButton>
            ) : null}
          </div>
        </FilterSheet>
      ) : null}
      {showCategoryManager ? (
        <CategoryManager
          projectId={projectId}
          onImported={refetch}
          onClose={() => setShowCategoryManager(false)}
        />
      ) : null}
      </OpenQuestionsProvider>
      </EpicProvider>
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
  large = false,
}: {
  tags: string[];
  active: string[];
  onToggle: (tag: string) => void;
  onClear: () => void;
  /** Touch sizing, for the View & filters sheet (KANBAN-52). */
  large?: boolean;
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
      {large ? null : <span className="text-xs text-[var(--color-faint)]">filter</span>}

      {active.map((t) => (
        <Tag key={t} label={t} active onClick={() => onToggle(t)} />
      ))}

      <div className={large ? "relative w-full" : "relative"}>
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
          className={
            large
              ? "h-11 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-base outline-none focus:border-[var(--color-accent)]"
              : "h-6 w-28 rounded border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-xs outline-none focus:border-[var(--color-accent)]"
          }
        />
        {focused && shown.length > 0 ? (
          <div
            className={`absolute left-0 z-20 flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5 shadow-md ${
              large ? "top-12 w-full" : "top-7 w-48"
            }`}
          >
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
                className={`flex rounded text-left ${large ? "py-2" : ""} ${
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
          {displayName(c)}
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

/** A removable pill for an applied filter, in the touch toolbar (KANBAN-52). */
function ActivePill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove filter: ${label}`}
      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-[var(--color-accent)] bg-[var(--color-accent-soft)] pl-3 pr-2 text-sm text-[var(--color-accent-ink)]"
    >
      <span className="max-w-[12rem] truncate">{label}</span>
      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  );
}

/**
 * The touch layout's View & filters sheet (KANBAN-52): slides up from the
 * bottom, full-size targets. Filters apply as they're tapped; Done, Esc, Enter
 * outside a field, or a tap on the backdrop closes it.
 */
function FilterSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const inField = !!t && /^(input|textarea|select)$/i.test(t.tagName);
      if (e.key === "Escape" && !inField) {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && !inField && !(t instanceof HTMLButtonElement)) {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="presentation">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="View and filters"
        className="relative flex max-h-[85dvh] w-full max-w-xl flex-col rounded-t-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-4 py-3">
          <h2 className="text-base font-semibold text-[var(--color-ink)]">View &amp; filters</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-lg bg-[#5b58d6] px-4 text-sm font-medium text-white"
          >
            Done
          </button>
        </div>
        <div className="flex flex-col gap-5 overflow-y-auto overscroll-contain px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
          {children}
        </div>
      </div>
    </div>
  );
}

function SheetSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--color-faint)]">{label}</h3>
      {children}
    </section>
  );
}

/** A touch-sized segmented control: one choice of several. */
function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: [string, string][];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex max-w-full flex-wrap items-center rounded-lg border border-[var(--color-line)] bg-[var(--color-canvas)] p-0.5"
    >
      {label ? <span className="px-2 text-sm text-[var(--color-faint)]">{label}</span> : null}
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`h-10 rounded-md px-4 text-sm transition-colors ${
            value === v
              ? "bg-[var(--color-ink)] text-[var(--color-canvas)]"
              : "text-[var(--color-muted)]"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function SheetButton({
  onClick,
  disabled,
  active,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-11 rounded-lg border px-4 text-sm transition-colors disabled:opacity-60 ${
        active
          ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-canvas)]"
          : "border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-muted)]"
      }`}
    >
      {children}
    </button>
  );
}
