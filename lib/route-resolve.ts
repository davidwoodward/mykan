import "server-only";
import { cache } from "react";
import { getSupabase } from "@/lib/supabase-server";
import { aliasProjectId } from "@/lib/project-keys";
import type { KeyMatch } from "@/lib/card-url";
import type { Item, Project } from "@/lib/types";

/** Owner or a member it's shared with (same rule as loadProjectForAccess). */
function canSee(project: Pick<Project, "created_by" | "shared_with">, email: string): boolean {
  return project.created_by === email || (project.shared_with ?? []).includes(email);
}

/**
 * The project a (canonical, uppercase) key names: by its current key, else by
 * one of its old keys (KANBAN-45). `project` is returned only when `email` can
 * see it; `match.visible` says whether they can, so the caller can make the
 * same not-found decision for a hidden project whichever way it matched.
 * Cached per request so the page and its metadata share the queries.
 */
export const projectForKey = cache(
  async (key: string, email: string): Promise<{ match: KeyMatch; project: Project | null }> => {
    const sb = getSupabase();
    const { data } = await sb.from("projects").select("*").eq("key", key).maybeSingle();
    let project = (data as Project | null) ?? null;
    let via: "key" | "alias" = "key";
    if (!project) {
      const id = await aliasProjectId(sb, key);
      if (!id) return { match: null, project: null };
      const { data: aliased } = await sb.from("projects").select("*").eq("id", id).maybeSingle();
      project = (aliased as Project | null) ?? null;
      via = "alias";
    }
    if (!project?.key) return { match: null, project: null };
    const visible = canSee(project, email);
    return {
      match: { via, currentKey: project.key, visible },
      project: visible ? project : null,
    };
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
