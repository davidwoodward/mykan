"use client";

import {
  useImperativeHandle,
  useState,
  type KeyboardEvent,
  type Ref,
} from "react";
import { Tag } from "@/components/Tag";
import { normalizeTags } from "@/lib/types";

export type TagEditorHandle = {
  /**
   * Commit any uncommitted draft text into a tag and return the resulting
   * list. Lets a parent submitting a form pull in a tag the user typed but
   * never confirmed with Enter, without waiting for the onChange state update.
   */
  flush: () => string[];
};

/**
 * Chip-input tag editor for the item modal. Type + Enter (or comma) to add,
 * Backspace on an empty field removes the last, ✕ removes a specific one.
 * Suggests existing project tags so the vocabulary stays consistent.
 */
export function TagEditor({
  value,
  suggestions,
  onChange,
  ref,
}: {
  value: string[];
  suggestions: string[];
  onChange: (tags: string[]) => void;
  ref?: Ref<TagEditorHandle>;
}) {
  const [draft, setDraft] = useState("");

  // Commit `raw` into the tag list and return the resulting array, so callers
  // that need the value synchronously don't have to wait for the onChange
  // state update to flush.
  function commit(raw: string): string[] {
    const [t] = normalizeTags([raw]);
    setDraft("");
    if (!t || value.includes(t)) return value;
    const next = [...value, t];
    onChange(next);
    return next;
  }
  function add(raw: string) {
    commit(raw);
  }

  useImperativeHandle(ref, () => ({ flush: () => commit(draft) }), [draft, value]);

  function remove(t: string) {
    onChange(value.filter((x) => x !== t));
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      remove(value[value.length - 1]);
    }
  }

  // Only suggest once the user has typed — never dump the whole vocabulary,
  // which could be hundreds of tags.
  const q = draft.trim().toLowerCase();
  const matches = q
    ? suggestions.filter((s) => !value.includes(s) && s.includes(q))
    : [];
  const remaining = matches.slice(0, 8);
  const moreCount = matches.length - remaining.length;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((t) => (
          <Tag key={t} label={t} onRemove={() => remove(t)} />
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => commit(draft)}
          placeholder={value.length ? "Add tag…" : "Add tags…"}
          aria-label="Add tag"
          className="min-w-24 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--color-faint)]"
        />
      </div>
      {remaining.length ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {remaining.map((s) => (
            <Tag key={s} label={s} onClick={() => add(s)} className="opacity-70 hover:opacity-100" />
          ))}
          {moreCount > 0 ? (
            <span className="text-xs text-[var(--color-faint)]">
              +{moreCount} more — keep typing
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
