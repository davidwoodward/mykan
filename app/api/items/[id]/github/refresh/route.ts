import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { denyItemAccess, requireSession } from "@/lib/api-auth";
import { refreshItemFromGithub } from "@/lib/github-core";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Manual refresh (KANBAN-24): re-pull the linked item from its GitHub issue,
 * OVERWRITING its content (title/body + labels→tags). The only path by which a
 * linked item re-syncs from GitHub. Returns the updated item row.
 */
export async function POST(_req: Request, { params }: Ctx) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const { id } = await params;

  const deny = await denyItemAccess(id, gate.email);
  if (deny) return deny;

  const r = await refreshItemFromGithub(getSupabase(), gate.email, id);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data);
}
