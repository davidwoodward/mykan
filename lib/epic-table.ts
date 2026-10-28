// The epic table the epic_table MCP tool returns: the epic on top, its children
// beneath in the epic's own order, as aligned plain-text columns in a code
// block. Pure — no database — so `node --test` can load it directly.

/** One row's source: a card's ref, type, status and title. */
export type EpicTableRow = { ref: string; type: string; status: string; name: string };

/** A child row plus when it entered Done (ISO), which only orders it. */
export type EpicTableChild = EpicTableRow & { done_at?: string | null };

/**
 * Status groups, top to bottom: done first, then work under way (testing, in
 * progress, blocked), then not started. Unknown statuses sort last.
 */
const GROUP_ORDER = ["done", "testing", "in_progress", "blocked", "new"];
const groupRank = (status: string) => {
  const i = GROUP_ORDER.indexOf(status);
  return i === -1 ? GROUP_ORDER.length : i;
};

/**
 * The table's child order: done cards first, oldest completion first (a done
 * card with no recorded time goes after the dated ones), then testing, in
 * progress, blocked and new. Ties keep the order given — the epic's own child
 * order. Returns a sorted copy.
 */
export function orderEpicChildren<T extends EpicTableChild>(children: readonly T[]): T[] {
  return children
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const g = groupRank(a.c.status) - groupRank(b.c.status);
      if (g) return g;
      if (a.c.status === "done") {
        const ta = a.c.done_at ? Date.parse(a.c.done_at) : Infinity;
        const tb = b.c.done_at ? Date.parse(b.c.done_at) : Infinity;
        if (ta !== tb) return ta < tb ? -1 : 1;
      }
      return a.i - b.i;
    })
    .map(({ c }) => c);
}

const HEADERS = ["#", "Card", "Type", "Status", "Note"] as const;

/**
 * Render the table. The epic row leaves `#` blank; children are numbered 1..n
 * in the order given (callers sort with `orderEpicChildren` first). The Note
 * is the card's title, the first line of its description. The last column is
 * not padded, so lines carry no trailing spaces.
 */
export function formatEpicTable(epic: EpicTableRow, children: readonly EpicTableChild[]): string {
  const cells = (r: EpicTableRow, n: string) => [n, r.ref, r.type, r.status, oneLine(r.name)];
  return formatTextTable(HEADERS, [
    cells(epic, ""),
    ...children.map((c, i) => cells(c, String(i + 1))),
  ]);
}

/**
 * Aligned plain-text columns in a code block, shared by epic_table and
 * list_epics. Each column is at least 2 wide; the last column is not padded,
 * so lines carry no trailing spaces.
 */
export function formatTextTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const widths = headers.map((h, col) =>
    Math.max(h.length, 2, ...rows.map((r) => r[col].length)),
  );
  const line = (r: readonly string[]) =>
    r
      .map((c, col) => (col === r.length - 1 ? c : c.padEnd(widths[col])))
      .join("  ")
      .trimEnd();
  const rule = widths.map((w) => "-".repeat(w));
  return ["```", line(headers), line(rule), ...rows.map(line), "```"].join("\n");
}

/** A title is one line already; collapse any stray whitespace so it stays one. */
export function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
