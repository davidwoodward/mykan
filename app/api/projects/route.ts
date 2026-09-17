import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase-server";
import { requireSession } from "@/lib/api-auth";
import { whitelist } from "@/lib/auth";
import { normalizeAssignees } from "@/lib/types";
import { listProjects } from "@/lib/projects-core";
import { normalizeKeyInput } from "@/lib/card-url";
import { keyConstraintMessage, projectKeyWriteError } from "@/lib/project-keys";

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
    github_account_id?: unknown;
  };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const description =
    typeof body.description === "string" ? body.description : null;
  // The project key (e.g. FPOON) is required (KANBAN-44): it is the board's URL
  // (/FPOON) and every card's ref prefix (FPOON-42). It can't be another
  // project's key or old key (KANBAN-45); it can be renamed later.
  const key = normalizeKeyInput(body.key);
  const keyErr = await projectKeyWriteError(getSupabase(), key);
  if (keyErr) return NextResponse.json({ error: keyErr.error }, { status: keyErr.status });

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
    github_account_id:
      typeof body.github_account_id === "string" && body.github_account_id
        ? body.github_account_id
        : null,
  };

  const { data, error } = await getSupabase()
    .from("projects")
    .insert(insert)
    .select()
    .single();
  if (error) {
    const msg = keyConstraintMessage(error);
    return NextResponse.json({ error: msg ?? error.message }, { status: msg ? 400 : 500 });
  }
  return NextResponse.json(data, { status: 201 });
}
