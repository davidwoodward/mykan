"use client";

import { useState, type KeyboardEvent } from "react";
import { Tag } from "@/components/Tag";
import { normalizeTags } from "@/lib/types";

/**
 * Chip-input tag editor for the item modal. Type + Enter (or comma) to add,
 * Backspace on an empty field removes the last, ✕ removes a specific one.
 * Suggests existing project tags so the vocabulary stays consistent.
 */
export function TagEditor({
  value,
  suggestions,
  onChange,
}: {
  value: string[];
  suggestions: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const [t] = normalizeTags([raw]);
    setDraft("");
    if (!t || value.includes(t)) return;
    onChange([...value, t]);
  }
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
