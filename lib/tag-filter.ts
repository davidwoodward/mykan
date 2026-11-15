// The board's tag filter (KANBAN-73): each tag is off, included or excluded. A
// card passes when it carries every included tag and none of the excluded ones
// (an untagged card passes any exclude). The two lists never share a tag. Pure,
// so it runs under `node --test`.

export type TagFilterState = "off" | "include" | "exclude";

export type TagFilter = { include: string[]; exclude: string[] };

export function tagStateOf(tag: string, f: TagFilter): TagFilterState {
  if (f.include.includes(tag)) return "include";
  if (f.exclude.includes(tag)) return "exclude";
  return "off";
}

/** The picker's cycle: off → include → exclude → off. */
export function cycleTag(tag: string, f: TagFilter): TagFilter {
  const state = tagStateOf(tag, f);
  if (state === "off") return { include: [...f.include, tag], exclude: f.exclude };
  if (state === "include") {
    return { include: f.include.filter((t) => t !== tag), exclude: [...f.exclude, tag] };
  }
  return { include: f.include, exclude: f.exclude.filter((t) => t !== tag) };
}

/** Put a tag straight into one state (the typeahead's "-tag" shortcut, the × on a chip). */
export function setTagState(tag: string, state: TagFilterState, f: TagFilter): TagFilter {
  const include = f.include.filter((t) => t !== tag);
  const exclude = f.exclude.filter((t) => t !== tag);
  if (state === "include") include.push(tag);
  if (state === "exclude") exclude.push(tag);
  return { include, exclude };
}

export function passesTagFilter(
  tags: readonly string[] | null | undefined,
  f: TagFilter,
): boolean {
  const have = tags ?? [];
  return f.include.every((t) => have.includes(t)) && !f.exclude.some((t) => have.includes(t));
}

/**
 * The typeahead query split into its text and whether it asks for an exclude:
 * a leading "-" (as in "-post") means "add this tag as an exclude".
 */
export function parseTagQuery(raw: string): { text: string; exclude: boolean } {
  const q = raw.trim().toLowerCase();
  if (q.startsWith("-")) return { text: q.slice(1).trim(), exclude: true };
  return { text: q, exclude: false };
}
