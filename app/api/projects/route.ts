import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { requireSession } from "@/lib/api-auth";
import { whitelist } from "@/lib/auth";
import { normalizeAssignees } from "@/lib/types";
import { listProjects } from "@/lib/projects-core";

export async function GET() {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;
  const r = await listProjects(getSupabase(), gate.email);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data);
}

export async function POST(req: Request) {
  const gate = await requireSession();
  if ("error" in gate) return gate.error;

  const body = (await req.json().catch(() => ({}))) as {
    name?: unknown;
    description?: unknown;
    key?: unknown;
    sharedWith?: unknown;
  };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const description =
    typeof body.description === "string" ? body.description : null;
  // Short uppercase reference key (e.g. AMOS), mirroring the project-edit panel.
  const key =
    typeof body.key === "string"
      ? body.key.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || null
      : null;

  // The creator owns the project; optionally share it with whitelisted members
  // at creation. Empty (the default) means private. `is_private` mirrors it.
  const sharedWith = Array.isArray(body.sharedWith)
    ? normalizeAssignees(body.sharedWith as string[], whitelist()).filter(
        (e) => e !== gate.email,
      )
    : [];
  const insert: Record<string, unknown> = {
    name,
    description,
    key,
    created_by: gate.email,
    updated_by: gate.email,
    shared_with: sharedWith,
    is_private: sharedWith.length === 0,
  };

  const { data, error } = await getSupabase()
    .from("projects")
    .insert(insert)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
