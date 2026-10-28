import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { coreErr, coreOk, type CoreResult } from "@/lib/projects-core";
import { loadVisibleItem, refOf } from "@/lib/items-core";
import {
  planEpicMove,
  planEpicOrder,
  type EpicMoveTarget,
  type EpicPlan,
  type EpicPositioned,
} from "@/lib/epic-order";
import type { Item, Project } from "@/lib/types";

/**
 * Reordering an epic's children (KANBAN-68). The plans are pure
 * (lib/epic-order.ts); this loads the children, resolves refs and writes
 * epic_position. epic_position is not a tracked field, so a reorder leaves no
 * history entry and no updated_at stamp, like a board drag's position.
 */

/** What a reorder did: the epic's ref and the done cards it skipped. */
export type EpicReorderResult = { epic: string; epicId: string; moved: number; skipped: string[] };

async function loadChildren(
  sb: SupabaseClient,
  epicId: string,
): Promise<CoreResult<EpicPositioned[]>> {
  const { data, error } = await sb
    .from("items")
    .select("id, number, status, epic_position")
    .eq("parent_id", epicId)
    .is("archived_at", null);
  if (error) return coreErr(error.message, 500);
  return coreOk((data ?? []) as EpicPositioned[]);
}

async function applyPlan(
  sb: SupabaseClient,
  project: Project,
  epic: Pick<Item, "id" | "number">,
  kids: EpicPositioned[],
  plan: EpicPlan,
): Promise<CoreResult<EpicReorderResult>> {
  if (!plan.ok) return coreErr(plan.error, 400);
  const results = await Promise.all(
    plan.writes.map((w) =>
      sb.from("items").update({ epic_position: w.epic_position }).eq("id", w.id),
    ),
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) return coreErr(failed.error.message, 500);
  const byId = new Map(kids.map((k) => [k.id, k]));
  return coreOk({
    epic: refOf(project.key, epic.number),
    epicId: epic.id,
    moved: plan.writes.length,
    skipped: plan.skipped.map((id) => refOf(project.key, byId.get(id)?.number ?? 0)),
  });
}

/**
 * Resolve a ref (id, KEY-N, or a bare number) to one of `kids`. A ref in the
 * project's current key is matched locally; anything else (an old key) goes
 * through loadVisibleItem.
 */
async function resolveChild(
  sb: SupabaseClient,
  actor: string,
  project: Project,
  kids: EpicPositioned[],
  ref: string,
): Promise<string | null> {
  const raw = ref.trim();
  const byId = kids.find((k) => k.id === raw);
  if (byId) return byId.id;
  const m = /^(?:([A-Za-z][A-Za-z0-9]*)-)?(\d+)$/.exec(raw);
  if (m && (!m[1] || m[1].toUpperCase() === project.key?.toUpperCase())) {
    return kids.find((k) => k.number === Number(m[2]))?.id ?? null;
  }
  const r = await loadVisibleItem(sb, actor, raw);
  if (!r.ok) return null;
  return kids.find((k) => k.id === r.data.item.id)?.id ?? null;
}

/**
 * Move one card within its epic's status group: before or after a sibling (an
 * id or KEY-N ref), or to the top or bottom of its group.
 */
export async function moveEpicChild(
  sb: SupabaseClient,
  actor: string,
  itemRef: string,
  target: EpicMoveTarget,
): Promise<CoreResult<EpicReorderResult>> {
  const r = await loadVisibleItem(sb, actor, itemRef);
  if (!r.ok) return r;
  const { item, project } = r.data;
  const ref = refOf(project.key, item.number);
  if (!item.parent_id) return coreErr(`${ref} is not in an epic`, 400);
  const { data: epic } = await sb
    .from("items")
    .select("id, number")
    .eq("id", item.parent_id)
    .maybeSingle();
  if (!epic) return coreErr(`${ref}'s epic was not found`, 404);
  const kids = await loadChildren(sb, item.parent_id);
  if (!kids.ok) return kids;
  if (!kids.data.some((k) => k.id === item.id)) {
    return coreErr(`${ref} is archived; restore it to reorder it`, 400);
  }

  let resolved: EpicMoveTarget = target;
  if (!("to" in target)) {
    const anchorRef = "before" in target ? target.before : target.after;
    const anchorId = await resolveChild(sb, actor, project, kids.data, anchorRef);
    if (!anchorId) {
      return coreErr(`${anchorRef} is not a card in ${refOf(project.key, epic.number)}`, 400);
    }
    resolved = "before" in target ? { before: anchorId } : { after: anchorId };
  }
  const name = (c: EpicPositioned) => refOf(project.key, c.number);
  const plan = planEpicMove(kids.data, item.id, resolved, name);
  return applyPlan(sb, project, epic as Pick<Item, "id" | "number">, kids.data, plan);
}

/**
 * Put an epic's cards in the given order (refs or ids). The listed cards take
 * the places they already hold, in list order; unlisted cards stay put; done
 * cards are skipped and reported.
 */
export async function setEpicOrder(
  sb: SupabaseClient,
  actor: string,
  epicRef: string,
  refs: readonly string[],
): Promise<CoreResult<EpicReorderResult>> {
  const r = await loadVisibleItem(sb, actor, epicRef);
  if (!r.ok) return r;
  const { item: epic, project } = r.data;
  const ref = refOf(project.key, epic.number);
  if (epic.type !== "epic") return coreErr(`${ref} is a ${epic.type}, not an epic`, 400);
  const kids = await loadChildren(sb, epic.id);
  if (!kids.ok) return kids;

  const ids: string[] = [];
  const strangers: string[] = [];
  for (const raw of refs) {
    const id = await resolveChild(sb, actor, project, kids.data, String(raw));
    if (id) ids.push(id);
    else strangers.push(String(raw).trim());
  }
  if (strangers.length) {
    return coreErr(`Not cards in ${ref}: ${strangers.join(", ")} (archived cards can't be ordered)`, 400);
  }
  return applyPlan(sb, project, epic, kids.data, planEpicOrder(kids.data, ids));
}
