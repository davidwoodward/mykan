// The epic list the list_epics MCP tool returns (KANBAN-67): every non-archived
// epic in a project, one row each, as aligned plain-text columns in a code
// block (the same rendering as epic_table). Pure — no database — so
// `node --test` can load it directly.
import { sortByStatusThenNumber } from "./epic-order.ts";
import { formatTextTable, oneLine } from "./epic-table.ts";
import type { ItemStatus } from "./types.ts";

/** The fields list_epics reads from each of a project's items. */
export type EpicListSource = {
  ref: string;
  number: number;
  type: string;
  status: ItemStatus;
  name: string;
  /** The ref of the epic this item belongs to, or null. */
  parent: string | null;
};

const HEADERS = ["#", "Epic", "Status", "Done", "Note"] as const;

/**
 * Render the project's epics, numbered 1..n in board column order (new, in
 * progress, blocked, testing, done), then by card number. Done reads "N/M":
 * done children over all non-archived children, counted from the same items.
 * Note is the epic's title. An empty project says so instead of a bare header.
 */
export function formatEpicList(items: readonly EpicListSource[]): string {
  const epics = sortByStatusThenNumber(items.filter((it) => it.type === "epic"));
  if (epics.length === 0) return "No epics in this project.";
  const counts = new Map<string, { done: number; total: number }>();
  for (const it of items) {
    if (!it.parent) continue;
    const c = counts.get(it.parent) ?? { done: 0, total: 0 };
    c.total += 1;
    if (it.status === "done") c.done += 1;
    counts.set(it.parent, c);
  }
  return formatTextTable(
    HEADERS,
    epics.map((e, i) => {
      const c = counts.get(e.ref) ?? { done: 0, total: 0 };
      return [String(i + 1), e.ref, e.status, `${c.done}/${c.total}`, oneLine(e.name)];
    }),
  );
}
