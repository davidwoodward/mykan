import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ItemStatus, Project } from "@/lib/types";
import {
  coreOk,
  listProjects,
  resolveProject,
  type CoreResult,
} from "@/lib/projects-core";
import {
  createItem,
  getItem,
  listItems,
  setItemArea,
  setItemStatus,
  setItemTags,
  type ItemSummary,
} from "@/lib/items-core";

/**
 * The Telegram bot "brain". A single `handleTelegramCommand` turns a chat text
 * line into a reply, reusing the very same core functions the web app and the
 * MCP server call — so the bot can never drift from the rest of mykan. The HTTP
 * webhook (app/api/telegram/route.ts) stays thin: verify, whitelist, dispatch.
 */

// --- Telegram HTML escaping (parse_mode: "HTML" accepts &, <, > escaped) -----
export function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// --- Status parsing (friendly aliases → canonical column) --------------------
const STATUS_ALIASES: Record<string, ItemStatus> = {
  new: "new",
  todo: "new",
  backlog: "new",
  in_progress: "in_progress",
  inprogress: "in_progress",
  progress: "in_progress",
  doing: "in_progress",
  wip: "in_progress",
  start: "in_progress",
  started: "in_progress",
  blocked: "blocked",
  block: "blocked",
  stuck: "blocked",
  done: "done",
  complete: "done",
  completed: "done",
  finish: "done",
  finished: "done",
  close: "done",
  closed: "done",
};

function parseStatus(raw: string): ItemStatus | null {
  return STATUS_ALIASES[raw.trim().toLowerCase()] ?? null;
}

const STATUS_META: Record<ItemStatus, { emoji: string; label: string }> = {
  new: { emoji: "🆕", label: "New" },
  in_progress: { emoji: "⏳", label: "In progress" },
  blocked: { emoji: "🚫", label: "Blocked" },
  done: { emoji: "✅", label: "Done" },
};
const STATUS_ORDER: ItemStatus[] = ["new", "in_progress", "blocked", "done"];

// --- Project resolution (by key, then name/id) -------------------------------
/** Resolve a project ref preferring its short key (e.g. "KANBAN"), then name/id. */
async function resolveProjectRef(
  sb: SupabaseClient,
  actor: string,
  ref: string,
): Promise<CoreResult<Project>> {
  const list = await listProjects(sb, actor);
  if (!list.ok) return list;
  const lc = ref.trim().toLowerCase();
  const byKey = list.data.find((p) => (p.key ?? "").toLowerCase() === lc);
  if (byKey) return coreOk(byKey);
  return resolveProject(sb, actor, ref);
}

// --- Rendering helpers -------------------------------------------------------
function itemLine(it: ItemSummary): string {
  const tags = it.tags.length ? `  <i>#${it.tags.map(esc).join(" #")}</i>` : "";
  const area = it.area ? `  📁 ${esc(it.area)}` : "";
  return `<code>${esc(it.ref)}</code>  ${esc(it.name)}${tags}${area}`;
}

const HELP = [
  "<b>mykan bot</b> — work your board from Telegram.",
  "",
  "<b>/projects</b> — list projects (with keys)",
  "<b>/list</b> &lt;project&gt; [status] — list items (e.g. <code>/list KANBAN in_progress</code>)",
  "<b>/add</b> &lt;project&gt; &lt;text&gt; — add an item (first line = title, rest = note)",
  "<b>/item</b> &lt;ref&gt; — show one item (e.g. <code>/item KANBAN-4</code>)",
  "<b>/status</b> &lt;ref&gt; &lt;status&gt; — move it (new · doing · blocked · done)",
  "<b>/tags</b> &lt;ref&gt; — review an item's tags",
  "<b>/tag</b> &lt;ref&gt; +add -remove — add/remove tags (e.g. <code>/tag KANBAN-4 +urgent -later</code>)",
  "<b>/area</b> &lt;ref&gt; &lt;path&gt; — file under an area (e.g. <code>/area KANBAN-4 coach / home</code>; empty to un-file)",
].join("\n");

function err(msg: string): string {
  return `⚠️ ${esc(msg)}`;
}

// --- Command handlers --------------------------------------------------------
async function cmdProjects(sb: SupabaseClient, actor: string): Promise<string> {
  const r = await listProjects(sb, actor);
  if (!r.ok) return err(r.error);
  if (!r.data.length) return "No projects yet.";
  const lines = r.data.map((p) => {
    const key = p.key ? `<code>${esc(p.key)}</code> · ` : "";
    const priv = p.is_private ? " 🔒" : "";
    return `• ${key}${esc(p.name)}${priv}`;
  });
  return `<b>Projects</b>\n${lines.join("\n")}`;
}

async function cmdList(
  sb: SupabaseClient,
  actor: string,
  args: string,
): Promise<string> {
  const tokens = args.split(/\s+/).filter(Boolean);
  if (!tokens.length) return err("Usage: /list <project> [status]");
  let statusFilter: ItemStatus | undefined;
  // An optional trailing status token filters the column.
  if (tokens.length > 1) {
    const maybe = parseStatus(tokens[tokens.length - 1]);
    if (maybe) {
      statusFilter = maybe;
      tokens.pop();
    }
  }
  const projRef = tokens.join(" ");
  const proj = await resolveProjectRef(sb, actor, projRef);
  if (!proj.ok) return err(proj.error);
  const r = await listItems(sb, actor, proj.data.id, statusFilter);
  if (!r.ok) return err(r.error);
  if (!r.data.length) {
    return `<b>${esc(proj.data.name)}</b> — no${
      statusFilter ? ` ${STATUS_META[statusFilter].label.toLowerCase()}` : ""
    } items.`;
  }

  const header = `<b>${esc(proj.data.name)}</b>`;
  if (statusFilter) {
    const lines = r.data.map((it) => `  ${itemLine(it)}`);
    return `${header} — ${STATUS_META[statusFilter].emoji} ${
      STATUS_META[statusFilter].label
    }\n${lines.join("\n")}`;
  }
  // Grouped by column when no filter.
  const sections: string[] = [];
  for (const st of STATUS_ORDER) {
    const group = r.data.filter((it) => it.status === st);
    if (!group.length) continue;
    const m = STATUS_META[st];
    sections.push(
      `${m.emoji} <b>${m.label}</b> (${group.length})\n${group
        .map((it) => `  ${itemLine(it)}`)
        .join("\n")}`,
    );
  }
  return `${header}\n${sections.join("\n\n")}`;
}

async function cmdAdd(
  sb: SupabaseClient,
  actor: string,
  args: string,
): Promise<string> {
  const trimmed = args.trim();
  const sp = trimmed.search(/\s/);
  if (sp < 0) return err("Usage: /add <project> <text>");
  const projRef = trimmed.slice(0, sp);
  const rest = trimmed.slice(sp + 1).trim();
  if (!rest) return err("Usage: /add <project> <text>");
  const proj = await resolveProjectRef(sb, actor, projRef);
  if (!proj.ok) return err(proj.error);

  // First line is the title; any remaining lines become an opening note body.
  const nl = rest.indexOf("\n");
  const name = nl < 0 ? rest : rest.slice(0, nl).trim();
  const created = await createItem(sb, actor, proj.data.id, { name });
  if (!created.ok) return err(created.error);
  const detail = await getItem(sb, actor, created.data.id);
  if (!detail.ok) return err(detail.error);
  return `✅ Added <code>${esc(detail.data.ref)}</code> to <b>${esc(
    proj.data.name,
  )}</b>\n${esc(detail.data.name)}`;
}

async function cmdItem(
  sb: SupabaseClient,
  actor: string,
  args: string,
): Promise<string> {
  const ref = args.trim();
  if (!ref) return err("Usage: /item <ref>");
  const r = await getItem(sb, actor, ref);
  if (!r.ok) return err(r.error);
  const it = r.data;
  const m = STATUS_META[it.status];
  const lines = [
    `<code>${esc(it.ref)}</code> ${m.emoji} <b>${m.label}</b>`,
    `${esc(it.name)}`,
  ];
  if (it.area) lines.push(`📁 ${esc(it.area)}`);
  if (it.tags.length) lines.push(`🏷️ ${it.tags.map((t) => `#${esc(t)}`).join(" ")}`);
  if (it.assignees.length) lines.push(`👤 ${it.assignees.map(esc).join(", ")}`);
  return lines.join("\n");
}

async function cmdStatus(
  sb: SupabaseClient,
  actor: string,
  args: string,
): Promise<string> {
  const tokens = args.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return err("Usage: /status <ref> <new|doing|blocked|done>");
  }
  const ref = tokens[0];
  const status = parseStatus(tokens[1]);
  if (!status) return err(`Unknown status: ${tokens[1]}`);
  const r = await setItemStatus(sb, actor, ref, status, "telegram");
  if (!r.ok) return err(r.error);
  const m = STATUS_META[r.data.status];
  return `${m.emoji} <code>${esc(r.data.ref)}</code> → <b>${m.label}</b>\n${esc(
    r.data.name,
  )}`;
}

async function cmdTags(
  sb: SupabaseClient,
  actor: string,
  args: string,
): Promise<string> {
  const ref = args.trim();
  if (!ref) return err("Usage: /tags <ref>");
  const r = await getItem(sb, actor, ref);
  if (!r.ok) return err(r.error);
  if (!r.data.tags.length) {
    return `<code>${esc(r.data.ref)}</code> has no tags. Add with <code>/tag ${esc(
      r.data.ref,
    )} +tag</code>`;
  }
  return `<code>${esc(r.data.ref)}</code> tags: ${r.data.tags
    .map((t) => `#${esc(t)}`)
    .join(" ")}`;
}

async function cmdTag(
  sb: SupabaseClient,
  actor: string,
  args: string,
): Promise<string> {
  const tokens = args.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return err("Usage: /tag <ref> +add -remove");
  }
  const ref = tokens[0];
  const cur = await getItem(sb, actor, ref);
  if (!cur.ok) return err(cur.error);

  const adds: string[] = [];
  const removes: string[] = [];
  for (const tok of tokens.slice(1)) {
    if (tok.startsWith("-")) {
      const v = tok.slice(1).trim().toLowerCase();
      if (v) removes.push(v);
    } else {
      const v = tok.replace(/^\+/, "").trim().toLowerCase();
      if (v) adds.push(v);
    }
  }
  if (!adds.length && !removes.length) {
    return err("Nothing to change. Use +tag to add, -tag to remove.");
  }
  const removeSet = new Set(removes);
  const next = cur.data.tags.filter((t) => !removeSet.has(t));
  for (const a of adds) if (!next.includes(a)) next.push(a);

  const r = await setItemTags(sb, actor, ref, next, "telegram");
  if (!r.ok) return err(r.error);
  const after = r.data.tags.length
    ? r.data.tags.map((t) => `#${esc(t)}`).join(" ")
    : "(none)";
  return `🏷️ <code>${esc(r.data.ref)}</code> tags: ${after}`;
}

async function cmdArea(
  sb: SupabaseClient,
  actor: string,
  args: string,
): Promise<string> {
  const trimmed = args.trim();
  if (!trimmed) return err("Usage: /area <ref> <path>  (omit path to un-file)");
  // A bare "/area <ref>" (no path) un-files the item.
  const sp = trimmed.search(/\s/);
  const ref = sp < 0 ? trimmed : trimmed.slice(0, sp);
  const path = sp < 0 ? "" : trimmed.slice(sp + 1).trim();
  const r = await setItemArea(sb, actor, ref, path, "telegram");
  if (!r.ok) return err(r.error);
  return r.data.area
    ? `📁 <code>${esc(r.data.ref)}</code> filed under <b>${esc(r.data.area)}</b>`
    : `📂 <code>${esc(r.data.ref)}</code> un-filed`;
}

/**
 * Turn one Telegram text line into a reply (HTML). Unknown input shows help.
 * `actor` is the mykan identity to act as (defaults to the owner via the route).
 */
export async function handleTelegramCommand(
  sb: SupabaseClient,
  actor: string,
  text: string,
): Promise<string> {
  const raw = String(text ?? "").trim();
  if (!raw) return HELP;
  // First whitespace-delimited token is the command; strip a "@BotName" suffix.
  const firstWs = raw.search(/\s/);
  const head = firstWs < 0 ? raw : raw.slice(0, firstWs);
  const args = firstWs < 0 ? "" : raw.slice(firstWs + 1).trim();
  let cmd = head.toLowerCase();
  const at = cmd.indexOf("@");
  if (at >= 0) cmd = cmd.slice(0, at);

  switch (cmd) {
    case "/start":
    case "/help":
      return HELP;
    case "/projects":
      return cmdProjects(sb, actor);
    case "/list":
      return cmdList(sb, actor, args);
    case "/add":
      return cmdAdd(sb, actor, args);
    case "/item":
      return cmdItem(sb, actor, args);
    case "/status":
    case "/move":
      return cmdStatus(sb, actor, args);
    case "/tags":
      return cmdTags(sb, actor, args);
    case "/tag":
      return cmdTag(sb, actor, args);
    case "/area":
      return cmdArea(sb, actor, args);
    default:
      return `Unknown command: ${esc(cmd)}\n\n${HELP}`;
  }
}
