import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase-server";

export async function requireSession() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    } as const;
  }
  return { session, email } as const;
}

type ProjectAccessRow = {
  is_private?: boolean | null;
  created_by?: string | null;
  shared_with?: string[] | null;
};

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

type ProjectAccess =
  | { error: NextResponse; project?: undefined }
  | { error?: undefined; project: ProjectAccessRow };

/**
 * Loads a project and enforces visibility: reachable only by its owner
 * (creator) or a member it's shared with. Returns a 404 (never 403 — don't
 * reveal existence) otherwise.
 */
export async function loadProjectForAccess(
  projectId: string,
  email: string,
): Promise<ProjectAccess> {
  const { data } = await getSupabase()
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();
  if (!data) return { error: notFound() };
  const project = data as ProjectAccessRow;
  const shared = project.shared_with ?? [];
  if (project.created_by !== email && !shared.includes(email)) {
    return { error: notFound() };
  }
  return { project };
}

/**
 * Same visibility check for an item, via its parent project. Returns a 404
 * NextResponse when the item is missing or its project is hidden, else null.
 */
export async function denyItemAccess(
  itemId: string,
  email: string,
): Promise<NextResponse | null> {
  const { data: item } = await getSupabase()
    .from("items")
    .select("project_id")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return notFound();
  const access = await loadProjectForAccess(item.project_id as string, email);
  if (access.error) return access.error;
  return null;
}
