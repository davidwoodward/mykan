import "server-only";
import { createMcpHandler } from "mcp-handler";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSupabase } from "@/lib/supabase-server";
import { matchesServiceKey } from "@/lib/service-auth";
import { defaultMcpActorEmail, mcpActorEmail } from "@/lib/auth";
import { runAsMcpActor } from "@/lib/mcp-actor-context";
import { looksLikeMcpToken, verifyMcpToken } from "@/lib/mcp-tokens";
import { listProjects, setProjectGithubAccount, type CoreResult } from "@/lib/projects-core";
import { listAreas, setAreaGithubRepo } from "@/lib/categories-core";
import { refreshItemFromGithub } from "@/lib/github-core";
import {
  appendItemNote,
  createItem,
  getItem,
  getItemImages,
  listItems,
  setItemArea,
  setItemAssignees,
  setItemBody,
  setItemParent,
  setItemStatus,
  setItemTags,
  setItemType,
  loadVisibleItem,
  refOf,
} from "@/lib/items-core";
import {
  addEntry,
  answerQuestion,
  deleteEntry,
  editEntry,
  listEntries,
  listEntryVersions,
  loadVisibleEntry,
  restoreEntryVersion,
  summarizeItemEntries,
  supersedeEntry,
  undeleteEntry,
} from "@/lib/item-entries";
import {
  CONTENT_BOUNDARY,
  ITEM_BODY_BUDGET_CHARS,
  MCP_ENTRY_MAX_CHARS,
  answerArgsError,
  bodyBudgetWarning,
  entryCapError,
  progressRecordedMessage,
} from "@/lib/mcp-entry-guards";

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}
function out<T>(r: CoreResult<T>) {
  return json(r.ok ? r.data : { error: r.error });
}
// The acting identity for the CURRENT request — set by the gate via
// runAsMcpActor() from the presented token (per-user) or shared key (owner).
const actor = () => mcpActorEmail();
const status = z.enum(["new", "in_progress", "blocked", "testing", "done"]);
const itemType = z.enum(["feature", "bug", "task", "idea", "epic"]);
const fail = (error: string) => json({ error });
const CAP = `${MCP_ENTRY_MAX_CHARS.toLocaleString("en-US")} characters`;

function registerTools(server: McpServer) {
  server.tool(
    "list_projects",
    "List mykan projects visible to the agent (id, name, privacy).",
    {},
    async () => out(await listProjects(getSupabase(), actor())),
  );

  server.tool(
    "list_items",
    "List non-archived items in a project. `project` is a name or id; optional `status` filters by kanban column. Each item includes its ref (e.g. AMOS-12), type (feature | bug | task | idea | epic), area path, tags, assignees, and `parent` — the ref of the epic it belongs to, or null. `name` is the item's title: the first non-empty line of its body (there is no separate stored title), capped at 200 chars. The body is NOT included — call get_item for it.",
    {
      project: z.string().describe("project name or id"),
      status: status.optional().describe("new | in_progress | blocked | testing | done"),
    },
    async (a) => out(await listItems(getSupabase(), actor(), a.project, a.status)),
  );

  server.tool(
    "get_item",
    "Get full detail for an item, including its body flattened to plain text, area, assignees, and ref. `item` is the item id or a KEY-N reference (e.g. AMOS-12). `name` is the item's title — the first non-empty line of the body (there is no separate stored title), capped at 200 chars; `body_text` is the whole body (the card's description, a living spec) as plain text, title line included. `parent` is the epic this item belongs to ({ref, name}) or null. For an epic, `children` lists its non-archived child items ({ref, name, status}) and `children_progress` reads 'N/M done'. Entries logged against the item: `decisions` lists the ACTIVE decisions ({id, body, created_at, created_by, supersedes_id}), `open_questions` the unanswered questions ({id, body, created_at}), and `progress` is only a summary ({count, last_at}: non-deleted progress entries, superseded included, and when the newest was created) — the progress log itself is NOT returned; call list_item_entries when you need that background. Entry ids are what update_item_entry, answer_question and record_decision's `supersedes` take. Set `include_images` to also return the inline screenshots pasted into the body as viewable image blocks (base64) — use it when the text references a screenshot/diagram you need to see.",
    {
      item: z.string().describe("item id or KEY-N reference, e.g. AMOS-12"),
      include_images: z
        .boolean()
        .optional()
        .describe("also return inline body images as viewable image blocks"),
    },
    async (a) => {
      const r = await getItem(getSupabase(), actor(), a.item);
      if (!r.ok) return out(r);
      const entries = await summarizeItemEntries(getSupabase(), r.data.id);
      if (!entries.ok) return out(entries);
      const detail = { ...r.data, ...entries.data };
      if (!a.include_images) return json(detail);
      const content: (
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      )[] = [{ type: "text", text: JSON.stringify(detail, null, 2) }];
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
    "Move an item to a kanban column: new, in_progress, blocked, testing, or done. `item` is an id or KEY-N reference.",
    { item: z.string().describe("item id or KEY-N reference"), status },
    async (a) => out(await setItemStatus(getSupabase(), actor(), a.item, a.status)),
  );

  server.tool(
    "create_item",
    "Create a new item in a project. `project` is a name or id; defaults to type 'feature', status 'new'. An item has NO separate title field: `name` becomes the first line of the item's rich-text body, and the optional `body` is appended after it as further paragraphs of the description (not a progress entry) — both end up in one body. So keep `name` to a short one-line title and put any detail in `body` (don't dump a long description into `name`, or the whole thing becomes the card's first line). Optionally file it under an `area` path (created if missing) and `assignees` (member emails). Type 'epic' makes a card that groups other cards; set `parent` to an epic's ref (e.g. KANBAN-41) to create the item as that epic's child. Epics are one level only (an epic can't have a parent) and the parent must be a non-archived epic in the same project.",
    {
      project: z.string().describe("project name or id"),
      name: z
        .string()
        .describe(
          "short one-line title; becomes the first line of the item body (there is no separate stored title)",
        ),
      type: itemType
        .optional()
        .describe("feature | bug | task | idea | epic (default feature)"),
      body: z
        .string()
        .optional()
        .describe("longer description; appended after the title as further paragraphs of the same body (the card description)"),
      tags: z.array(z.string()).optional().describe("tags (normalized lowercase)"),
      area: z
        .string()
        .optional()
        .describe("Area path, e.g. 'coach / home' (created if missing)"),
      assignees: z
        .array(z.string())
        .optional()
        .describe("member emails to assign"),
      parent: z
        .string()
        .optional()
        .describe("parent epic as a KEY-N reference or id, e.g. KANBAN-41 (same project)"),
    },
    async (a) => {
      const sb = getSupabase();
      const created = await createItem(sb, actor(), a.project, {
        name: a.name,
        type: a.type,
        tags: a.tags,
        area: a.area,
        assignees: a.assignees,
        parent: a.parent,
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
    `REPLACE an item's entire body with new plain text (one paragraph per line; the first line becomes the item's title/name). The body is the card's description: a clean living spec of the work — rewrite it when the spec changes. Progress does NOT go here (append_item_note), nor do decisions (record_decision) or open questions (ask_question). Safe overwrite: the previous state is snapshotted to the item's history first, so it is always recoverable. The write always happens, but past ${ITEM_BODY_BUDGET_CHARS.toLocaleString("en-US")} characters the response carries a \`warning\`: a growing spec usually means progress is leaking back in. NOTE: inline images in the old body are dropped from the new body (they remain viewable in history). \`item\` is an id or KEY-N reference. ${CONTENT_BOUNDARY}`,
    {
      item: z.string().describe("item id or KEY-N reference"),
      body: z
        .string()
        .describe(
          "the full new body text; first line acts as the title, blank lines separate paragraphs",
        ),
    },
    async (a) => {
      const r = await setItemBody(getSupabase(), actor(), a.item, a.body);
      if (!r.ok) return out(r);
      const warning = bodyBudgetWarning(a.body);
      return json(warning ? { ...r.data, warning } : r.data);
    },
  );

  server.tool(
    "append_item_note",
    `Record a progress note on an item (e.g. 'PR #7 opened', 'merged, deploying', 'deployed, verified live'). As of KANBAN-37 this NO LONGER edits the card body: the note is saved as a separate progress entry, so the description stays a clean spec. Returns the created entry (with its id) and a sentence saying where it went. Read notes back with list_item_entries (kind: progress); get_item shows only the progress count and last date. Max ${CAP} per note: a checkpoint, not a log — put long detail (investigation, output, handoff) in a repo doc or the PR description and link to it. Notes are editable with update_item_entry (versioned). \`item\` is an id or KEY-N reference. ${CONTENT_BOUNDARY}`,
    {
      item: z.string().describe("item id or KEY-N reference"),
      note: z.string().describe(`the progress note, plain text, max ${CAP}`),
    },
    async (a) => {
      const capErr = entryCapError("progress", a.note);
      if (capErr) return fail(capErr);
      const sb = getSupabase();
      const it = await loadVisibleItem(sb, actor(), a.item);
      if (!it.ok) return out(it);
      const ref = refOf(it.data.project.key, it.data.item.number);
      const r = await addEntry(sb, actor(), it.data.item.id, { kind: "progress", body: a.note }, "mcp");
      if (!r.ok) return out(r);
      return json({ message: progressRecordedMessage(ref), item: ref, entry: r.data });
    },
  );

  server.tool(
    "record_decision",
    `Record a decision on an item. Decisions are David's: record what David decided (quote or faithfully paraphrase him), never decide on his behalf — if something needs deciding, use ask_question instead. Optional \`supersedes\`: the id of an earlier ACTIVE decision on the same item that this one replaces; the earlier one becomes 'superseded' (kept, not deleted). Active decisions appear in get_item. Max ${CAP}; if the reasoning is longer, put it in a repo doc and link it. \`item\` is an id or KEY-N reference. Returns the new decision entry (and the superseded one, if any).`,
    {
      item: z.string().describe("item id or KEY-N reference"),
      decision: z.string().describe(`what David decided, plain text, max ${CAP}`),
      supersedes: z
        .string()
        .optional()
        .describe("id of an earlier active decision on the same item that this replaces"),
    },
    async (a) => {
      const capErr = entryCapError("decision", a.decision);
      if (capErr) return fail(capErr);
      const sb = getSupabase();
      const it = await loadVisibleItem(sb, actor(), a.item);
      if (!it.ok) return out(it);
      if (!a.supersedes?.trim()) {
        const r = await addEntry(sb, actor(), it.data.item.id, { kind: "decision", body: a.decision }, "mcp");
        return r.ok ? json({ decision: r.data }) : out(r);
      }
      const older = await loadVisibleEntry(sb, actor(), a.supersedes);
      if (!older.ok) return out(older);
      const prev = older.data.entry;
      if (prev.kind !== "decision") {
        return fail(`supersedes must be a decision entry; ${prev.id} is a ${prev.kind} entry`);
      }
      if (prev.item_id !== it.data.item.id) {
        return fail("supersedes must be a decision on the same item");
      }
      const r = await supersedeEntry(sb, actor(), prev.id, { body: a.decision }, "mcp");
      return r.ok ? json({ decision: r.data.entry, superseded: r.data.superseded }) : out(r);
    },
  );

  server.tool(
    "ask_question",
    `Record an open question on an item: something David (or whoever owns the call) needs to decide or clarify. Open questions appear in get_item until answered with answer_question. Max ${CAP}. \`item\` is an id or KEY-N reference. Returns the question entry (with its id).`,
    {
      item: z.string().describe("item id or KEY-N reference"),
      question: z.string().describe(`the question, plain text, max ${CAP}`),
    },
    async (a) => {
      const capErr = entryCapError("question", a.question);
      if (capErr) return fail(capErr);
      const r = await addEntry(getSupabase(), actor(), a.item, { kind: "question", body: a.question }, "mcp");
      return r.ok ? json({ question: r.data }) : out(r);
    },
  );

  server.tool(
    "answer_question",
    `Answer an open question with a decision, which the question then links to (answered_by_id). Pass EXACTLY ONE of \`decision_id\` (an existing active decision on the same item) or \`decision\` (text for a new decision, which is recorded and linked). As with record_decision, the answer is what David decided; don't answer on his behalf. An answered question can't be answered again. Max ${CAP} for new decision text. Returns the question and the decision.`,
    {
      question_id: z.string().describe("id of the open question entry (from ask_question, get_item or list_item_entries)"),
      decision_id: z
        .string()
        .optional()
        .describe("id of an existing active decision on the same item"),
      decision: z.string().optional().describe(`text for a new decision, max ${CAP}`),
    },
    async (a) => {
      const argErr = answerArgsError(a);
      if (argErr) return fail(argErr);
      const decisionId = a.decision_id?.trim();
      if (!decisionId) {
        const capErr = entryCapError("decision", a.decision);
        if (capErr) return fail(capErr);
      }
      const input = decisionId ? { decisionId } : { body: a.decision };
      return out(await answerQuestion(getSupabase(), actor(), a.question_id, input, "mcp"));
    },
  );

  server.tool(
    "update_item_entry",
    `Edit the text of an entry (progress, decision or question): fix a typo, correct a fact, tighten a note. Versioned: the previous text is snapshotted first, so it is always recoverable (list_item_entry_versions, restore_item_entry_version). To replace a decision with a new one, use record_decision with \`supersedes\` instead, so what was decided before stays visible. A deleted entry must be restored first. Max ${CAP}. Returns the updated entry.`,
    {
      entry: z.string().describe("entry id"),
      body: z.string().describe(`the entry's full new text, max ${CAP}`),
    },
    async (a) => {
      const sb = getSupabase();
      const v = await loadVisibleEntry(sb, actor(), a.entry);
      if (!v.ok) return out(v);
      const capErr = entryCapError(v.data.entry.kind, a.body);
      if (capErr) return fail(capErr);
      return out(await editEntry(sb, actor(), v.data.entry.id, { body: a.body }, "mcp"));
    },
  );

  server.tool(
    "list_item_entries",
    "List an item's entries, newest first: background on demand (get_item carries only active decisions, open questions and a progress count). Filters: `kind` progress | decision | question; `state` (progress: current | superseded; decision: active | superseded; question: open | answered); `since` an ISO date/time (entries created after it); `limit` 1-200 (default 50); `include_deleted` to also show soft-deleted entries. `item` is an id or KEY-N reference. Each entry has id, kind, state, body, supersedes_id, answered_by_id, source, created_at/by, updated_at/by, deleted_at/by.",
    {
      item: z.string().describe("item id or KEY-N reference"),
      kind: z.enum(["progress", "decision", "question"]).optional(),
      state: z
        .enum(["current", "superseded", "active", "open", "answered"])
        .optional()
        .describe("must fit the kind, if one is given"),
      since: z.string().optional().describe("ISO date/time; only entries created after it"),
      limit: z.number().int().optional().describe("1-200, default 50"),
      include_deleted: z.boolean().optional().describe("also list soft-deleted entries"),
    },
    async (a) =>
      out(
        await listEntries(getSupabase(), actor(), a.item, {
          kind: a.kind,
          state: a.state,
          since: a.since,
          limit: a.limit,
          includeDeleted: a.include_deleted === true,
        }),
      ),
  );

  server.tool(
    "delete_item_entry",
    "Soft-delete an entry (progress, decision or question): it drops out of get_item and list_item_entries, but is versioned and can be brought back with restore_item_entry. Use it for an entry recorded by mistake or on the wrong card; to correct text use update_item_entry, to replace a decision use record_decision with `supersedes`. Returns the entry.",
    { entry: z.string().describe("entry id") },
    async (a) => out(await deleteEntry(getSupabase(), actor(), a.entry, "mcp")),
  );

  server.tool(
    "restore_item_entry",
    "Bring back a soft-deleted entry (versioned). Refused when another entry has taken its place since (e.g. the entry it superseded was reinstated, or superseded again). Find deleted entries with list_item_entries (include_deleted: true). Returns the entry.",
    { entry: z.string().describe("entry id") },
    async (a) => out(await undeleteEntry(getSupabase(), actor(), a.entry, "mcp")),
  );

  server.tool(
    "list_item_entry_versions",
    "List an entry's earlier versions, newest first. Each version's `snapshot` is the entry's state (body, state, answered_by_id, deleted_at) BEFORE the change named in `fields_changed`, with who made that change and when. Use with restore_item_entry_version to recover earlier text.",
    { entry: z.string().describe("entry id") },
    async (a) => out(await listEntryVersions(getSupabase(), actor(), a.entry)),
  );

  server.tool(
    "restore_item_entry_version",
    "Restore an entry to one of its versions (ids from list_item_entry_versions). The restore is itself versioned, so it can be undone the same way. Restoring a version from before a delete brings the entry back. Returns the entry.",
    {
      entry: z.string().describe("entry id"),
      version: z.string().describe("version id from list_item_entry_versions"),
    },
    async (a) => out(await restoreEntryVersion(getSupabase(), actor(), a.entry, a.version)),
  );

  server.tool(
    "set_item_type",
    "Change an item's type: feature | bug | task | idea | epic. Recorded in the item's history. Epic rules: an epic that still has child items can't change type (unlink them first with set_item_parent), and an item that has a parent epic can't become an epic (clear its parent first). `item` is an id or KEY-N reference. Returns the item detail.",
    {
      item: z.string().describe("item id or KEY-N reference"),
      type: itemType.describe("feature | bug | task | idea | epic"),
    },
    async (a) => out(await setItemType(getSupabase(), actor(), a.item, a.type)),
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
    "set_item_parent",
    "Link an item to its parent epic, or clear the link. `item` is an id or KEY-N reference; `parent` is the epic's KEY-N reference or id, or empty to clear. Rules: the parent must be a non-archived item of type 'epic' in the same project; an epic cannot itself have a parent (one level only); an item can't be its own parent. The change is recorded in the item's history. Returns the item detail, including `parent`.",
    {
      item: z.string().describe("item id or KEY-N reference"),
      parent: z.string().describe("parent epic KEY-N reference or id; empty to clear"),
    },
    async (a) => out(await setItemParent(getSupabase(), actor(), a.item, a.parent)),
  );

  server.tool(
    "set_project_github_account",
    "Bind a project to a GitHub account (or unbind). `project` is a name or id; `account` is the GitHub account/org login as connected in mykan, or empty to unbind. Issues import into the project's areas that are mapped to repos in this account. Does NOT touch credentials.",
    {
      project: z.string().describe("project name or id"),
      account: z.string().describe("GitHub account/org login as connected in mykan; empty to unbind"),
    },
    async (a) =>
      out(await setProjectGithubAccount(getSupabase(), actor(), a.project, a.account || null)),
  );

  server.tool(
    "list_areas",
    "List a project's Areas as full '/'-separated paths with any bound GitHub repo. `project` is a name or id.",
    { project: z.string().describe("project name or id") },
    async (a) => out(await listAreas(getSupabase(), actor(), a.project)),
  );

  server.tool(
    "set_area_github_repo",
    "Bind a GitHub repo to a project's Area (or unbind). `project` is a name or id; `area` is a '/'-separated path (created if missing); `repo` is just the repo NAME — the owner is implied by the project's bound GitHub account — or empty to unbind. Issues from this repo import as items under this Area. Does NOT touch credentials.",
    {
      project: z.string().describe("project name or id"),
      area: z.string().describe("Area path, e.g. 'coach / home' (created if missing)"),
      repo: z.string().describe("repo name (owner implied by the project's account); empty to unbind"),
    },
    async (a) =>
      out(await setAreaGithubRepo(getSupabase(), actor(), a.project, a.area, a.repo || null)),
  );

  server.tool(
    "refresh_item_from_github",
    "Re-pull a GitHub-linked item from its source issue, OVERWRITING the item's title/body and tags with the issue's CURRENT title, body, and labels. This is the ONLY way a linked item re-syncs from GitHub — import never updates an existing item and nothing polls. Status, area, and assignees are mykan's and are left untouched. Uses your PAT for the item's account; the previous content is recoverable from item history. `item` is an id or KEY-N reference.",
    { item: z.string().describe("item id or KEY-N reference") },
    async (a) => {
      const r = await refreshItemFromGithub(getSupabase(), actor(), a.item);
      if (!r.ok) return json({ error: r.error });
      return out(await getItem(getSupabase(), actor(), a.item));
    },
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
}

/**
 * Resolve the acting user for an MCP request from its bearer token.
 *  - A per-user `mk_…` token (KANBAN-30) → that token's whitelisted user_email.
 *  - The transitional shared MYKAN_SERVICE_API_KEY → the owner identity
 *    (dual-accept during rollout; retire the shared key once tokens are issued).
 *  - Anything else → null (401). The Authorization header is never logged.
 */
async function resolveMcpActor(req: Request): Promise<string | null> {
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const presented = m[1].trim();
  if (looksLikeMcpToken(presented)) {
    return verifyMcpToken(getSupabase(), presented);
  }
  if (matchesServiceKey(presented)) return defaultMcpActorEmail();
  return null;
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Build the MCP request handler mounted at `${basePath}/mcp`. The returned
 * function bearer-gates every method, resolves the acting user, and runs the
 * MCP handler inside runAsMcpActor() so every tool acts as that user.
 *
 * `/mcp` (basePath "") is the canonical endpoint; `/api/mcp` (basePath "/api")
 * is kept alive for backward compatibility with existing registrations.
 */
export function createGatedMcpHandler(basePath: string) {
  const handler = createMcpHandler(registerTools, undefined, { basePath });
  return async function gated(req: Request): Promise<Response> {
    const email = await resolveMcpActor(req);
    if (!email) return unauthorized();
    return runAsMcpActor(email, () => handler(req));
  };
}
