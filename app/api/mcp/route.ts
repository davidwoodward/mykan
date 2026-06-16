import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { getSupabase } from "@/lib/supabase-server";
import { checkServiceKey } from "@/lib/service-auth";
import { mcpActorEmail } from "@/lib/auth";
import { listProjects, type CoreResult } from "@/lib/projects-core";
import {
  appendItemNote,
  createItem,
  getItem,
  listItems,
  setItemStatus,
  setItemTags,
} from "@/lib/items-core";

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function out<T>(r: CoreResult<T>) {
  return json(r.ok ? r.data : { error: r.error });
}
const actor = () => mcpActorEmail();
const status = z.enum(["new", "in_progress", "done"]);

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "list_projects",
      "List mykan projects visible to the agent (id, name, privacy).",
      {},
      async () => out(await listProjects(getSupabase(), actor())),
    );

    server.tool(
      "list_items",
      "List non-archived items in a project. `project` is a name or id; optional `status` filters by kanban column.",
      {
        project: z.string().describe("project name or id"),
        status: status.optional().describe("new | in_progress | done"),
      },
      async (a) => out(await listItems(getSupabase(), actor(), a.project, a.status)),
    );

    server.tool(
      "get_item",
      "Get full detail for an item, including its body flattened to plain text (the task description).",
      { item_id: z.string() },
      async (a) => out(await getItem(getSupabase(), actor(), a.item_id)),
    );

    server.tool(
      "update_item_status",
      "Move an item to a kanban column: new, in_progress, or done.",
      { item_id: z.string(), status },
      async (a) => out(await setItemStatus(getSupabase(), actor(), a.item_id, a.status)),
    );

    server.tool(
      "create_item",
      "Create a new item in a project. `project` is a name or id; defaults to type 'feature', status 'new'. A longer `body` is appended as the first note.",
      {
        project: z.string().describe("project name or id"),
        name: z.string(),
        type: z.enum(["feature", "bug", "idea"]).optional(),
        body: z.string().optional().describe("longer description; appended as a note"),
        tags: z.array(z.string()).optional(),
      },
      async (a) => {
        const sb = getSupabase();
        const created = await createItem(sb, actor(), a.project, {
          name: a.name,
          type: a.type,
          tags: a.tags,
        });
        if (created.ok && a.body && a.body.trim()) {
          return out(await appendItemNote(sb, actor(), created.data.id, a.body.trim()));
        }
        return out(created);
      },
    );

    server.tool(
      "append_item_note",
      "Append a progress note paragraph to an item's body (e.g. 'Fixed in PR #7').",
      { item_id: z.string(), note: z.string() },
      async (a) => out(await appendItemNote(getSupabase(), actor(), a.item_id, a.note)),
    );

    server.tool(
      "set_item_tags",
      "Replace an item's tags with the given list (normalized lowercase).",
      { item_id: z.string(), tags: z.array(z.string()) },
      async (a) => out(await setItemTags(getSupabase(), actor(), a.item_id, a.tags)),
    );
  },
  undefined,
  { basePath: "/api" },
);

// Bearer-gate every method before the MCP handler runs.
async function gated(req: Request): Promise<Response> {
  if (!checkServiceKey(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return handler(req);
}

export { gated as GET, gated as POST, gated as DELETE };
