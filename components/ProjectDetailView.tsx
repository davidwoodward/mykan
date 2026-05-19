"use client";

import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { ItemList } from "@/components/ItemList";
import { Board } from "@/components/Board";
import {
  ITEM_TYPES,
  TYPE_LABEL,
  type Item,
  type ItemStatus,
  type ItemType,
} from "@/lib/types";

type View = "list" | "board";

export function ProjectDetailView({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("list");
  const [name, setName] = useState("");
  const [type, setType] = useState<ItemType>("feature");
  const [busy, setBusy] = useState(false);

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
        body: JSON.stringify({ name: trimmed, type }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created = (await res.json()) as Item;
      setItems((prev) => (prev ? [...prev, created] : [created]));
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setBusy(false);
    }
  }, [name, type, busy, projectId]);

  const patchItem = useCallback(
    async (id: string, patch: Partial<Pick<Item, "name" | "type" | "status" | "position">>) => {
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

  const grouped = useMemo(() => groupByStatus(items ?? []), [items]);

  return (
    <>
      <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <AutoGrowTextarea
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onNameKeyDown}
          placeholder="Add an item…"
          className="text-base placeholder:text-[var(--color-faint)]"
          aria-label="Item name"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <TypeSegmented value={type} onChange={setType} />
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-[var(--color-faint)] sm:inline">
              Enter for newline · ⌘/Ctrl+Enter to add
            </span>
            <button
              type="button"
              onClick={createItem}
              disabled={!name.trim() || busy}
              className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <p className="mt-4 text-sm text-[var(--color-bug)]">{error}</p>
      ) : null}

      <div className="mt-8 mb-4 inline-flex rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-0.5 text-sm">
        <ViewTab active={view === "list"} onClick={() => setView("list")}>
          List
        </ViewTab>
        <ViewTab active={view === "board"} onClick={() => setView("board")}>
          Board
        </ViewTab>
      </div>

      {items === null ? (
        <p className="text-sm text-[var(--color-faint)]">Loading…</p>
      ) : view === "list" ? (
        <ItemList grouped={grouped} onPatch={patchItem} onDelete={deleteItem} />
      ) : (
        <Board grouped={grouped} onPatch={patchItem} onDelete={deleteItem} />
      )}
    </>
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
