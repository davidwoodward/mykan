// The epic table the epic_table MCP tool returns: the epic on top, its children
// beneath in the epic's own order, as aligned plain-text columns in a code
// block. Pure — no database — so `node --test` can load it directly.

/** One row's source: a card's ref, type, status and title. */
export type EpicTableRow = { ref: string; type: string; status: string; name: string };

const HEADERS = ["#", "Card", "Type", "Status", "Note"] as const;

/**
 * Render the table. The epic row leaves `#` blank; children are numbered 1..n
 * in the order given (the epic's child order — never re-sorted here). The Note
 * is the card's title, the first line of its description. The last column is
 * not padded, so lines carry no trailing spaces.
 */
export function formatEpicTable(epic: EpicTableRow, children: readonly EpicTableRow[]): string {
  const cells = (r: EpicTableRow, n: string) => [n, r.ref, r.type, r.status, oneLine(r.name)];
  const rows = [cells(epic, ""), ...children.map((c, i) => cells(c, String(i + 1)))];
  const widths = HEADERS.map((h, col) =>
    Math.max(h.length, 2, ...rows.map((r) => r[col].length)),
  );
  const line = (r: readonly string[]) =>
    r
      .map((c, col) => (col === r.length - 1 ? c : c.padEnd(widths[col])))
      .join("  ")
      .trimEnd();
  const rule = widths.map((w) => "-".repeat(w));
  return ["```", line(HEADERS), line(rule), ...rows.map(line), "```"].join("\n");
}

/** A title is one line already; collapse any stray whitespace so it stays one. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
