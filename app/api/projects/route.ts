import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { requireSession } from "@/lib/api-auth";
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
  };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const description =
    typeof body.description === "string"
      ? body.description
      : body.description === null
        ? null
        : null;

  const { data, error } = await getSupabase()
    .from("projects")
    .insert({ name, description, created_by: gate.email, updated_by: gate.email })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
