import "server-only";
import { cache } from "react";
import { getSupabase } from "@/lib/supabase-server";
import type { Item, Project } from "@/lib/types";

/** Owner or a member it's shared with (same rule as loadProjectForAccess). */
function canSee(project: Pick<Project, "created_by" | "shared_with">, email: string): boolean {
  return project.created_by === email || (project.shared_with ?? []).includes(email);
}

/**
 * The project with this (canonical, uppercase) key, if `email` can see it.
 * A project that exists but is hidden reads exactly like one that doesn't.
 * Cached per request so the page and its metadata share one query.
 */
export const visibleProjectByKey = cache(
  async (key: string, email: string): Promise<Project | null> => {
    const { data } = await getSupabase().from("projects").select("*").eq("key", key).maybeSingle();
    if (!data) return null;
    const project = data as Project;
    return canSee(project, email) ? project : null;
  },
);

/** The project with this id, if `email` can see it (for old /projects/<id> links). */
export async function visibleProjectById(id: string, email: string): Promise<Project | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { data } = await getSupabase().from("projects").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const project = data as Project;
  return canSee(project, email) ? project : null;
}

/** Card number N in a project (archived cards included). */
export const itemByNumber = cache(
  async (projectId: string, number: number): Promise<Item | null> => {
    const { data } = await getSupabase()
      .from("items")
      .select("*")
      .eq("project_id", projectId)
      .eq("number", number)
      .maybeSingle();
    return (data as Item | null) ?? null;
  },
);
