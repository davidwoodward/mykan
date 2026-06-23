"use client";

import {
  DndContext,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TypeBadge } from "@/components/TypeBadge";
import { Byline } from "@/components/Byline";
import { InlineTags } from "@/components/InlineTags";
import { InlineAttachments } from "@/components/InlineAttachments";
import { ClampedText } from "@/components/ClampedText";
import { RefBadge } from "@/components/RefBadge";
import { ItemAssignees } from "@/components/AssigneePicker";
import { ItemCategory } from "@/components/CategoryPicker";
import { computePosition } from "@/lib/position";
import {
  ITEM_STATUSES,
  STATUS_LABEL,
  richDocText,
  type Item,
  type ItemStatus,
} from "@/lib/types";

// Resolve the drop target by POINTER position, not by the dragged card's rect.
// closestCorners ranks droppables by the wide card's corner distances, so a card
// straddling the column gutter snaps to the source column's container (status
// unchanged, appended to the bottom). pointerWithin makes the column/card under
// the cursor win; rectIntersection is a fallback for the rare gutter drop where
// the pointer is over no droppable.
const collisionDetection: CollisionDetection = (args) => {
  const pointer = pointerWithin(args);
  return pointer.length > 0 ? pointer : rectIntersection(args);
};

type PatchFn = (
  id: string,
  patch: Partial<Pick<Item, "name" | "type" | "status" | "position">>,
) => Promise<void>;

type TagProps = {
  onTagClick?: (tag: string) => void;
  activeTags?: string[];
  tagSuggestions?: string[];
  onTagsChange?: (id: string, tags: string[]) => void;
  onItemChange: (item: Item) => void;
  archivedView?: boolean;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
};

export function Board({
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
}: {
  grouped: Record<ItemStatus, Item[]>;
  onPatch: PatchFn;
  onOpen: (item: Item) => void;
  onCreatorClick?: (email: string) => void;
  activeCreator?: string | null;
} & TagProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;

    const activeStatus = active.data.current?.status as ItemStatus | undefined;
    const overStatus = (over.data.current?.status ?? over.id) as ItemStatus;
    if (!activeStatus || !ITEM_STATUSES.includes(overStatus)) return;

    const targetItems = grouped[overStatus].filter((it) => it.id !== active.id);

    // Drop on a column container (over.id === status string) appends to the end.
    let insertIndex = targetItems.length;
    if (over.id !== overStatus) {
      const i = targetItems.findIndex((it) => it.id === over.id);
      insertIndex = i < 0 ? targetItems.length : i;
    }

    const before = targetItems[insertIndex - 1];
    const after = targetItems[insertIndex];
    const position = computePosition(before?.position, after?.position);

    const patch: Partial<Pick<Item, "status" | "position">> = { position };
    if (activeStatus !== overStatus) patch.status = overStatus;

    void onPatch(String(active.id), patch);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
        {ITEM_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            items={grouped[status]}
            archivedView={archivedView}
            onArchive={onArchive}
            onRestore={onRestore}
            onPurge={onPurge}
            onOpen={onOpen}
            onCreatorClick={onCreatorClick}
            activeCreator={activeCreator}
            onTagClick={onTagClick}
            activeTags={activeTags}
            tagSuggestions={tagSuggestions}
            onTagsChange={onTagsChange}
            onItemChange={onItemChange}
          />
        ))}
      </div>
    </DndContext>
  );
}

function Column({
  status,
  items,
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
}: {
  status: ItemStatus;
  items: Item[];
  onOpen: (item: Item) => void;
  onCreatorClick?: (email: string) => void;
  activeCreator?: string | null;
} & TagProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status, data: { status } });

  return (
    <section
      ref={setNodeRef}
      className={`flex flex-col rounded-lg border bg-[var(--color-surface)] transition-colors ${
        isOver
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
          : "border-[var(--color-line)]"
      }`}
    >
      <header className="flex items-baseline justify-between border-b border-[var(--color-line)] px-3 py-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]">
          {STATUS_LABEL[status]}
        </h2>
        <span className="text-xs text-[var(--color-faint)]">{items.length}</span>
      </header>
      <SortableContext
        items={items.map((it) => it.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className="flex min-h-24 flex-col gap-2 p-2">
          {items.map((it) => (
            <Card
              key={it.id}
              item={it}
              archivedView={archivedView}
              onArchive={onArchive}
              onRestore={onRestore}
              onPurge={onPurge}
              onOpen={onOpen}
              onCreatorClick={onCreatorClick}
              activeCreator={activeCreator}
              onTagClick={onTagClick}
              activeTags={activeTags}
              tagSuggestions={tagSuggestions}
              onTagsChange={onTagsChange}
              onItemChange={onItemChange}
            />
          ))}
          {items.length === 0 ? (
            <li className="grid place-items-center py-6 text-xs text-[var(--color-faint)]">
              Drop here
            </li>
          ) : null}
        </ul>
      </SortableContext>
    </section>
  );
}

function Card({
  item,
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
}: {
  item: Item;
  onOpen: (item: Item) => void;
  onCreatorClick?: (email: string) => void;
  activeCreator?: string | null;
} & TagProps) {
  const text = richDocText(item.body);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id, data: { status: item.status } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`group rounded-md border border-[var(--color-line)] bg-[var(--color-canvas)] p-2.5 text-sm shadow-[0_1px_0_var(--color-line)] ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      {/* Drag handle doubles as the open trigger: a stationary click opens the
          editor, movement past the activation distance starts a drag. */}
      <ClampedText
        text={text}
        onOpen={() => onOpen(item)}
        clamp={item.status === "done"}
        dragProps={{ ...attributes, ...listeners }}
        className="cursor-pointer whitespace-pre-wrap break-words leading-5 transition-colors hover:text-[var(--color-accent)] active:cursor-grabbing"
      />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <InlineTags
          tags={item.tags}
          suggestions={tagSuggestions ?? []}
          onChange={(tags) => onTagsChange?.(item.id, tags)}
          onTagClick={onTagClick}
          activeTags={activeTags}
        />
        <ItemAssignees item={item} />
        <ItemCategory item={item} />
      </div>
      <Byline
        createdBy={item.created_by}
        updatedBy={item.updated_by}
        updatedAt={item.updated_at}
        onCreatorClick={onCreatorClick}
        activeCreator={activeCreator}
        className="mt-1.5 block"
      />
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RefBadge number={item.number} />
          <TypeBadge type={item.type} />
          <InlineAttachments item={item} onItemChange={onItemChange} />
        </div>
        {archivedView ? (
          <div className="flex items-center gap-3 text-xs">
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
            className="invisible text-xs text-[var(--color-faint)] transition-colors hover:text-[var(--color-bug)] group-hover:visible"
            aria-label={`Delete ${text || "item"}`}
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}

