// Board view state in the URL (KANBAN-44). Opening a card is a real navigation
// to /KEY-N, so the board unmounts; its filters, grouping and search live in
// the board's query string so Back (or Esc on the card) lands on the same
// board. Scroll position is kept separately (sessionStorage), see
// components/boardReturn.ts. Pure, so it runs under `node --test`.
//
//   /FPOON?view=board&status=in_progress,blocked&tags=ui,mcp&area=coach/home&by=dawoodward@gmail.com&q=scroll
//
// Defaults are omitted, so an untouched board is plain /FPOON. No ids: the area
// filter is written as its path, which the board resolves back to a node once
// the areas load.

export const BOARD_STATUSES = ["new", "in_progress", "blocked", "testing", "done"] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];

export type BoardState = {
  view: "list" | "board";
  group: "status" | "area" | "flat";
  status: BoardStatus[];
  tags: string[];
  /** Area path in normalised form ("coach/home"), or null. */
  area: string | null;
  /** Creator email, or null. */
  by: string | null;
  q: string;
  archived: boolean;
};

export const DEFAULT_BOARD_STATE: BoardState = {
  view: "list",
  group: "status",
  status: [],
  tags: [],
  area: null,
  by: null,
  q: "",
  archived: false,
};

/** Area paths compare slash- and case-insensitively ("Coach / Home" = "coach/home"). */
export function normAreaPath(s: string): string {
  return s.toLowerCase().replace(/\s*\/\s*/g, "/").trim();
}

type ParamSource =
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

function getParam(src: ParamSource, name: string): string | null {
  if (src instanceof URLSearchParams) return src.get(name);
  const v = src[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

function list(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Read board state from a query string (URLSearchParams or Next's searchParams). */
export function boardStateFromParams(src: ParamSource): BoardState {
  const view = getParam(src, "view");
  const group = getParam(src, "group");
  const status = [
    ...new Set(
      list(getParam(src, "status")).filter((s): s is BoardStatus =>
        (BOARD_STATUSES as readonly string[]).includes(s),
      ),
    ),
  ];
  const tags = [...new Set(list(getParam(src, "tags")).map((t) => t.toLowerCase()))];
  const area = getParam(src, "area");
  const by = getParam(src, "by");
  return {
    view: view === "board" ? "board" : "list",
    group: group === "area" || group === "flat" ? group : "status",
    status,
    tags,
    area: area && area.trim() ? normAreaPath(area) : null,
    by: by && by.trim() ? by.trim().toLowerCase() : null,
    q: getParam(src, "q") ?? "",
    archived: getParam(src, "archived") === "1",
  };
}

/** Write board state as query params, defaults omitted (stable key order). */
export function boardStateToParams(state: BoardState): URLSearchParams {
  const p = new URLSearchParams();
  if (state.view !== "list") p.set("view", state.view);
  if (state.group !== "status") p.set("group", state.group);
  if (state.status.length) {
    // Board column order, so the same filter always reads the same.
    p.set("status", BOARD_STATUSES.filter((s) => state.status.includes(s)).join(","));
  }
  if (state.tags.length) p.set("tags", state.tags.join(","));
  if (state.area) p.set("area", normAreaPath(state.area));
  if (state.by) p.set("by", state.by);
  if (state.q) p.set("q", state.q);
  if (state.archived) p.set("archived", "1");
  return p;
}

/** "?view=board&..." or "" when every value is the default. */
export function boardSearch(state: BoardState): string {
  const s = boardStateToParams(state).toString();
  return s ? `?${s}` : "";
}
