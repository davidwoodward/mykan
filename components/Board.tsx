"use client";

import {
  DndContext,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
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
import { Tag } from "@/components/Tag";
import {
  ITEM_STATUSES,
  STATUS_LABEL,
  richDocText,
  type Item,
  type ItemStatus,
} from "@/lib/types";

type PatchFn = (
  id: string,
  patch: Partial<Pick<Item, "name" | "type" | "status" | "position">>,
) => Promise<void>;

type TagProps = {
  onTagClick?: (tag: string) => void;
  activeTags?: string[];
};

export function Board({
  grouped,
  onPatch,
  onDelete,
  onOpen,
  onCreatorClick,
  activeCreator,
  onTagClick,
  activeTags,
}: {
  grouped: Record<ItemStatus, Item[]>;
  onPatch: PatchFn;
  onDelete: (id: string) => Promise<void>;
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
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {ITEM_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            items={grouped[status]}
            onDelete={onDelete}
            onOpen={onOpen}
            onCreatorClick={onCreatorClick}
            activeCreator={activeCreator}
            onTagClick={onTagClick}
            activeTags={activeTags}
          />
        ))}
      </div>
    </DndContext>
  );
}

function Column({
  status,
  items,
  onDelete,
  onOpen,
  onCreatorClick,
  activeCreator,
  onTagClick,
  activeTags,
}: {
  status: ItemStatus;
  items: Item[];
  onDelete: (id: string) => Promise<void>;
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
              onDelete={onDelete}
              onOpen={onOpen}
              onCreatorClick={onCreatorClick}
              activeCreator={activeCreator}
              onTagClick={onTagClick}
              activeTags={activeTags}
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
  onDelete,
  onOpen,
  onCreatorClick,
  activeCreator,
  onTagClick,
  activeTags,
}: {
  item: Item;
  onDelete: (id: string) => Promise<void>;
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
      <div
        {...attributes}
        {...listeners}
        onClick={() => onOpen(item)}
        title="Open"
        className="cursor-pointer whitespace-pre-wrap break-words leading-5 transition-colors hover:text-[var(--color-accent)] active:cursor-grabbing"
      >
        {text || (
          <span className="italic text-[var(--color-accent)]">View content</span>
        )}
      </div>
      {item.tags.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.tags.map((t) => (
            <Tag
              key={t}
              label={t}
              onClick={onTagClick ? () => onTagClick(t) : undefined}
              active={activeTags?.includes(t)}
            />
          ))}
        </div>
      ) : null}
      <Byline
        createdBy={item.created_by}
        updatedBy={item.updated_by}
        updatedAt={item.updated_at}
        onCreatorClick={onCreatorClick}
        activeCreator={activeCreator}
        className="mt-1.5 block"
      />
      <div className="mt-2 flex items-center justify-between">
        <TypeBadge type={item.type} />
        <button
          type="button"
          onClick={() => void onDelete(item.id)}
          className="invisible text-xs text-[var(--color-faint)] transition-colors hover:text-[var(--color-bug)] group-hover:visible"
          aria-label={`Delete ${text || "item"}`}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function computePosition(before: number | undefined, after: number | undefined): number {
  if (before == null && after == null) return 1024;
  if (before == null) return (after as number) - 1024;
  if (after == null) return before + 1024;
  return (before + after) / 2;
}
