import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { denyItemAccess, requireSession } from "@/lib/api-auth";
import { desiredIssueState, pushIssueState } from "@/lib/github-writeback";
import type { Item } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Retry write-back (GH-5): re-attempt closing/reopening the linked issue to match
 * the item's CURRENT status, using the acting user's PAT. Powers the "not synced"
 * retry affordance. Reconciles to current status (not a transition), so it's safe
 * to call any number of times — a matching issue state is a harmless no-op.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const deny = await denyItemAccess(id, gate.email);
  if (deny) return deny;

  const { data: row } = await getSupabase()
    .from("items")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const item = row as Item;
  if (!item.github_issue) {
    return NextResponse.json({ error: "not a GitHub-linked item" }, { status: 400 });
  }

  const sync = await pushIssueState(
    getSupabase(),
    gate.email,
    item.github_issue,
    desiredIssueState(item.status),
  );
  await getSupabase().from("items").update({ github_sync: sync }).eq("id", id);
  return NextResponse.json({ ...item, github_sync: sync });
}
