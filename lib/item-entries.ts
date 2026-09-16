import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { coreErr, coreOk, type CoreResult } from "@/lib/projects-core";
import { loadVisibleItem } from "@/lib/items-core";
import type { HistorySource } from "@/lib/item-history";
import type { Item, Project } from "@/lib/types";
import { summarizeEntries, type ItemEntrySummary } from "@/lib/mcp-entry-guards";
import {
  answerError,
  buildEntryListFilter,
  changedEntryFields,
  coalescesIntoLatest,
  createThenMark,
  deletePatch,
  editPatch,
  entrySnapshotOf,
  initialState,
  isRuleError,
  newEntryFields,
  normalizeEntryBody,
  restoreEntryPatch,
  resolveVisibleEntry,
  supersedeError,
  undeleteError,
  type EntryListInput,
  type EntryState,
  type ItemEntry,
  type ItemEntryVersion,
  type RuleError,
} from "@/lib/item-entries-rules";

/**
 * Item entries (KANBAN-36): progress, questions and decisions logged against
 * an item. Every write to an existing entry routes through
 * snapshotThenWriteEntry, the single chokepoint that records the entry's
 * PREVIOUS state in item_entry_versions before applying the change — the same
 * contract as snapshotThenWrite for items. No mutator may update item_entries
 * directly. There is no hard delete here: deleteEntry is a soft, versioned,
 * restorable delete. Visibility is the parent item's (loadVisibleItem).
 */

// Re-exported for server callers. Client components must import the pure rules
// from "@/lib/item-entries-rules" directly: this module is server-only.
export * from "@/lib/item-entries-rules";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Visible = { entry: ItemEntry; item: Item; project: Project };

const fromRule = (e: RuleError): CoreResult<never> => coreErr(e.error, e.status);

/** Database refusals of a rule (check/FK/unique) are the caller's fault. */
function dbErr(error: { message: string; code?: string }): CoreResult<never> {
  if (error.code === "23505") return coreErr("Another live entry already supersedes that entry", 409);
  const guard = error.code === "23514" || error.code === "23503";
  return coreErr(error.message, guard ? 400 : 500);
}

/** Load an entry the actor may see (its item's project is visible to them). */
export async function loadVisibleEntry(
  sb: SupabaseClient,
  actor: string,
  entryId: string,
): Promise<CoreResult<Visible>> {
  const id = String(entryId ?? "").trim();
  const r = await resolveVisibleEntry(id, {
    fetchEntry: async (eid) => {
      if (!UUID_RE.test(eid)) return null;
      const { data, error } = await sb
        .from("item_entries")
        .select("*")
        .eq("id", eid)
        .maybeSingle();
      if (error) return { error: error.message, status: 500 };
      return (data as ItemEntry | null) ?? null;
    },
    loadItem: async (itemId) => {
      const it = await loadVisibleItem(sb, actor, itemId);
      return it.ok ? it.data : { error: it.error, status: it.status };
    },
  });
  if (isRuleError(r)) return fromRule(r);
  return coreOk({ entry: r.entry, item: r.item.item, project: r.item.project });
}

/**
 * The entry write chokepoint: snapshot the entry's previous state (when a
 * tracked field changes), then apply the patch. Callers pass the freshly loaded
 * `current` row. Stamps updated_at/updated_by.
 *
 *  - no tracked field changes → nothing is written (no-op autosaves).
 *  - body-only change in the same editor session as the latest body-only
 *    version (same actor + source) → write only (coalesced).
 *  - otherwise insert a snapshot of the PREVIOUS state, then write.
 *
 * `guard` adds equality conditions to the update (e.g. the state the caller
 * validated against); if the row no longer matches, nothing changes and the
 * result is a 409. A refused write removes the snapshot it just recorded.
 */
export async function snapshotThenWriteEntry(
  sb: SupabaseClient,
  actor: string,
  current: ItemEntry,
  patch: Record<string, unknown>,
  source: HistorySource,
  editSession: string | null = null,
  guard: Partial<Pick<ItemEntry, "state">> = {},
): Promise<CoreResult<ItemEntry>> {
  const changed = changedEntryFields(current, patch);
  if (changed.length === 0) return coreOk(current);

  let versionId: string | null = null;
  const coalesce =
    editSession !== null &&
    coalescesIntoLatest(await latestVersion(sb, current.id), {
      actor,
      source,
      changed,
      editSession,
    });
  if (!coalesce) {
    const { data: vrow, error: verr } = await sb
      .from("item_entry_versions")
      .insert({
        entry_id: current.id,
        snapshot: entrySnapshotOf(current),
        fields_changed: changed,
        source,
        edit_session: editSession,
        created_by: actor,
      })
      .select("id")
      .single();
    if (verr) return coreErr(verr.message, 500);
    versionId = (vrow as { id: string } | null)?.id ?? null;
  }

  let q = sb
    .from("item_entries")
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: actor })
    .eq("id", current.id);
  for (const [k, v] of Object.entries(guard)) q = q.eq(k, v);
  const { data, error } = await q.select().maybeSingle();

  if (error || !data) {
    if (versionId) await sb.from("item_entry_versions").delete().eq("id", versionId);
    if (error) return dbErr(error);
    return coreErr("This entry changed since it was loaded; reload and try again", 409);
  }
  return coreOk(data as ItemEntry);
}

async function latestVersion(
  sb: SupabaseClient,
  entryId: string,
): Promise<Pick<ItemEntryVersion, "fields_changed" | "source" | "edit_session" | "created_by"> | null> {
  const { data } = await sb
    .from("item_entry_versions")
    .select("fields_changed, source, edit_session, created_by")
    .eq("entry_id", entryId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Pick<
    ItemEntryVersion,
    "fields_changed" | "source" | "edit_session" | "created_by"
  > | null) ?? null;
}

/** Does a live (not deleted) entry supersede `entryId`, other than `exceptId`? */
async function hasLiveSuccessor(
  sb: SupabaseClient,
  entryId: string,
  exceptId: string | null = null,
): Promise<boolean> {
  let q = sb
    .from("item_entries")
    .select("id")
    .eq("supersedes_id", entryId)
    .is("deleted_at", null);
  if (exceptId) q = q.neq("id", exceptId);
  const { data } = await q.limit(1);
  return (data ?? []).length > 0;
}

async function fetchEntry(sb: SupabaseClient, id: string): Promise<ItemEntry | null> {
  const { data } = await sb.from("item_entries").select("*").eq("id", id).maybeSingle();
  return (data as ItemEntry | null) ?? null;
}

async function insertEntry(
  sb: SupabaseClient,
  actor: string,
  row: {
    item_id: string;
    kind: ItemEntry["kind"];
    state: EntryState;
    body: string;
    supersedes_id?: string | null;
  },
  source: HistorySource,
): Promise<ItemEntry | RuleError> {
  const { data, error } = await sb
    .from("item_entries")
    .insert({ ...row, source, created_by: actor, updated_by: actor })
    .select()
    .single();
  if (error) {
    const r = dbErr(error);
    return r.ok ? { error: error.message, status: 500 } : { error: r.error, status: r.status };
  }
  return data as ItemEntry;
}

const toRule = <T>(r: CoreResult<T>): T | RuleError =>
  r.ok ? r.data : { error: r.error, status: r.status };

// ── Core functions ────────────────────────────────────────────────────────

/** Add a progress note, question or decision to an item. */
export async function addEntry(
  sb: SupabaseClient,
  actor: string,
  itemRef: string,
  input: { kind: unknown; body: unknown },
  source: HistorySource,
): Promise<CoreResult<ItemEntry>> {
  const fields = newEntryFields(input);
  if (isRuleError(fields)) return fromRule(fields);
  const r = await loadVisibleItem(sb, actor, itemRef);
  if (!r.ok) return r;
  const row = await insertEntry(sb, actor, { item_id: r.data.item.id, ...fields }, source);
  return isRuleError(row) ? fromRule(row) : coreOk(row);
}

/**
 * Edit an entry's body and/or state (versioned). `editSession` is the web
 * editor's per-open id: body autosaves within it collapse to one version.
 */
export async function editEntry(
  sb: SupabaseClient,
  actor: string,
  entryId: string,
  input: { body?: unknown; state?: unknown },
  source: HistorySource,
  editSession: string | null = null,
): Promise<CoreResult<ItemEntry>> {
  const v = await loadVisibleEntry(sb, actor, entryId);
  if (!v.ok) return v;
  const { entry } = v.data;
  const reinstating =
    entry.state === "superseded" && input.state !== undefined && input.state !== "superseded";
  const p = editPatch(entry, input, {
    hasLiveSuccessor: reinstating ? await hasLiveSuccessor(sb, entry.id) : false,
  });
  if (isRuleError(p)) return fromRule(p);
  const guard = "state" in p.patch ? { state: entry.state } : {};
  return snapshotThenWriteEntry(sb, actor, entry, p.patch, source, editSession, guard);
}

/**
 * Supersede a progress/decision entry with a new one of the same kind. The new
 * entry is created first (carrying supersedes_id), then the older one is marked
 * superseded (versioned). If marking fails the new entry is removed again.
 */
export async function supersedeEntry(
  sb: SupabaseClient,
  actor: string,
  entryId: string,
  input: { body: unknown },
  source: HistorySource,
): Promise<CoreResult<{ superseded: ItemEntry; entry: ItemEntry }>> {
  const body = normalizeEntryBody(input.body);
  if (!body) return coreErr("body text required", 400);
  const v = await loadVisibleEntry(sb, actor, entryId);
  if (!v.ok) return v;
  const older = v.data.entry;
  const e = supersedeError(older, { hasLiveSuccessor: await hasLiveSuccessor(sb, older.id) });
  if (e) return fromRule(e);

  const out = await createThenMark<ItemEntry, ItemEntry>({
    create: () =>
      insertEntry(
        sb,
        actor,
        {
          item_id: older.item_id,
          kind: older.kind,
          state: initialState(older.kind),
          body,
          supersedes_id: older.id,
        },
        source,
      ),
    mark: async () =>
      toRule(
        await snapshotThenWriteEntry(sb, actor, older, { state: "superseded" }, source, null, {
          state: older.state,
        }),
      ),
    undoCreate: async (created) => {
      // The row was created moments ago by this call and has no history.
      const { error } = await sb.from("item_entries").delete().eq("id", created.id);
      return error ? error.message : null;
    },
  });
  if (isRuleError(out)) return fromRule(out);
  return coreOk({ superseded: out.marked, entry: out.created as ItemEntry });
}

/**
 * Answer an open question with a decision: an existing one (`decisionId`) or a
 * new one created from `body`. The question becomes answered and links the
 * decision (versioned).
 */
export async function answerQuestion(
  sb: SupabaseClient,
  actor: string,
  questionId: string,
  input: { decisionId?: unknown; body?: unknown },
  source: HistorySource,
): Promise<CoreResult<{ question: ItemEntry; decision: ItemEntry }>> {
  const hasId = input.decisionId !== undefined && input.decisionId !== null;
  const body = input.body !== undefined ? normalizeEntryBody(input.body) : null;
  if (hasId === (input.body !== undefined)) {
    return coreErr("pass either decisionId or body", 400);
  }
  if (!hasId && !body) return coreErr("body text required", 400);

  const v = await loadVisibleEntry(sb, actor, questionId);
  if (!v.ok) return v;
  const question = v.data.entry;

  let decision: ItemEntry | null = null;
  if (hasId) {
    const id = String(input.decisionId);
    decision = UUID_RE.test(id) ? await fetchEntry(sb, id) : null;
    if (!decision) return coreErr(`Entry not found: ${id}`, 404);
  }
  const e = answerError(question, decision);
  if (e) return fromRule(e);

  const out = await createThenMark<ItemEntry, ItemEntry>({
    create: decision
      ? undefined
      : () =>
          insertEntry(
            sb,
            actor,
            { item_id: question.item_id, kind: "decision", state: "active", body: body as string },
            source,
          ),
    mark: async (created) =>
      toRule(
        await snapshotThenWriteEntry(
          sb,
          actor,
          question,
          { state: "answered", answered_by_id: (created ?? decision)!.id },
          source,
          null,
          { state: "open" },
        ),
      ),
    undoCreate: async (created) => {
      const { error } = await sb.from("item_entries").delete().eq("id", created.id);
      return error ? error.message : null;
    },
  });
  if (isRuleError(out)) return fromRule(out);
  return coreOk({ question: out.marked, decision: (out.created ?? decision)! });
}

/** Soft-delete an entry (versioned; undo with undeleteEntry or a restore). */
export async function deleteEntry(
  sb: SupabaseClient,
  actor: string,
  entryId: string,
  source: HistorySource,
): Promise<CoreResult<ItemEntry>> {
  const v = await loadVisibleEntry(sb, actor, entryId);
  if (!v.ok) return v;
  const p = deletePatch(v.data.entry, actor);
  if (isRuleError(p)) return fromRule(p);
  return snapshotThenWriteEntry(sb, actor, v.data.entry, p.patch, source);
}

/** Bring a soft-deleted entry back (versioned). */
export async function undeleteEntry(
  sb: SupabaseClient,
  actor: string,
  entryId: string,
  source: HistorySource,
): Promise<CoreResult<ItemEntry>> {
  const v = await loadVisibleEntry(sb, actor, entryId);
  if (!v.ok) return v;
  const { entry } = v.data;
  const e = undeleteError(entry, await successorContext(sb, entry));
  if (e) return fromRule(e);
  return snapshotThenWriteEntry(sb, actor, entry, { deleted_at: null, deleted_by: null }, source);
}

/** For an entry that supersedes another: the target's state and competition. */
async function successorContext(
  sb: SupabaseClient,
  entry: ItemEntry,
): Promise<{ target: Pick<ItemEntry, "state"> | null; targetHasOtherLiveSuccessor: boolean }> {
  if (!entry.supersedes_id) return { target: null, targetHasOtherLiveSuccessor: false };
  const [target, other] = await Promise.all([
    fetchEntry(sb, entry.supersedes_id),
    hasLiveSuccessor(sb, entry.supersedes_id, entry.id),
  ]);
  return { target, targetHasOtherLiveSuccessor: other };
}

/**
 * An item's entries, newest first, filtered by kind(s), state(s), created
 * after `since`, capped at `limit` (default 50, max 200). Soft-deleted entries
 * are left out unless `includeDeleted` is true.
 */
export async function listEntries(
  sb: SupabaseClient,
  actor: string,
  itemRef: string,
  input: EntryListInput = {},
): Promise<CoreResult<ItemEntry[]>> {
  const f = buildEntryListFilter(input);
  if (isRuleError(f)) return fromRule(f);
  const r = await loadVisibleItem(sb, actor, itemRef);
  if (!r.ok) return r;

  let q = sb.from("item_entries").select("*").eq("item_id", r.data.item.id);
  if (f.kinds) q = q.in("kind", f.kinds);
  if (f.states) q = q.in("state", f.states);
  if (f.since) q = q.gt("created_at", f.since);
  if (!f.includeDeleted) q = q.is("deleted_at", null);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(f.limit);
  if (error) return coreErr(error.message, 500);
  return coreOk((data ?? []) as ItemEntry[]);
}

/** An entry's versions, newest first. */
export async function listEntryVersions(
  sb: SupabaseClient,
  actor: string,
  entryId: string,
): Promise<CoreResult<ItemEntryVersion[]>> {
  const v = await loadVisibleEntry(sb, actor, entryId);
  if (!v.ok) return v;
  const { data, error } = await sb
    .from("item_entry_versions")
    .select("*")
    .eq("entry_id", v.data.entry.id)
    .order("created_at", { ascending: false });
  if (error) return coreErr(error.message, 500);
  return coreOk((data ?? []) as ItemEntryVersion[]);
}

/**
 * Restore a version as the entry's new state. Just another write through the
 * chokepoint, so the pre-restore state is versioned first and the restore is
 * itself reversible. Works on deleted entries (restoring a pre-delete version
 * brings the entry back).
 */
export async function restoreEntryVersion(
  sb: SupabaseClient,
  actor: string,
  entryId: string,
  versionId: string,
  source: HistorySource = "recovery",
): Promise<CoreResult<ItemEntry>> {
  const v = await loadVisibleEntry(sb, actor, entryId);
  if (!v.ok) return v;
  const current = v.data.entry;
  const vid = String(versionId ?? "").trim();
  const { data: vrow } = UUID_RE.test(vid)
    ? await sb
        .from("item_entry_versions")
        .select("*")
        .eq("id", vid)
        .eq("entry_id", current.id)
        .maybeSingle()
    : { data: null };
  if (!vrow) return coreErr("version not found", 404);
  const snap = (vrow as ItemEntryVersion).snapshot;

  let answeredByValid = false;
  if (current.kind === "question" && snap.answered_by_id) {
    const d = UUID_RE.test(snap.answered_by_id) ? await fetchEntry(sb, snap.answered_by_id) : null;
    answeredByValid = !!d && d.item_id === current.item_id && d.kind === "decision";
  }
  const reinstating = current.state === "superseded" && snap.state !== "superseded";
  const undeleting = !!current.deleted_at && !snap.deleted_at;
  const succ = undeleting
    ? await successorContext(sb, current)
    : { target: null, targetHasOtherLiveSuccessor: false };

  const p = restoreEntryPatch(snap, current, {
    answeredByValid,
    hasLiveSuccessor: reinstating ? await hasLiveSuccessor(sb, current.id) : false,
    ...succ,
  });
  if (isRuleError(p)) return fromRule(p);
  return snapshotThenWriteEntry(sb, actor, current, p.patch, source);
}

/**
 * The compact entry view for an item the caller has ALREADY checked is visible
 * (KANBAN-37, MCP get_item): active decisions, open questions, and a count of
 * non-deleted progress entries with the newest one's time. Progress rows are
 * counted, not fetched, so a long-running card stays cheap to read.
 */
export async function summarizeItemEntries(
  sb: SupabaseClient,
  itemId: string,
): Promise<CoreResult<ItemEntrySummary>> {
  const [open, count, latest] = await Promise.all([
    sb
      .from("item_entries")
      .select("id, kind, state, body, created_at, created_by, supersedes_id, deleted_at")
      .eq("item_id", itemId)
      .in("kind", ["decision", "question"])
      .in("state", ["active", "open"])
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    sb
      .from("item_entries")
      .select("id", { count: "exact", head: true })
      .eq("item_id", itemId)
      .eq("kind", "progress")
      .is("deleted_at", null),
    sb
      .from("item_entries")
      .select("created_at")
      .eq("item_id", itemId)
      .eq("kind", "progress")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const failed = open.error ?? count.error ?? latest.error;
  if (failed) return coreErr(failed.message, 500);
  return coreOk(
    summarizeEntries((open.data ?? []) as Parameters<typeof summarizeEntries>[0], {
      count: count.count ?? 0,
      last_at: (latest.data as { created_at: string } | null)?.created_at ?? null,
    }),
  );
}
