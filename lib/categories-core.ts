import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_CATEGORY_DEPTH, type Category } from "@/lib/types";
import { coreErr, coreOk, resolveProject, type CoreResult } from "@/lib/projects-core";

const COLS = "id,project_id,parent_id,name,position,github_repo";

/** All category nodes in a project, ordered by sibling position. */
export async function listCategories(
  sb: SupabaseClient,
  projectId: string,
): Promise<Category[]> {
  const { data } = await sb
    .from("categories")
    .select(COLS)
    .eq("project_id", projectId)
    .order("position", { ascending: true });
  return (data ?? []) as Category[];
}

/** The full "A / B / C" path string for a node id (empty if unknown). */
export function pathOf(cats: Category[], id: string | null): string {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const parts: string[] = [];
  let cur = id;
  // Guard against cycles with a visited set.
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const n = byId.get(cur);
    if (!n) break;
    parts.unshift(n.name);
    cur = n.parent_id;
  }
  return parts.join(" / ");
}

/** A node id plus every descendant id (for subtree filtering). */
export function subtreeIds(cats: Category[], rootId: string): Set<string> {
  const childrenOf = new Map<string | null, Category[]>();
  for (const c of cats) {
    const list = childrenOf.get(c.parent_id) ?? [];
    list.push(c);
    childrenOf.set(c.parent_id, list);
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop() as string;
    for (const ch of childrenOf.get(id) ?? []) {
      if (!out.has(ch.id)) {
        out.add(ch.id);
        stack.push(ch.id);
      }
    }
  }
  return out;
}

/**
 * Find (or create) the node at the end of a "/"-separated path, creating any
 * missing ancestors. Case-insensitive match on each segment. Enforces the depth
 * cap. Returns the leaf node.
 */
export async function findOrCreateByPath(
  sb: SupabaseClient,
  projectId: string,
  pathStr: string,
  actor: string,
): Promise<CoreResult<Category>> {
  const segments = pathStr
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0) return coreErr("empty path", 400);
  if (segments.length > MAX_CATEGORY_DEPTH) {
    return coreErr(`Area path too deep (max ${MAX_CATEGORY_DEPTH})`, 400);
  }

  const cats = await listCategories(sb, projectId);
  let parentId: string | null = null;
  let node: Category | null = null;
  for (const seg of segments) {
    const existing = cats.find(
      (c) =>
        c.parent_id === parentId &&
        c.name.toLowerCase() === seg.toLowerCase(),
    );
    if (existing) {
      node = existing;
      parentId = existing.id;
      continue;
    }
    const siblings = cats.filter((c) => c.parent_id === parentId);
    const position = Math.max(0, ...siblings.map((c) => c.position)) + 1024;
    const { data, error } = await sb
      .from("categories")
      .insert({
        project_id: projectId,
        parent_id: parentId,
        name: seg,
        position,
        created_by: actor,
        updated_by: actor,
      })
      .select(COLS)
      .single();
    if (error) return coreErr(error.message, 500);
    node = data as Category;
    parentId = node.id;
    cats.push(node);
  }
  return coreOk(node as Category);
}

/** Rename a node. The name change ripples to every item via the id reference. */
export async function renameCategory(
  sb: SupabaseClient,
  projectId: string,
  id: string,
  name: string,
  actor: string,
): Promise<CoreResult<Category>> {
  const n = name.trim();
  if (!n) return coreErr("name required", 400);
  const { data, error } = await sb
    .from("categories")
    .update({ name: n, updated_by: actor, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("project_id", projectId)
    .select(COLS)
    .single();
  if (error) return coreErr(error.message, 500);
  return coreOk(data as Category);
}

/** Bind (or unbind with null) a GitHub repo on a category node. */
export async function setCategoryGithubRepo(
  sb: SupabaseClient,
  projectId: string,
  id: string,
  repo: string | null,
  actor: string,
): Promise<CoreResult<Category>> {
  const value = repo && repo.trim() ? repo.trim() : null;
  const { data, error } = await sb
    .from("categories")
    .update({ github_repo: value, updated_by: actor, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("project_id", projectId)
    .select(COLS)
    .single();
  if (error) return coreErr(error.message, 500);
  return coreOk(data as Category);
}

/**
 * Bind a repo to the Area at `areaPath` in a project (creating the path if
 * missing). For MCP: resolves the project (visibility-enforced), finds/creates
 * the area, then sets its repo. `repo` empty/null unbinds.
 */
export async function setAreaGithubRepo(
  sb: SupabaseClient,
  actor: string,
  projectRef: string,
  areaPath: string,
  repo: string | null,
): Promise<CoreResult<Category>> {
  const proj = await resolveProject(sb, actor, projectRef);
  if (!proj.ok) return proj;
  const path = (areaPath ?? "").trim();
  if (!path) return coreErr("area path required", 400);
  const cat = await findOrCreateByPath(sb, proj.data.id, path, actor);
  if (!cat.ok) return cat;
  return setCategoryGithubRepo(sb, proj.data.id, cat.data.id, repo, actor);
}

/**
 * List a project's Areas as full paths with their bound repo — the read side of
 * the area→repo association (for MCP parity). Visibility-enforced via the project.
 */
export async function listAreas(
  sb: SupabaseClient,
  actor: string,
  projectRef: string,
): Promise<CoreResult<{ id: string; path: string; github_repo: string | null }[]>> {
  const proj = await resolveProject(sb, actor, projectRef);
  if (!proj.ok) return proj;
  const cats = await listCategories(sb, proj.data.id);
  return coreOk(
    cats
      .map((c) => ({ id: c.id, path: pathOf(cats, c.id), github_repo: c.github_repo ?? null }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  );
}

/**
 * Delete a node. Its children are reparented up to its parent (so a subtree is
 * never orphaned) and its items are un-filed (category_id → null via the FK).
 */
export async function deleteCategory(
  sb: SupabaseClient,
  projectId: string,
  id: string,
): Promise<CoreResult<true>> {
  const { data: node } = await sb
    .from("categories")
    .select("parent_id")
    .eq("id", id)
    .eq("project_id", projectId)
    .maybeSingle();
  if (!node) return coreErr("not found", 404);
  await sb
    .from("categories")
    .update({ parent_id: (node as { parent_id: string | null }).parent_id })
    .eq("parent_id", id)
    .eq("project_id", projectId);
  const { error } = await sb
    .from("categories")
    .delete()
    .eq("id", id)
    .eq("project_id", projectId);
  if (error) return coreErr(error.message, 500);
  return coreOk(true);
}

/** True when `categoryId` belongs to `projectId` (or is null). */
export async function categoryInProject(
  sb: SupabaseClient,
  projectId: string,
  categoryId: string | null,
): Promise<boolean> {
  if (categoryId === null) return true;
  const { data } = await sb
    .from("categories")
    .select("id")
    .eq("id", categoryId)
    .eq("project_id", projectId)
    .maybeSingle();
  return !!data;
}
