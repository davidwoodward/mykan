import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { loadProjectForAccess, requireSession } from "@/lib/api-auth";
import { createItem } from "@/lib/items-core";
import { countOpenQuestions } from "@/lib/entry-panels";
import type { Item } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const access = await loadProjectForAccess(id, gate.email);
  if (access.error) return access.error;

  // The items, and in the same round trip ONE query for the project's open
  // questions (KANBAN-38's "N open questions" badge): an inner join to items
  // filters by project, so there is no per-item query and no id list in the URL.
  const [itemsRes, questionsRes] = await Promise.all([
    getSupabase()
      .from("items")
      .select("*")
      .eq("project_id", id)
      .order("position", { ascending: true }),
    getSupabase()
      .from("item_entries")
      .select("item_id, items!inner(project_id)")
      .eq("items.project_id", id)
      .eq("kind", "question")
      .eq("state", "open")
      .is("deleted_at", null),
  ]);
  if (itemsRes.error) {
    return NextResponse.json({ error: itemsRes.error.message }, { status: 500 });
  }
  // A failed count must never take the board down: log it and show no badges.
  if (questionsRes.error) {
    console.error("open question counts failed:", questionsRes.error.message);
  }
  const counts = countOpenQuestions(
    questionsRes.error ? [] : ((questionsRes.data ?? []) as { item_id: string }[]),
  );
  // Each row carries its count (absent when 0). The board keeps these in their
  // own state, since item PATCH responses don't carry them.
  const rows = ((itemsRes.data ?? []) as Item[]).map((it) =>
    counts[it.id] ? { ...it, open_questions: counts[it.id] } : it,
  );
  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const access = await loadProjectForAccess(id, gate.email);
  if (access.error) return access.error;

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    type?: unknown;
    body?: unknown;
    tags?: unknown;
    category_id?: unknown;
    position?: unknown;
    parent_id?: unknown;
  };
  const r = await createItem(getSupabase(), gate.email, id, {
    name: body.name,
    type: body.type,
    body: body.body,
    tags: body.tags,
    category_id: body.category_id,
    position: body.position,
    parent: body.parent_id,
  });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 201 });
}
