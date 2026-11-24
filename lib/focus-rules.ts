// The focus list's rules (KANBAN-74): settings validation, the hard cap, when a
// review is due and why, staleness, the personal project's key, and the text
// rendering MCP's get_focus and the SessionStart hook print. Pure (no database,
// no server-only), so `node --test` loads it directly.

export type FocusSettings = {
  enabled: boolean;
  min_entries: number;
  max_entries: number;
  stale_days: number;
  review_hour: number;
  time_zone: string;
  personal_project_id: string | null;
  last_reviewed_at: string | null;
};

export const DEFAULT_FOCUS_SETTINGS: FocusSettings = {
  enabled: false,
  min_entries: 2,
  max_entries: 7,
  stale_days: 7,
  review_hour: 8,
  time_zone: "UTC",
  personal_project_id: null,
  last_reviewed_at: null,
};

/** One active entry as the list shows it, with live state from its card. */
export type FocusEntryView = {
  id: string;
  item_id: string;
  position: number;
  /**
   * The entry's own title on the focus list (KANBAN-82): seeded from the card's
   * title when pushed, rewritable without touching the card. Null → the card's
   * current title. Show `entryTitle(e)`.
   */
  label: string | null;
  why_now: string | null;
  target_date: string | null;
  added_at: string;
  /** False when the card is in a project the person can no longer see. */
  visible: boolean;
  ref: string | null;
  url: string | null;
  title: string | null;
  type: string | null;
  status: string | null;
  project_key: string | null;
  /** True for a card in the person's own hidden personal project. */
  personal: boolean;
  /** Epic progress, null for a non-epic. */
  progress: { done: number; total: number } | null;
  open_questions: number;
  /** Newest updated_at across the card and, for an epic, its children. */
  last_moved_at: string | null;
  stale: boolean;
};

/** What the list shows for an entry: its own title, else the card's. */
export function entryTitle(e: Pick<FocusEntryView, "label" | "title">): string | null {
  return e.label ?? e.title;
}

const TYPE_LETTER: Record<string, string> = { feature: "F", epic: "E", task: "T", bug: "B", idea: "I" };

/**
 * The one-letter type column of a compact focus row (KANBAN-85): F feature,
 * E epic, T task, B bug, I idea ("Thought"). Blank for a personal entry, and
 * for a card the person can no longer see.
 */
export function typeLetter(e: Pick<FocusEntryView, "type" | "personal" | "visible">): string {
  if (e.personal || !e.visible || !e.type) return "";
  return TYPE_LETTER[e.type] ?? "";
}

/**
 * The status a focus row shows, or null for none (KANBAN-86): a personal
 * entry shows no status, because nothing in the app can change it; the tick
 * is how it finishes.
 */
export function entryStatus(e: Pick<FocusEntryView, "status" | "personal">): string | null {
  return e.personal ? null : e.status;
}

/** A finished or dropped entry, for history and for "completed" reasons. */
export type FocusHistoryEntry = {
  id: string;
  item_id: string;
  ref: string | null;
  url: string | null;
  title: string | null;
  label: string | null;
  added_at: string;
  completed_at: string | null;
  removed_at: string | null;
};

export type ReviewReason =
  | { kind: "completed"; ref: string | null; title: string | null }
  | { kind: "short"; count: number; min: number }
  | { kind: "daily" }
  | { kind: "stale"; ref: string | null; title: string | null; days: number };

// ── Settings ─────────────────────────────────────────────────────────────────

const INT_FIELDS = {
  min_entries: [0, 49],
  max_entries: [1, 50],
  stale_days: [1, 365],
  review_hour: [0, 23],
} as const;

export type SettingsPatch = Partial<
  Pick<FocusSettings, "enabled" | "min_entries" | "max_entries" | "stale_days" | "review_hour" | "time_zone">
>;

/** A valid IANA time zone name (what Intl accepts). */
export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz.trim() || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check a settings change against the current settings. Unknown fields are
 * ignored; a bad value is an error naming the field. min must stay below max
 * after the change.
 */
export function validateSettingsPatch(
  current: FocusSettings,
  raw: Record<string, unknown>,
): { ok: true; patch: SettingsPatch } | { ok: false; error: string } {
  const patch: SettingsPatch = {};
  if ("enabled" in raw) {
    if (typeof raw.enabled !== "boolean") return { ok: false, error: "enabled must be true or false" };
    patch.enabled = raw.enabled;
  }
  for (const [field, [lo, hi]] of Object.entries(INT_FIELDS) as [keyof typeof INT_FIELDS, readonly [number, number]][]) {
    if (!(field in raw)) continue;
    const v = raw[field];
    if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) {
      return { ok: false, error: `${field} must be a whole number from ${lo} to ${hi}` };
    }
    patch[field] = v;
  }
  if ("time_zone" in raw) {
    if (!isTimeZone(raw.time_zone)) return { ok: false, error: "time_zone must be an IANA time zone, e.g. America/Los_Angeles" };
    patch.time_zone = raw.time_zone;
  }
  const min = patch.min_entries ?? current.min_entries;
  const max = patch.max_entries ?? current.max_entries;
  if (min >= max) return { ok: false, error: "The minimum must be below the maximum" };
  return { ok: true, patch };
}

// ── The hard cap ─────────────────────────────────────────────────────────────

/** Why one more entry can't be added, or null when there's room. */
export function capError(activeCount: number, max: number): string | null {
  return activeCount >= max
    ? `Your focus list is full (${activeCount} of ${max}). Drop an entry before adding another.`
    : null;
}

// ── Time ─────────────────────────────────────────────────────────────────────

/** Minutes the zone is ahead of UTC at `at`. */
function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** The person's local calendar date and hour at `at`. */
function localParts(at: Date, timeZone: string): { y: number; m: number; d: number; h: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") };
}

/**
 * When the current daily review window opened: the most recent local
 * `reviewHour`:00 in `timeZone` at or before `now`. A review on or after it
 * counts for today.
 */
export function dailyWindowStart(now: Date, reviewHour: number, timeZone: string): Date {
  const tz = isTimeZone(timeZone) ? timeZone : "UTC";
  const { y, m, d, h } = localParts(now, tz);
  const dayShift = h >= reviewHour ? 0 : -1;
  const localAsUtc = Date.UTC(y, m - 1, d + dayShift, reviewHour, 0, 0);
  const guess = new Date(localAsUtc - zoneOffsetMinutes(new Date(localAsUtc), tz) * 60000);
  // Correct once for a DST change between the guess and the real instant.
  return new Date(localAsUtc - zoneOffsetMinutes(guess, tz) * 60000);
}

const DAY_MS = 86_400_000;

/** Whole days since `iso` (0 when unknown or in the future). */
export function daysSince(iso: string | null, now: Date): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / DAY_MS)) : 0;
}

/** A card is stale when nothing on it (or its epic's cards) moved for staleDays. */
export function isStale(lastMovedAt: string | null, staleDays: number, now: Date): boolean {
  return lastMovedAt !== null && daysSince(lastMovedAt, now) >= staleDays;
}

/** The newest of a set of ISO timestamps, or null. */
export function newest(times: readonly (string | null | undefined)[]): string | null {
  let best: string | null = null;
  let bestT = -Infinity;
  for (const s of times) {
    if (!s) continue;
    const t = Date.parse(s);
    if (Number.isFinite(t) && t > bestT) {
      bestT = t;
      best = s;
    }
  }
  return best;
}

// ── Review ───────────────────────────────────────────────────────────────────

/**
 * Whether a review is due and why. Pure and side-effect free: reading the list
 * never changes it. Any change to the list or an explicit confirm sets
 * last_reviewed_at, which clears every reason until one of these happens:
 *
 *  - completed: an entry completed after the last review (one reason each);
 *  - daily: the day's review window (review_hour in time_zone) opened after the
 *    last review, or there has never been one;
 *  - short: the list is at or below min_entries, raised with a completion or
 *    the daily review (a standing condition, so not on its own, or confirming
 *    a short list could never clear it);
 *  - stale: each entry whose card hasn't moved in stale_days, raised with the
 *    daily review for the same reason.
 */
export function reviewReasons(input: {
  settings: Pick<FocusSettings, "min_entries" | "review_hour" | "time_zone" | "last_reviewed_at">;
  active: readonly Pick<FocusEntryView, "ref" | "title" | "label" | "stale" | "last_moved_at">[];
  history: readonly Pick<FocusHistoryEntry, "ref" | "title" | "label" | "completed_at">[];
  now: Date;
}): ReviewReason[] {
  const { settings, active, history, now } = input;
  const last = settings.last_reviewed_at ? Date.parse(settings.last_reviewed_at) : null;
  const after = (iso: string | null) => iso !== null && (last === null || Date.parse(iso) > last);

  const reasons: ReviewReason[] = [];
  for (const h of history) {
    if (after(h.completed_at)) reasons.push({ kind: "completed", ref: h.ref, title: entryTitle(h) });
  }
  const windowStart = dailyWindowStart(now, settings.review_hour, settings.time_zone).getTime();
  const daily = last === null || last < windowStart;
  if (daily) reasons.push({ kind: "daily" });
  if ((daily || reasons.length > 0) && active.length <= settings.min_entries) {
    reasons.push({ kind: "short", count: active.length, min: settings.min_entries });
  }
  if (daily) {
    for (const e of active) {
      if (e.stale) reasons.push({ kind: "stale", ref: e.ref, title: entryTitle(e), days: daysSince(e.last_moved_at, now) });
    }
  }
  return reasons;
}

/** One reason as a short phrase, e.g. "PS-12 done", "2 entries left". */
export function describeReason(r: ReviewReason): string {
  switch (r.kind) {
    case "completed":
      return `${r.ref ?? "a card"} done`;
    case "short":
      return `${r.count} ${r.count === 1 ? "entry" : "entries"} left`;
    case "daily":
      return "daily review";
    case "stale":
      return `${r.ref ?? "a card"} idle ${r.days}d`;
  }
}

// ── Personal project ─────────────────────────────────────────────────────────

/** Keys to try, in order, for a person's personal project: ME, ME2 … ME99. */
export function personalKeyCandidates(): string[] {
  return ["ME", ...Array.from({ length: 98 }, (_, i) => `ME${i + 2}`)];
}

export const PERSONAL_PROJECT_NAME = "Personal";

/**
 * Projects for display: everything visible except personal projects, which are
 * hidden by design (KANBAN-75) and reached only through the focus list. Lookups
 * (resolveProject, loadVisibleItem, card pages) still see them.
 */
export function displayProjects<T extends { is_personal?: boolean | null }>(projects: T[]): T[] {
  return projects.filter((p) => !p.is_personal);
}

// ── Text rendering (MCP get_focus, the SessionStart hook) ────────────────────

export const FOCUS_OFF_MESSAGE =
  "The focus list is off for you. Turn it on in mykan: profile menu (top right) → Settings → Focus list.";

function cut(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, Math.max(1, max - 1)).join("").trimEnd() + "…";
}

/** "3d", "today" — a compact age for the Moved column. */
export function ageLabel(iso: string | null, now: Date): string {
  if (!iso) return "-";
  const d = daysSince(iso, now);
  return d === 0 ? "today" : `${d}d`;
}

/**
 * The list as aligned plain text in a code block, preceded by a one-line
 * header and, when a review is due, a "Review due" line naming the reasons.
 * Columns: #, T (type letter), Card, Status, Done, Moved, Note (the title,
 * then "· why now"). A personal entry's T and Status are blank.
 * With `width`, the Note column is cut so no line is longer.
 */
export function formatFocusText(
  view: {
    entries: readonly FocusEntryView[];
    max_entries: number;
    reasons: readonly ReviewReason[];
  },
  now: Date,
  width?: number,
): string {
  const head = `Focus list (${view.entries.length} of ${view.max_entries})`;
  const lines = [head];
  if (view.reasons.length) lines.push(`Review due: ${view.reasons.map(describeReason).join(" · ")}`);
  if (!view.entries.length) {
    lines.push("Your focus list is empty. Add the cards that matter most right now.");
    return lines.join("\n");
  }
  const headers = ["#", "T", "Card", "Status", "Done", "Moved", "Note"];
  const rows = view.entries.map((e, i) => {
    if (!e.visible) return [String(i + 1), "", "(no access)", "-", "-", "-", "You can no longer see this card"];
    const note = [entryTitle(e) ?? "", e.why_now ? `· ${e.why_now}` : ""].filter(Boolean).join(" ");
    return [
      String(i + 1),
      typeLetter(e),
      e.ref ?? "-",
      e.personal ? "" : (e.status ?? "-"),
      e.progress ? `${e.progress.done}/${e.progress.total}` : "-",
      (e.stale ? "!" : "") + ageLabel(e.last_moved_at, now),
      note.replace(/\s+/g, " ").trim(),
    ];
  });
  const last = headers.length - 1;
  const widths = headers.map((h, c) => Math.max(h.length, c === 1 ? 1 : 2, ...rows.map((r) => Array.from(r[c]).length)));
  if (width !== undefined) {
    const before = widths.slice(0, last).reduce((s, w) => s + w + 2, 0);
    widths[last] = Math.min(widths[last], Math.max(4, width - before));
  }
  const line = (r: readonly string[]) =>
    r.map((c, col) => (col === last ? cut(c, widths[last]) : c.padEnd(widths[col]))).join("  ").trimEnd();
  lines.push("```", line(headers), line(widths.map((w) => "-".repeat(w))), ...rows.map(line), "```");
  return lines.join("\n");
}
