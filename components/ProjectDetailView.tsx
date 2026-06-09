"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { ItemList } from "@/components/ItemList";
import { Board } from "@/components/Board";
import { ItemDetailModal } from "@/components/ItemDetailModal";
import { Tag } from "@/components/Tag";
import { TagEditor } from "@/components/TagEditor";
import { localPart } from "@/lib/format";
import {
  ITEM_TYPES,
  TYPE_LABEL,
  type Item,
  type ItemStatus,
  type ItemType,
  type RichDoc,
} from "@/lib/types";

type View = "list" | "board";

export function ProjectDetailView({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [creatorFilter, setCreatorFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<ItemType>("feature");
  const [newTags, setNewTags] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/items`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Item[]) => !cancelled && setItems(d))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const createItem = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/items`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed, type, tags: newTags }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = (await res.json()) as Item;
      setItems((prev) => (prev ? [...prev, created] : [created]));
      setName("");
      setNewTags([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  }, [name, type, newTags, busy, projectId]);

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

        setItems((prev) => (prev ? [...prev, withBody] : [withBody]));
        setName("");
        setNewTags([]);
        setOpenItemId(withBody.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to add image");
      } finally {
        setBusy(false);
      }
    },
    [name, type, newTags, busy, projectId],
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

  const creators = useMemo(() => {
    const set = new Set<string>();
    for (const it of items ?? []) if (it.created_by) set.add(it.created_by);
    return Array.from(set).sort();
  }, [items]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const it of items ?? []) for (const t of it.tags ?? []) set.add(t);
    return Array.from(set).sort();
  }, [items]);

  const visibleItems = useMemo(() => {
    let list = items ?? [];
    if (creatorFilter) list = list.filter((it) => it.created_by === creatorFilter);
    // AND semantics: an item must carry every selected tag.
    if (tagFilter.length) {
      list = list.filter((it) => tagFilter.every((t) => it.tags?.includes(t)));
    }
    return list;
  }, [items, creatorFilter, tagFilter]);

  const grouped = useMemo(() => groupByStatus(visibleItems), [visibleItems]);

  const openItem = useMemo(
    () => (openItemId ? (items?.find((it) => it.id === openItemId) ?? null) : null),
    [openItemId, items],
  );

  return (
    <>
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
          <TagEditor value={newTags} suggestions={allTags} onChange={setNewTags} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <TypeSegmented value={type} onChange={setType} />
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

      {error ? (
        <p className="mt-3 text-sm text-[var(--color-bug)]">{error}</p>
      ) : null}

      <div className="mt-4 mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5 text-sm">
          <ViewTab active={view === "list"} onClick={() => setView("list")}>
            List
          </ViewTab>
          <ViewTab active={view === "board"} onClick={() => setView("board")}>
            Board
          </ViewTab>
        </div>
        {creators.length > 0 ? (
          <CreatorFilter
            creators={creators}
            value={creatorFilter}
            onChange={setCreatorFilter}
          />
        ) : null}
      </div>

      {allTags.length > 0 ? (
        <TagFilterBar
          tags={allTags}
          active={tagFilter}
          onToggle={toggleTag}
          onClear={() => setTagFilter([])}
        />
      ) : null}

      {items === null ? (
        <p className="text-sm text-[var(--color-faint)]">Loading…</p>
      ) : view === "list" ? (
        <ItemList
          grouped={grouped}
          onPatch={patchItem}
          onDelete={deleteItem}
          onOpen={(it) => setOpenItemId(it.id)}
          onCreatorClick={toggleCreatorFilter}
          activeCreator={creatorFilter}
          onTagClick={toggleTag}
          activeTags={tagFilter}
          tagSuggestions={allTags}
          onTagsChange={changeItemTags}
        />
      ) : (
        <Board
          grouped={grouped}
          onPatch={patchItem}
          onDelete={deleteItem}
          onOpen={(it) => setOpenItemId(it.id)}
          onCreatorClick={toggleCreatorFilter}
          activeCreator={creatorFilter}
          onTagClick={toggleTag}
          activeTags={tagFilter}
          tagSuggestions={allTags}
          onTagsChange={changeItemTags}
        />
      )}

      {openItem ? (
        <ItemDetailModal
          item={openItem}
          allTags={allTags}
          onClose={() => setOpenItemId(null)}
          onSaveBody={saveBody}
          onSaveTags={saveTags}
        />
      ) : null}
    </>
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
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-[var(--color-faint)]">tags</span>
      {tags.map((t) => (
        <Tag
          key={t}
          label={t}
          onClick={() => onToggle(t)}
          active={active.includes(t)}
        />
      ))}
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

function groupByStatus(items: Item[]): Record<ItemStatus, Item[]> {
  const result: Record<ItemStatus, Item[]> = { new: [], in_progress: [], done: [] };
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
