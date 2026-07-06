"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { computePosition } from "@/lib/position";
import { TypeBadge } from "@/components/TypeBadge";
import { Byline } from "@/components/Byline";
import { InlineTags } from "@/components/InlineTags";
import { InlineAttachments } from "@/components/InlineAttachments";
import { ClampedText } from "@/components/ClampedText";
import { EditButton } from "@/components/EditButton";
import { RefBadge } from "@/components/RefBadge";
import { ItemAssignees } from "@/components/AssigneePicker";
import { ItemCategory } from "@/components/CategoryPicker";
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
  patch: Partial<Pick<Item, "type" | "status" | "position">>,
) => Promise<void>;

type RowProps = {
  onPatch: PatchFn;
  archivedView?: boolean;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
  onOpen: (item: Item) => void;
  onCreatorClick?: (email: string) => void;
  activeCreator?: string | null;
  onTagClick?: (tag: string) => void;
  activeTags?: string[];
  tagSuggestions?: string[];
  onTagsChange?: (id: string, tags: string[]) => void;
  onItemChange: (item: Item) => void;
};

/** The drag bits passed to a row when it lives in the flat sortable list. */
type SortableBits = {
  setNodeRef: (el: HTMLElement | null) => void;
  style: CSSProperties;
  handleProps: Record<string, unknown>;
  isDragging: boolean;
};

export function ItemList({
  grouped,
  onPatch,
  archivedView,
  onArchive,
  onRestore,
  onPurge,
  onOpen,
  onCreatorClick,
  activeCreator,
  onTagClick,
  activeTags,
  tagSuggestions,
  onTagsChange,
  onItemChange,
  areaGroups,
  flatItems,
}: {
  grouped: Record<ItemStatus, Item[]>;
  onPatch: PatchFn;
  archivedView?: boolean;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
  onOpen: (item: Item) => void;
  onCreatorClick?: (email: string) => void;
  activeCreator?: string | null;
  onTagClick?: (tag: string) => void;
  activeTags?: string[];
  tagSuggestions?: string[];
  onTagsChange?: (id: string, tags: string[]) => void;
  onItemChange: (item: Item) => void;
  /** When set, render these Area groups instead of the status sections. */
  areaGroups?: { key: string; items: Item[] }[];
  /** When set, render one flat, draggable list (ordered by position). */
  flatItems?: Item[];
}) {
  const rowProps = {
    onPatch,
    archivedView,
    onArchive,
    onRestore,
    onPurge,
    onOpen,
    onCreatorClick,
    activeCreator,
    onTagClick,
    activeTags,
    tagSuggestions,
    onTagsChange,
    onItemChange,
  };

  // Flat, draggable single list (the "Flat" grouping) — drag reorders the
  // global position shared with the board.
  if (flatItems) {
    return <DraggableRows items={flatItems} {...rowProps} />;
  }

  // Either the status sections (default) or the Area groups. Each section is
  // independently sortable (drag reorders within the group), except in the
  // archived view.
  const sections = areaGroups
    ? areaGroups.map((g) => ({ title: g.key, items: g.items }))
    : ITEM_STATUSES.map((s) => ({ title: STATUS_LABEL[s], items: grouped[s] }));

  return (
    <div className="space-y-8">
      {sections.map((section) => (
        <section key={section.title}>
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
            {section.title}{" "}
            <span className="ml-1 text-[var(--color-faint)]">
              {section.items.length}
            </span>
          </h2>
          <DraggableRows
            items={section.items}
            sortable={!archivedView}
            {...rowProps}
          />
        </section>
      ))}
    </div>
  );
}

/**
 * A position-ordered list of rows. Sortable by default (drag a grip to reorder,
 * editing the global position via computePosition); pass sortable={false} for a
 * plain, non-draggable list (e.g. the archived view).
 */
function DraggableRows({
  items,
  sortable = true,
  ...rowProps
}: { items: Item[]; sortable?: boolean } & RowProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((it) => it.id === active.id);
    const newIndex = items.findIndex((it) => it.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(items, oldIndex, newIndex);
    const pos = reordered.findIndex((it) => it.id === active.id);
    const position = computePosition(
      reordered[pos - 1]?.position,
      reordered[pos + 1]?.position,
    );
    void rowProps.onPatch(String(active.id), { position });
  }

  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-[var(--color-line)] px-3 py-4 text-sm text-[var(--color-faint)]">
        Nothing here.
      </p>
    );
  }

  if (!sortable) {
    return (
      <ul className="divide-y divide-[var(--color-line)] rounded-md border border-[var(--color-line)] bg-[var(--color-surface)]">
        {items.map((it) => (
          <ItemRow key={it.id} item={it} {...rowProps} />
        ))}
      </ul>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={items.map((it) => it.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="divide-y divide-[var(--color-line)] rounded-md border border-[var(--color-line)] bg-[var(--color-surface)]">
          {items.map((it) => (
            <SortableItemRow key={it.id} item={it} {...rowProps} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableItemRow({ item, ...rowProps }: { item: Item } & RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  return (
    <ItemRow
      item={item}
      {...rowProps}
      sortable={{
        setNodeRef,
        style: { transform: CSS.Transform.toString(transform), transition },
        handleProps: { ...attributes, ...listeners },
        isDragging,
      }}
    />
  );
}

function ItemRow({
  item,
  sortable,
  onPatch,
  archivedView,
  onArchive,
  onRestore,
  onPurge,
  onOpen,
  onCreatorClick,
  activeCreator,
  onTagClick,
  activeTags,
  tagSuggestions,
  onTagsChange,
  onItemChange,
}: { item: Item; sortable?: SortableBits } & RowProps) {
  const text = richDocText(item.body);

  return (
    <li
      ref={sortable?.setNodeRef}
      style={sortable?.style}
      className={`group flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-start sm:gap-3 ${
        sortable?.isDragging ? "opacity-50" : ""
      }`}
    >
      {/* Lead "status line": on small screens this is its own row above the
          content; at sm+ the wrapper becomes `display:contents` so the grip,
          status, and ref flow into the row as fixed-width columns exactly as
          before. */}
      <div className="flex items-center gap-3 sm:contents">
        {sortable ? (
          <button
            type="button"
            {...sortable.handleProps}
            aria-label="Drag to reorder"
            title="Drag to reorder"
            className="shrink-0 cursor-grab touch-none text-[var(--color-faint)] transition-colors hover:text-[var(--color-muted)] active:cursor-grabbing sm:mt-1"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="9" cy="6" r="1.4" />
              <circle cx="15" cy="6" r="1.4" />
              <circle cx="9" cy="12" r="1.4" />
              <circle cx="15" cy="12" r="1.4" />
              <circle cx="9" cy="18" r="1.4" />
              <circle cx="15" cy="18" r="1.4" />
            </svg>
          </button>
        ) : null}
        {/* Fixed-width columns so the ref and content line up across every row,
            regardless of the status label's width. */}
        <div className="w-[5.5rem] shrink-0">
          <StatusMenu
            value={item.status}
            onChange={(s) => void onPatch(item.id, { status: s })}
          />
        </div>
        <div className="w-16 shrink-0">
          <RefBadge number={item.number} className="sm:mt-1.5" />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <ClampedText
          text={text}
          onOpen={() => onOpen(item)}
          clamp={item.status === "done"}
          className="block w-full whitespace-pre-wrap break-words text-left text-sm leading-6"
        />
        {/* Area is the leftmost property in a fixed-width column (single colour,
            not per-tag varying), then — a decent gap later — tags, then
            assignees, so those line up across rows. */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
          <div className="w-60 shrink-0">
            <ItemCategory item={item} />
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <InlineTags
              tags={item.tags}
              suggestions={tagSuggestions ?? []}
              onChange={(tags) => onTagsChange?.(item.id, tags)}
              onTagClick={onTagClick}
              activeTags={activeTags}
            />
            <ItemAssignees item={item} />
          </div>
        </div>
        <Byline
          createdBy={item.created_by}
          updatedBy={item.updated_by}
          updatedAt={item.updated_at}
          onCreatorClick={onCreatorClick}
          activeCreator={activeCreator}
          className="mt-1 block"
        />
      </div>
      {/* Trailing controls: their own row below the content on small screens;
          `display:contents` at sm+ lets them flow back into the row as before. */}
      <div className="flex items-center gap-3 sm:contents">
        <EditButton
          onClick={() => onOpen(item)}
          label={text || "item"}
          className="self-center sm:mt-0.5"
        />
        <InlineAttachments item={item} onItemChange={onItemChange} />
        <TypeMenu
          value={item.type}
          onChange={(t) => void onPatch(item.id, { type: t })}
        />
        {archivedView ? (
          <div className="flex shrink-0 items-center gap-3 self-center text-xs">
            <button
              type="button"
              onClick={() => onRestore(item.id)}
              className="text-[var(--color-muted)] transition-colors hover:text-[var(--color-accent)]"
              aria-label={`Restore ${text || "item"}`}
            >
              Restore
            </button>
            <button
              type="button"
              onClick={() => onPurge(item.id)}
              className="text-[var(--color-faint)] transition-colors hover:text-[var(--color-bug)]"
              aria-label={`Permanently delete ${text || "item"}`}
              title="Permanently delete — cannot be undone"
            >
              Delete forever
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => onArchive(item.id)}
            className="self-center text-xs text-[var(--color-faint)] transition-colors hover:text-[var(--color-bug)] sm:invisible sm:group-hover:visible"
            aria-label={`Delete ${text || "item"}`}
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

const STATUS_STYLES: Record<ItemStatus, string> = {
  new: "text-[var(--color-muted)] bg-[var(--color-canvas)] ring-[var(--color-line-strong)]",
  in_progress:
    "text-[var(--color-accent-ink)] bg-[var(--color-accent-soft)] ring-[var(--color-line-strong)]",
  blocked: "text-[var(--color-bug)] bg-[var(--color-bug-bg)] ring-[var(--color-bug-line)]",
  done: "text-[var(--color-feature)] bg-[var(--color-feature-bg)] ring-[var(--color-feature-line)]",
};

/** The status pill, styled per state — shared by the trigger and menu options. */
function StatusBadge({ status }: { status: ItemStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1 ring-inset ${STATUS_STYLES[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/**
 * Direct status picker for a list row: click (or focus + ↓) the pill to open a
 * floating listbox of all statuses and pick one — no more cycling through each
 * state. Keyboard-first per DESIGN.md: opens with the current status focused,
 * ↑/↓ move, Enter selects, Esc closes (Tab just leaves). The overlay floats and
 * does not push the row content.
 */
function StatusMenu({
  value,
  onChange,
}: {
  value: ItemStatus;
  onChange: (s: ItemStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // On open, focus the current status so ↑/↓ move from where you are.
  useEffect(() => {
    if (!open) return;
    const i = Math.max(0, ITEM_STATUSES.indexOf(value));
    optionRefs.current[i]?.focus();
  }, [open, value]);

  function moveFocus(delta: number) {
    const cur = optionRefs.current.findIndex((el) => el === document.activeElement);
    const start = cur < 0 ? ITEM_STATUSES.indexOf(value) : cur;
    const next = (start + delta + ITEM_STATUSES.length) % ITEM_STATUSES.length;
    optionRefs.current[next]?.focus();
  }

  function pick(s: ItemStatus) {
    if (s !== value) onChange(s);
    setOpen(false);
    btnRef.current?.focus();
  }

  return (
    <div
      className="relative mt-0.5"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setOpen(false);
          btnRef.current?.focus();
        } else if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
          e.preventDefault();
          moveFocus(e.key === "ArrowDown" ? 1 : -1);
        }
      }}
      // Close when focus leaves the whole control (e.g. Tab away or click off).
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Change status"
        className="inline-flex items-center gap-1 rounded"
      >
        <StatusBadge status={value} />
        <svg
          className="h-3 w-3 shrink-0 text-[var(--color-faint)]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div
          role="listbox"
          className="absolute left-0 z-10 mt-1 flex w-36 flex-col gap-0.5 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-sm"
        >
          {ITEM_STATUSES.map((s, i) => (
            <button
              key={s}
              ref={(el) => {
                optionRefs.current[i] = el;
              }}
              type="button"
              role="option"
              aria-selected={s === value}
              onClick={() => pick(s)}
              className="flex items-center justify-between rounded px-2 py-1 text-left hover:bg-[var(--color-canvas)] focus:bg-[var(--color-canvas)] focus:outline-none"
            >
              <StatusBadge status={s} />
              {s === value ? (
                <svg
                  className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M5 13l4 4L19 7" />
                </svg>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
