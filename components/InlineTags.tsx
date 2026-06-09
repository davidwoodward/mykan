"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { Tag } from "@/components/Tag";
import { normalizeTags } from "@/lib/types";

/**
 * Inline tag chips with direct add/remove, used on list rows and board cards —
 * no modal. Clicking a chip toggles the filter; its ✕ removes the tag from the
 * item; "+ tag" opens a small autocompleting input.
 */
export function InlineTags({
  tags,
  suggestions,
  onChange,
  onTagClick,
  activeTags,
}: {
  tags: string[];
  suggestions: string[];
  onChange: (tags: string[]) => void;
  onTagClick?: (tag: string) => void;
  activeTags?: string[];
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const listId = useId();

  function commit() {
    const [t] = normalizeTags([draft]);
    setDraft("");
    setAdding(false);
    if (!t || tags.includes(t)) return;
    onChange([...tags, t]);
  }
  function remove(t: string) {
    onChange(tags.filter((x) => x !== t));
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      setDraft("");
      setAdding(false);
    }
  }

  // When the item has no tags, stay collapsed and only reveal "+ tag" on hover
  // so untagged rows don't carry an empty gap.
  const showAlways = tags.length > 0 || adding;

  return (
    <div
      className={`mt-1.5 flex-wrap items-center gap-1 ${
        showAlways ? "flex" : "hidden group-hover:flex"
      }`}
    >
      {tags.map((t) => (
        <Tag
          key={t}
          label={t}
          onClick={onTagClick ? () => onTagClick(t) : undefined}
          active={activeTags?.includes(t)}
          onRemove={() => remove(t)}
        />
      ))}
      {adding ? (
        <>
          <input
            autoFocus
            list={listId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={commit}
            placeholder="tag…"
            aria-label="Add tag"
            className="h-5 w-20 rounded border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-1.5 text-xs outline-none focus:border-[var(--color-accent)]"
          />
          <datalist id={listId}>
            {suggestions
              .filter((s) => !tags.includes(s))
              .map((s) => (
                <option key={s} value={s} />
              ))}
          </datalist>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label="Add tag"
          className="rounded-full border border-dashed border-[var(--color-line-strong)] px-1.5 py-0.5 text-xs text-[var(--color-faint)] transition-colors hover:border-[var(--color-ink)] hover:text-[var(--color-ink)]"
        >
          + tag
        </button>
      )}
    </div>
  );
}
