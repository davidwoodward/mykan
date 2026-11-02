// The tag table the tag_table MCP tool returns (KANBAN-69): every non-archived
// card carrying one tag, as the same aligned plain-text columns epic_table
// prints. Pure — no database — so `node --test` can load it directly.
import { cardCells, formatTextTable, orderEpicChildren, type EpicTableChild } from "./epic-table.ts";

const HEADERS = ["#", "Card", "Type", "Status", "Note"] as const;

/**
 * Render the cards tagged `tag`, numbered 1..n: done first, oldest completion
 * first, then testing, in progress, blocked and new. Within a group cards keep
 * the order given (callers pass project, then board order). Note is the card's
 * title, cut to fit `width` when given. No cards says so instead of a bare header.
 */
export function formatTagTable(
  tag: string,
  cards: readonly EpicTableChild[],
  width?: number,
): string {
  if (cards.length === 0) return `No cards tagged ${tag}.`;
  return formatTextTable(
    HEADERS,
    orderEpicChildren(cards).map((c, i) => cardCells(c, String(i + 1))),
    width,
  );
}
