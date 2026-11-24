import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { coreErr, coreOk, listProjects, type CoreResult } from "@/lib/projects-core";
import { createItem, loadVisibleItem, refOf, urlOf } from "@/lib/items-core";
import { projectKeyWriteError } from "@/lib/project-keys";
import { epicProgress, richDocTitle, type Item, type ItemStatus, type Project } from "@/lib/types";
import { computePosition } from "@/lib/position";
import {
  DEFAULT_FOCUS_SETTINGS,
  FOCUS_OFF_MESSAGE,
  PERSONAL_PROJECT_NAME,
  capError,
  isStale,
  newest,
  personalKeyCandidates,
  reviewReasons,
  validateSettingsPatch,
  type FocusEntryView,
  type FocusHistoryEntry,
  type FocusSettings,
  type ReviewReason,
} from "@/lib/focus-rules";

// The focus list (KANBAN-74). Owner-only: the service role bypasses RLS, so
// EVERY query here filters by the acting user's email (`actor`). Nothing takes
// another person's email, and no read joins from a card back to entries.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HISTORY_LIMIT = 30;

type EntryRow = {
  id: string;
  user_email: string;
  item_id: string;
  position: number;
  label: string | null;
  why_now: string | null;
  target_date: string | null;
  added_at: string;
  completed_at: string | null;
  removed_at: string | null;
};

export type FocusView =
  | { enabled: false; message: string; settings: FocusSettings }
  | {
      enabled: true;
      settings: FocusSettings;
      entries: FocusEntryView[];
      history: FocusHistoryEntry[];
      reasons: ReviewReason[];
      review_due: boolean;
    };

// ── Settings ─────────────────────────────────────────────────────────────────

export async function getFocusSettings(
  sb: SupabaseClient,
  actor: string,
): Promise<CoreResult<FocusSettings>> {
  const { data, error } = await sb
    .from("focus_settings")
    .select("enabled, min_entries, max_entries, stale_days, review_hour, time_zone, personal_project_id, last_reviewed_at")
    .eq("user_email", actor)
    .maybeSingle();
  if (error) return coreErr(error.message, 500);
  return coreOk({ ...DEFAULT_FOCUS_SETTINGS, ...((data as Partial<FocusSettings> | null) ?? {}) });
}

/**
 * Change the caller's settings. Turning the list on creates the hidden
 * personal project the first time (idempotent). Turning it off keeps every
 * entry and setting, so turning it back on restores the list as it was.
 */
export async function updateFocusSettings(
  sb: SupabaseClient,
  actor: string,
  raw: Record<string, unknown>,
): Promise<CoreResult<FocusSettings>> {
  const cur = await getFocusSettings(sb, actor);
  if (!cur.ok) return cur;
  const v = validateSettingsPatch(cur.data, raw);
  if (!v.ok) return coreErr(v.error, 400);
  const { error } = await sb
    .from("focus_settings")
    .upsert({ user_email: actor, ...v.patch, updated_at: new Date().toISOString() }, { onConflict: "user_email" });
  if (error) return coreErr(error.message, 500);
  const next = { ...cur.data, ...v.patch };
  if (next.enabled) {
    const p = await ensurePersonalProject(sb, actor, next);
    if (!p.ok) return p;
    next.personal_project_id = p.data;
  }
  return coreOk(next);
}

/**
 * The caller's personal project id, creating it if needed: private, owned by
 * the caller, flagged is_personal, named "Personal" with the first free key of
 * ME, ME2, ... A partial unique index allows one per person, so a concurrent
 * second create fails and the existing one is read back instead.
 */
export async function ensurePersonalProject(
  sb: SupabaseClient,
  actor: string,
  settings: FocusSettings,
): Promise<CoreResult<string>> {
  const existing = async (): Promise<string | null> => {
    const { data } = await sb
      .from("projects")
      .select("id")
      .eq("created_by", actor)
      .eq("is_personal", true)
      .maybeSingle();
    return (data as { id: string } | null)?.id ?? null;
  };
  const record = async (id: string) => {
    if (settings.personal_project_id === id) return;
    await sb.from("focus_settings").update({ personal_project_id: id }).eq("user_email", actor);
  };

  const found = await existing();
  if (found) {
    await record(found);
    return coreOk(found);
  }
  for (const key of personalKeyCandidates()) {
    if (await projectKeyWriteError(sb, key)) continue;
    const { data, error } = await sb
      .from("projects")
      .insert({
        name: PERSONAL_PROJECT_NAME,
        description: "Your private focus-list cards. Only you can see this project.",
        key,
        created_by: actor,
        updated_by: actor,
        shared_with: [],
        is_private: true,
        is_personal: true,
      })
      .select("id")
      .single();
    if (!error) {
      const id = (data as { id: string }).id;
      await record(id);
      return coreOk(id);
    }
    if (error.code === "23505" && error.message.includes("personal")) {
      const again = await existing();
      if (again) {
        await record(again);
        return coreOk(again);
      }
    }
    if (error.code !== "23505") return coreErr(error.message, 500);
    // Another project took this key between the check and the insert: next key.
  }
  return coreErr("Couldn't find a free key for your personal project", 500);
}

const markReviewed = (sb: SupabaseClient, actor: string) =>
  sb.from("focus_settings").update({ last_reviewed_at: new Date().toISOString() }).eq("user_email", actor);

// ── Reading the list ─────────────────────────────────────────────────────────

type ItemRow = Pick<Item, "id" | "project_id" | "number" | "body" | "type" | "status" | "updated_at"> & {
  archived_at: string | null;
};

/**
 * The caller's focus list with live state from each card, recent history, and
 * the review reasons. Side-effect free. Off → `enabled: false` and a message.
 */
export async function loadFocus(
  sb: SupabaseClient,
  actor: string,
  now: Date = new Date(),
): Promise<CoreResult<FocusView>> {
  const s = await getFocusSettings(sb, actor);
  if (!s.ok) return s;
  const settings = s.data;
  if (!settings.enabled) return coreOk({ enabled: false, message: FOCUS_OFF_MESSAGE, settings });

  const [activeRes, historyRes, projectsRes] = await Promise.all([
    sb
      .from("focus_entries")
      .select("*")
      .eq("user_email", actor)
      .is("completed_at", null)
      .is("removed_at", null)
      .order("position", { ascending: true }),
    sb
      .from("focus_entries")
      .select("*")
      .eq("user_email", actor)
      .or("completed_at.not.is.null,removed_at.not.is.null")
      .order("added_at", { ascending: false })
      .limit(200),
    listProjects(sb, actor),
  ]);
  if (activeRes.error) return coreErr(activeRes.error.message, 500);
  if (historyRes.error) return coreErr(historyRes.error.message, 500);
  if (!projectsRes.ok) return projectsRes;

  const active = (activeRes.data ?? []) as EntryRow[];
  const ended = ((historyRes.data ?? []) as EntryRow[])
    .sort((a, b) => endedAt(b).localeCompare(endedAt(a)))
    .slice(0, HISTORY_LIMIT);
  const itemIds = [...new Set([...active, ...ended].map((e) => e.item_id))];

  const visibleProjects = new Map<string, Project>(projectsRes.data.map((p) => [p.id, p]));
  const items = new Map<string, ItemRow>();
  const children = new Map<string, { status: ItemStatus; updated_at: string; archived_at: string | null }[]>();
  const openQuestions = new Map<string, number>();

  if (itemIds.length) {
    const { data, error } = await sb
      .from("items")
      .select("id, project_id, number, body, type, status, updated_at, archived_at")
      .in("id", itemIds);
    if (error) return coreErr(error.message, 500);
    // Only cards in a project the caller can still see are described; the rest
    // render as "no access", never with their title.
    for (const it of (data ?? []) as ItemRow[]) {
      if (visibleProjects.has(it.project_id)) items.set(it.id, it);
    }
    const visibleIds = [...items.keys()];
    const epicIds = [...items.values()].filter((i) => i.type === "epic").map((i) => i.id);
    const [kidsRes, qRes] = await Promise.all([
      epicIds.length
        ? sb.from("items").select("parent_id, status, updated_at, archived_at").in("parent_id", epicIds)
        : Promise.resolve({ data: [], error: null }),
      visibleIds.length
        ? sb
            .from("item_entries")
            .select("item_id")
            .in("item_id", visibleIds)
            .eq("kind", "question")
            .eq("state", "open")
            .is("deleted_at", null)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (kidsRes.error) return coreErr(kidsRes.error.message, 500);
    if (qRes.error) return coreErr(qRes.error.message, 500);
    for (const k of (kidsRes.data ?? []) as { parent_id: string; status: ItemStatus; updated_at: string; archived_at: string | null }[]) {
      const list = children.get(k.parent_id) ?? [];
      list.push(k);
      children.set(k.parent_id, list);
    }
    for (const q of (qRes.data ?? []) as { item_id: string }[]) {
      openQuestions.set(q.item_id, (openQuestions.get(q.item_id) ?? 0) + 1);
    }
  }

  const describe = (itemId: string) => {
    const it = items.get(itemId);
    if (!it) return null;
    const p = visibleProjects.get(it.project_id)!;
    return {
      it,
      project: p,
      ref: refOf(p.key, it.number),
      url: urlOf(p.key, it.number),
      title: richDocTitle(it.body),
    };
  };

  const entries: FocusEntryView[] = active.map((e) => {
    const d = describe(e.item_id);
    const base = {
      id: e.id,
      item_id: e.item_id,
      position: e.position,
      label: e.label,
      why_now: e.why_now,
      target_date: e.target_date,
      added_at: e.added_at,
    };
    if (!d) {
      return {
        ...base,
        visible: false,
        ref: null,
        url: null,
        title: null,
        type: null,
        status: null,
        project_key: null,
        personal: false,
        progress: null,
        open_questions: 0,
        last_moved_at: null,
        stale: false,
      };
    }
    const kids = d.it.type === "epic" ? children.get(d.it.id) ?? [] : null;
    const lastMoved = newest([d.it.updated_at, ...(kids ?? []).map((k) => k.updated_at)]);
    return {
      ...base,
      visible: true,
      ref: d.ref,
      url: d.url,
      title: d.title,
      type: d.it.type,
      status: d.it.status,
      project_key: d.project.key,
      personal: d.project.id === settings.personal_project_id,
      progress: kids ? epicProgress(kids) : null,
      open_questions: openQuestions.get(d.it.id) ?? 0,
      last_moved_at: lastMoved,
      stale: d.it.status !== "done" && isStale(lastMoved, settings.stale_days, now),
    };
  });

  const history: FocusHistoryEntry[] = ended.map((e) => {
    const d = describe(e.item_id);
    return {
      id: e.id,
      item_id: e.item_id,
      ref: d?.ref ?? null,
      url: d?.url ?? null,
      title: d?.title ?? null,
      label: e.label,
      added_at: e.added_at,
      completed_at: e.completed_at,
      removed_at: e.removed_at,
    };
  });

  const reasons = reviewReasons({ settings, active: entries, history, now });
  return coreOk({ enabled: true, settings, entries, history, reasons, review_due: reasons.length > 0 });
}

const endedAt = (e: EntryRow) => e.completed_at ?? e.removed_at ?? e.added_at;

// ── Changing the list ────────────────────────────────────────────────────────

async function requireEnabled(sb: SupabaseClient, actor: string): Promise<CoreResult<FocusSettings>> {
  const s = await getFocusSettings(sb, actor);
  if (!s.ok) return s;
  if (!s.data.enabled) return coreErr(FOCUS_OFF_MESSAGE, 409);
  return s;
}

async function activeEntries(sb: SupabaseClient, actor: string): Promise<CoreResult<EntryRow[]>> {
  const { data, error } = await sb
    .from("focus_entries")
    .select("*")
    .eq("user_email", actor)
    .is("completed_at", null)
    .is("removed_at", null)
    .order("position", { ascending: true });
  if (error) return coreErr(error.message, 500);
  return coreOk((data ?? []) as EntryRow[]);
}

export type AddFocusInput = {
  /** An existing card: KEY-N reference or id. */
  item?: string;
  /** Quick-add: a one-line title; creates a card in the personal project. */
  text?: string;
  /** 1-based rank to insert at; default the end. */
  position?: number;
  /** The entry's own title; default the card's title at the time it's added. */
  label?: string | null;
  why_now?: string | null;
  target_date?: string | null;
};

function cleanWhyNow(v: unknown): CoreResult<string | null> {
  if (v === undefined || v === null) return coreOk(null);
  if (typeof v !== "string") return coreErr("why_now must be text", 400);
  const t = v.replace(/\s+/g, " ").trim();
  if (t.length > 200) return coreErr("why_now is one line, up to 200 characters", 400);
  return coreOk(t || null);
}

function cleanLabel(v: unknown): CoreResult<string | null> {
  if (v === undefined || v === null) return coreOk(null);
  if (typeof v !== "string") return coreErr("label must be text", 400);
  const t = v.replace(/\s+/g, " ").trim();
  if (t.length > 200) return coreErr("A focus title is one line, up to 200 characters", 400);
  return coreOk(t || null);
}

function cleanDate(v: unknown): CoreResult<string | null> {
  if (v === undefined || v === null || v === "") return coreOk(null);
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v))) {
    return coreErr("target_date must be a date like 2026-12-01", 400);
  }
  return coreOk(v);
}

/** The position for a new entry at 1-based `rank` among `rows` (ordered). */
function positionAt(rows: EntryRow[], rank?: number): number {
  const at = rank === undefined ? rows.length : Math.min(Math.max(Math.trunc(rank) - 1, 0), rows.length);
  return computePosition(rows[at - 1]?.position, rows[at]?.position);
}

/**
 * Add a card to the caller's list. The hard cap is checked FIRST, so a refused
 * quick-add never leaves an orphan card behind. Counts as a review.
 */
export async function addFocusEntry(
  sb: SupabaseClient,
  actor: string,
  input: AddFocusInput,
): Promise<CoreResult<{ entry_id: string; ref: string }>> {
  const s = await requireEnabled(sb, actor);
  if (!s.ok) return s;
  const why = cleanWhyNow(input.why_now);
  if (!why.ok) return why;
  const date = cleanDate(input.target_date);
  if (!date.ok) return date;
  const lbl = cleanLabel(input.label);
  if (!lbl.ok) return lbl;
  let label = lbl.data;
  const item = input.item?.trim();
  const text = input.text?.replace(/\s+/g, " ").trim();
  if (!item === !text) return coreErr("Give either a card (KEY-N) or text for a new card, not both", 400);

  const rows = await activeEntries(sb, actor);
  if (!rows.ok) return rows;
  const full = capError(rows.data.length, s.data.max_entries);
  if (full) return coreErr(full, 409);

  let itemId: string;
  let ref: string;
  if (item) {
    const it = await loadVisibleItem(sb, actor, item);
    if (!it.ok) return it;
    if (rows.data.some((r) => r.item_id === it.data.item.id)) {
      return coreErr(`${refOf(it.data.project.key, it.data.item.number)} is already on your focus list`, 409);
    }
    itemId = it.data.item.id;
    ref = refOf(it.data.project.key, it.data.item.number);
    // Pushed from a card: the entry starts with the card's title as its own,
    // so rewriting it later never touches the card (KANBAN-82).
    label ??= richDocTitle(it.data.item.body) || null;
  } else {
    if (text!.length > 200) return coreErr("A quick-add is one line, up to 200 characters", 400);
    const pid = await ensurePersonalProject(sb, actor, s.data);
    if (!pid.ok) return pid;
    const created = await createItem(sb, actor, pid.data, { name: text, type: "task" });
    if (!created.ok) return created;
    itemId = created.data.id;
    const { data: proj } = await sb.from("projects").select("key").eq("id", pid.data).maybeSingle();
    ref = refOf((proj as { key: string | null } | null)?.key ?? null, created.data.number);
  }

  const { data, error } = await sb
    .from("focus_entries")
    .insert({
      user_email: actor,
      item_id: itemId,
      position: positionAt(rows.data, input.position),
      label,
      why_now: why.data,
      target_date: date.data,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return coreErr(`${ref} is already on your focus list`, 409);
    return coreErr(error.message, 500);
  }
  await markReviewed(sb, actor);
  return coreOk({ entry_id: (data as { id: string }).id, ref });
}

/**
 * The caller's ACTIVE entry named by `ref`: an entry id, or a card's KEY-N
 * reference / id. Never another person's entry.
 */
async function findActiveEntry(
  sb: SupabaseClient,
  actor: string,
  ref: string,
): Promise<CoreResult<EntryRow>> {
  const rows = await activeEntries(sb, actor);
  if (!rows.ok) return rows;
  const r = ref.trim();
  if (UUID_RE.test(r)) {
    const byEntry = rows.data.find((e) => e.id === r);
    if (byEntry) return coreOk(byEntry);
  }
  const it = await loadVisibleItem(sb, actor, r);
  if (it.ok) {
    const byItem = rows.data.find((e) => e.item_id === it.data.item.id);
    if (byItem) return coreOk(byItem);
  }
  return coreErr(`Not on your focus list: ${r}`, 404);
}

/** Put the caller's active entries in this order (entry ids or card refs). Counts as a review. */
export async function setFocusOrder(
  sb: SupabaseClient,
  actor: string,
  refs: string[],
): Promise<CoreResult<{ ordered: number }>> {
  const s = await requireEnabled(sb, actor);
  if (!s.ok) return s;
  const rows = await activeEntries(sb, actor);
  if (!rows.ok) return rows;
  const picked: EntryRow[] = [];
  for (const ref of refs) {
    const e = await findActiveEntry(sb, actor, ref);
    if (!e.ok) return e;
    if (picked.some((p) => p.id === e.data.id)) return coreErr(`Listed twice: ${ref}`, 400);
    picked.push(e.data);
  }
  // Listed entries first in the given order, then any left out, in their order.
  const rest = rows.data.filter((r) => !picked.some((p) => p.id === r.id));
  const order = [...picked, ...rest];
  for (let i = 0; i < order.length; i++) {
    const position = (i + 1) * 1024;
    if (order[i].position === position) continue;
    const { error } = await sb
      .from("focus_entries")
      .update({ position })
      .eq("id", order[i].id)
      .eq("user_email", actor);
    if (error) return coreErr(error.message, 500);
  }
  await markReviewed(sb, actor);
  return coreOk({ ordered: order.length });
}

/** Take an entry off the list (the card is untouched). Counts as a review. */
export async function dropFocusEntry(
  sb: SupabaseClient,
  actor: string,
  ref: string,
): Promise<CoreResult<{ dropped: string }>> {
  const s = await requireEnabled(sb, actor);
  if (!s.ok) return s;
  const e = await findActiveEntry(sb, actor, ref);
  if (!e.ok) return e;
  const { error } = await sb
    .from("focus_entries")
    .update({ removed_at: new Date().toISOString() })
    .eq("id", e.data.id)
    .eq("user_email", actor);
  if (error) return coreErr(error.message, 500);
  await markReviewed(sb, actor);
  return coreOk({ dropped: e.data.id });
}

/**
 * Tick an entry off by hand (the card's status is untouched). Deliberately NOT
 * a review: completing an entry is one of the things that raises one.
 */
export async function completeFocusEntry(
  sb: SupabaseClient,
  actor: string,
  ref: string,
): Promise<CoreResult<{ completed: string }>> {
  const s = await requireEnabled(sb, actor);
  if (!s.ok) return s;
  const e = await findActiveEntry(sb, actor, ref);
  if (!e.ok) return e;
  const { error } = await sb
    .from("focus_entries")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", e.data.id)
    .eq("user_email", actor);
  if (error) return coreErr(error.message, 500);
  return coreOk({ completed: e.data.id });
}

/** Edit an entry's why-now line or target date. Counts as a review. */
export async function updateFocusEntry(
  sb: SupabaseClient,
  actor: string,
  ref: string,
  patch: { label?: unknown; why_now?: unknown; target_date?: unknown },
): Promise<CoreResult<{ updated: string }>> {
  const s = await requireEnabled(sb, actor);
  if (!s.ok) return s;
  const e = await findActiveEntry(sb, actor, ref);
  if (!e.ok) return e;
  const row: Record<string, unknown> = {};
  if ("label" in patch) {
    const l = cleanLabel(patch.label);
    if (!l.ok) return l;
    row.label = l.data; // empty → null → the card's current title
  }
  if ("why_now" in patch) {
    const w = cleanWhyNow(patch.why_now);
    if (!w.ok) return w;
    row.why_now = w.data;
  }
  if ("target_date" in patch) {
    const d = cleanDate(patch.target_date);
    if (!d.ok) return d;
    row.target_date = d.data;
  }
  if (Object.keys(row).length) {
    const { error } = await sb.from("focus_entries").update(row).eq("id", e.data.id).eq("user_email", actor);
    if (error) return coreErr(error.message, 500);
  }
  await markReviewed(sb, actor);
  return coreOk({ updated: e.data.id });
}

/** "I've looked, it stands": clears the review until the next trigger. */
export async function confirmFocusReview(
  sb: SupabaseClient,
  actor: string,
): Promise<CoreResult<{ reviewed_at: string }>> {
  const s = await requireEnabled(sb, actor);
  if (!s.ok) return s;
  const at = new Date().toISOString();
  const { error } = await sb.from("focus_settings").update({ last_reviewed_at: at }).eq("user_email", actor);
  if (error) return coreErr(error.message, 500);
  return coreOk({ reviewed_at: at });
}

/**
 * Cards the caller can add, for the web picker: every non-archived card in a
 * project they can see, with its ref and title. The picker filters locally.
 */
export async function focusCandidates(
  sb: SupabaseClient,
  actor: string,
): Promise<CoreResult<{ item_id: string; ref: string; title: string; type: string; status: string; project: string }[]>> {
  const projects = await listProjects(sb, actor);
  if (!projects.ok) return projects;
  if (!projects.data.length) return coreOk([]);
  const byId = new Map(projects.data.map((p) => [p.id, p]));
  const { data, error } = await sb
    .from("items")
    .select("id, project_id, number, body, type, status")
    .in("project_id", [...byId.keys()])
    .is("archived_at", null)
    .order("updated_at", { ascending: false });
  if (error) return coreErr(error.message, 500);
  return coreOk(
    ((data ?? []) as Pick<Item, "id" | "project_id" | "number" | "body" | "type" | "status">[]).map((it) => {
      const p = byId.get(it.project_id)!;
      return {
        item_id: it.id,
        ref: refOf(p.key, it.number),
        title: richDocTitle(it.body),
        type: it.type,
        status: it.status,
        project: p.is_personal ? "Personal" : p.name,
      };
    }),
  );
}


/**
 * For the card page (KANBAN-82): whether the caller's focus list is on and, if
 * so, whether this card is on it. Off → `null`, so the page renders nothing
 * focus-related at all.
 */
export async function focusStateForItem(
  sb: SupabaseClient,
  actor: string,
  itemId: string,
): Promise<{ onList: boolean } | null> {
  const s = await getFocusSettings(sb, actor);
  if (!s.ok || !s.data.enabled) return null;
  const { data } = await sb
    .from("focus_entries")
    .select("id")
    .eq("user_email", actor)
    .eq("item_id", itemId)
    .is("completed_at", null)
    .is("removed_at", null)
    .limit(1);
  return { onList: (data ?? []).length > 0 };
}
