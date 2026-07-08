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
  getItemImages,
  listItems,
  setItemArea,
  setItemAssignees,
  setItemBody,
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
const status = z.enum(["new", "in_progress", "blocked", "done"]);

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
      "List non-archived items in a project. `project` is a name or id; optional `status` filters by kanban column. Each item includes its ref (e.g. AMOS-12), area path, tags, and assignees. `name` is the item's body flattened to plain text (there is no separate stored title — the first line of the body acts as the title), so it may span multiple lines for a long item.",
      {
        project: z.string().describe("project name or id"),
        status: status.optional().describe("new | in_progress | blocked | done"),
      },
      async (a) => out(await listItems(getSupabase(), actor(), a.project, a.status)),
    );

    server.tool(
      "get_item",
      "Get full detail for an item, including its body flattened to plain text, area, assignees, and ref. `item` is the item id or a KEY-N reference (e.g. AMOS-12). NOTE: `name` and `body_text` in the response are the SAME value — the item's body flattened to plain text. There is no separate stored title field; the first line of the body serves as the title. So a `name` that mirrors the whole body is expected and correct, not a bug or 'polluted title'. Set `include_images` to also return the inline screenshots pasted into the body as viewable image blocks (base64) — use it when the text references a screenshot/diagram you need to see.",
      {
        item: z.string().describe("item id or KEY-N reference, e.g. AMOS-12"),
        include_images: z
          .boolean()
          .optional()
          .describe("also return inline body images as viewable image blocks"),
      },
      async (a) => {
        const r = await getItem(getSupabase(), actor(), a.item);
        if (!r.ok || !a.include_images) return out(r);
        const content: (
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        )[] = [{ type: "text", text: JSON.stringify(r.data, null, 2) }];
        const imgs = await getItemImages(getSupabase(), actor(), a.item);
        if (imgs.ok) {
          for (const img of imgs.data.images) {
            content.push({ type: "image", data: img.data, mimeType: img.mimeType });
          }
          const { images, skipped, total } = imgs.data;
          content.push({
            type: "text",
            text:
              total === 0
                ? "(no inline images in this item's body)"
                : `${images.length} of ${total} inline image(s) returned above${
                    skipped ? `; ${skipped} skipped (over size/count limits)` : ""
                  }.`,
          });
        }
        return { content };
      },
    );

    server.tool(
      "update_item_status",
      "Move an item to a kanban column: new, in_progress, blocked, or done. `item` is an id or KEY-N reference.",
      { item: z.string().describe("item id or KEY-N reference"), status },
      async (a) => out(await setItemStatus(getSupabase(), actor(), a.item, a.status)),
    );

    server.tool(
      "create_item",
      "Create a new item in a project. `project` is a name or id; defaults to type 'feature', status 'new'. An item has NO separate title field: `name` becomes the first line of the item's rich-text body, and the optional `body` is appended after it as a note — both end up in one body. So keep `name` to a short one-line title and put any detail in `body` (don't dump a long description into `name`, or the whole thing becomes the card's first line). Optionally file it under an `area` path (created if missing) and `assignees` (member emails).",
      {
        project: z.string().describe("project name or id"),
        name: z
          .string()
          .describe(
            "short one-line title; becomes the first line of the item body (there is no separate stored title)",
          ),
        type: z.enum(["feature", "bug", "idea"]).optional().describe("feature | bug | idea (default feature)"),
        body: z
          .string()
          .optional()
          .describe("longer description; appended after the title as a note in the same body"),
        tags: z.array(z.string()).optional().describe("tags (normalized lowercase)"),
        area: z
          .string()
          .optional()
          .describe("Area path, e.g. 'coach / home' (created if missing)"),
        assignees: z
          .array(z.string())
          .optional()
          .describe("member emails to assign"),
      },
      async (a) => {
        const sb = getSupabase();
        const created = await createItem(sb, actor(), a.project, {
          name: a.name,
          type: a.type,
          tags: a.tags,
          area: a.area,
          assignees: a.assignees,
        });
        if (!created.ok) return out(created);
        if (a.body && a.body.trim()) {
          const noted = await appendItemNote(sb, actor(), created.data.id, a.body.trim());
          if (!noted.ok) return out(noted);
        }
        // Return the full detail (ref, area, assignees) of the created item.
        return out(await getItem(sb, actor(), created.data.id));
      },
    );

    server.tool(
      "set_item_body",
      "REPLACE an item's entire body with new plain text (one paragraph per line; the first line becomes the item's title/name). Safe overwrite: the previous state is snapshotted to the item's history first, so it is always recoverable — prefer this over append_item_note when rewriting or retitling. NOTE: inline images in the old body are dropped from the new body (they remain viewable in history). `item` is an id or KEY-N reference.",
      {
        item: z.string().describe("item id or KEY-N reference"),
        body: z
          .string()
          .describe(
            "the full new body text; first line acts as the title, blank lines separate paragraphs",
          ),
      },
      async (a) => out(await setItemBody(getSupabase(), actor(), a.item, a.body)),
    );

    server.tool(
      "append_item_note",
      "Append a progress note paragraph to an item's body (e.g. 'Fixed in PR #7'). `item` is an id or KEY-N reference.",
      { item: z.string().describe("item id or KEY-N reference"), note: z.string() },
      async (a) => out(await appendItemNote(getSupabase(), actor(), a.item, a.note)),
    );

    server.tool(
      "set_item_tags",
      "Replace an item's tags with the given list (normalized lowercase). `item` is an id or KEY-N reference.",
      { item: z.string().describe("item id or KEY-N reference"), tags: z.array(z.string()) },
      async (a) => out(await setItemTags(getSupabase(), actor(), a.item, a.tags)),
    );

    server.tool(
      "set_item_area",
      "File an item under an Area. `area` is a '/'-separated path (e.g. 'coach / home', created if missing), or empty to un-file. `item` is an id or KEY-N reference.",
      {
        item: z.string().describe("item id or KEY-N reference"),
        area: z.string().describe("Area path, e.g. 'coach / home'; empty to un-file"),
      },
      async (a) => out(await setItemArea(getSupabase(), actor(), a.item, a.area)),
    );

    server.tool(
      "set_item_assignees",
      "Replace an item's assignees with the given member emails (non-members are dropped). `item` is an id or KEY-N reference.",
      {
        item: z.string().describe("item id or KEY-N reference"),
        assignees: z.array(z.string()).describe("member emails to assign"),
      },
      async (a) => out(await setItemAssignees(getSupabase(), actor(), a.item, a.assignees)),
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
