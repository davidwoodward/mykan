"use client";

import { useState } from "react";
import { TypeBadge } from "@/components/TypeBadge";
import { Byline } from "@/components/Byline";
import { InlineTags } from "@/components/InlineTags";
import {
  ITEM_STATUSES,
  ITEM_TYPES,
  STATUS_LABEL,
  richDocText,
  type Item,
  type ItemStatus,
  type ItemType,
} from "@/lib/types";

type PatchFn = (
  id: string,
  patch: Partial<Pick<Item, "name" | "type" | "status" | "position">>,
) => Promise<void>;

export function ItemList({
  grouped,
  onPatch,
  onDelete,
  onOpen,
  onCreatorClick,
  activeCreator,
  onTagClick,
  activeTags,
  tagSuggestions,
  onTagsChange,
}: {
  grouped: Record<ItemStatus, Item[]>;
  onPatch: PatchFn;
  onDelete: (id: string) => Promise<void>;
  onOpen: (item: Item) => void;
  onCreatorClick?: (email: string) => void;
  activeCreator?: string | null;
  onTagClick?: (tag: string) => void;
  activeTags?: string[];
  tagSuggestions?: string[];
  onTagsChange?: (id: string, tags: string[]) => void;
}) {
  return (
    <div className="space-y-8">
      {ITEM_STATUSES.map((status) => (
        <section key={status}>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
            {STATUS_LABEL[status]}{" "}
            <span className="ml-1 text-[var(--color-faint)]">
              {grouped[status].length}
            </span>
          </h2>
          {grouped[status].length === 0 ? (
            <p className="rounded-md border border-dashed border-[var(--color-line)] px-3 py-4 text-sm text-[var(--color-faint)]">
              Nothing here.
            </p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)] rounded-md border border-[var(--color-line)] bg-[var(--color-surface)]">
              {grouped[status].map((it) => (
                <ItemRow
                  key={it.id}
                  item={it}
                  onPatch={onPatch}
                  onDelete={onDelete}
                  onOpen={onOpen}
                  onCreatorClick={onCreatorClick}
                  activeCreator={activeCreator}
                  onTagClick={onTagClick}
                  activeTags={activeTags}
                  tagSuggestions={tagSuggestions}
                  onTagsChange={onTagsChange}
                />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

function ItemRow({
  item,
  onPatch,
  onDelete,
  onOpen,
  onCreatorClick,
  activeCreator,
  onTagClick,
  activeTags,
  tagSuggestions,
  onTagsChange,
}: {
  item: Item;
  onPatch: PatchFn;
  onDelete: (id: string) => Promise<void>;
  onOpen: (item: Item) => void;
  onCreatorClick?: (email: string) => void;
  activeCreator?: string | null;
  onTagClick?: (tag: string) => void;
  activeTags?: string[];
  tagSuggestions?: string[];
  onTagsChange?: (id: string, tags: string[]) => void;
}) {
  const text = richDocText(item.body);

  return (
    <li className="group flex items-start gap-3 px-3 py-2.5">
      <StatusPill
        status={item.status}
        onCycle={() => void onPatch(item.id, { status: nextStatus(item.status) })}
      />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => onOpen(item)}
          title="Open"
          className="block w-full whitespace-pre-wrap break-words text-left text-sm leading-6 transition-colors hover:text-[var(--color-accent)]"
        >
          {text || (
            <span className="italic text-[var(--color-accent)]">View content</span>
          )}
        </button>
        <InlineTags
          tags={item.tags}
          suggestions={tagSuggestions ?? []}
          onChange={(tags) => onTagsChange?.(item.id, tags)}
          onTagClick={onTagClick}
          activeTags={activeTags}
        />
        <Byline
          createdBy={item.created_by}
          updatedBy={item.updated_by}
          updatedAt={item.updated_at}
          onCreatorClick={onCreatorClick}
          activeCreator={activeCreator}
          className="mt-1 block"
        />
      </div>
      <TypeMenu
        value={item.type}
        onChange={(t) => void onPatch(item.id, { type: t })}
      />
      <button
        type="button"
        onClick={() => void onDelete(item.id)}
        className="invisible self-center text-xs text-[var(--color-faint)] transition-colors hover:text-[var(--color-bug)] group-hover:visible"
        aria-label={`Delete ${text || "item"}`}
      >
        Delete
      </button>
    </li>
  );
}

function nextStatus(s: ItemStatus): ItemStatus {
  const i = ITEM_STATUSES.indexOf(s);
  return ITEM_STATUSES[(i + 1) % ITEM_STATUSES.length];
}

function StatusPill({
  status,
  onCycle,
}: {
  status: ItemStatus;
  onCycle: () => void;
}) {
  const styles: Record<ItemStatus, string> = {
    new: "text-[var(--color-muted)] bg-[var(--color-canvas)] ring-[var(--color-line-strong)]",
    in_progress:
      "text-[var(--color-accent-ink)] bg-[var(--color-accent-soft)] ring-[var(--color-line-strong)]",
    done: "text-[var(--color-feature)] bg-[var(--color-feature-bg)] ring-[var(--color-feature-line)]",
  };
  return (
    <button
      type="button"
      onClick={onCycle}
      title="Click to cycle status"
      className={`mt-0.5 inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1 ring-inset ${styles[status]}`}
    >
      {STATUS_LABEL[status]}
    </button>
  );
}

function TypeMenu({
  value,
  onChange,
}: {
  value: ItemType;
  onChange: (t: ItemType) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <TypeBadge type={value} />
      </button>
      {open ? (
        <div
          role="listbox"
          className="absolute right-0 z-10 mt-1 flex w-32 flex-col gap-0.5 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-sm"
        >
          {ITEM_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="option"
              aria-selected={t === value}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(t);
                setOpen(false);
              }}
              className={`flex items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-[var(--color-canvas)] ${
                t === value ? "text-[var(--color-ink)]" : "text-[var(--color-muted)]"
              }`}
            >
              <TypeBadge type={t} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
