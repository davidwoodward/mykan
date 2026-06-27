import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { requireSession } from "@/lib/api-auth";
import { isOwner } from "@/lib/auth";
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
    isPrivate?: unknown;
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

  const insert: Record<string, unknown> = {
    name,
    description,
    key,
    created_by: gate.email,
    updated_by: gate.email,
  };
  // Visibility may be set private only by the owner (the creator is the owner here).
  if (body.isPrivate === true) {
    if (!isOwner(gate.email)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    insert.is_private = true;
  }

  const { data, error } = await getSupabase()
    .from("projects")
    .insert(insert)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
