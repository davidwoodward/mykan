// The focus list is owner-only (KANBAN-75). The app reaches Supabase with the
// service role, which bypasses RLS, so privacy rests on every focus query
// filtering by the acting user's email. These tests read the source and pin
// that, the way proxy-matcher.test.ts pins the proxy's matcher.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { displayProjects } from "./focus-rules.ts";

const ROOT = join(import.meta.dirname, "..");
const core = readFileSync(join(ROOT, "lib", "focus-core.ts"), "utf8");

/** Each query chain that starts at .from("focus_…"), up to the end of its statement. */
function focusChains(src: string): string[] {
  const out: string[] = [];
  const re = /\.from\("focus_(entries|settings)"\)/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let depth = 0;
    let i = m.index;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === "(" || ch === "{" || ch === "[") depth++;
      else if (ch === ")" || ch === "}" || ch === "]") {
        if (depth === 0) break;
        depth--;
      } else if (ch === ";" && depth === 0) break;
    }
    out.push(src.slice(m.index, i));
  }
  return out;
}

test("every focus query in focus-core is scoped to the acting user", () => {
  const chains = focusChains(core);
  assert.ok(chains.length >= 10, `expected the focus queries, found ${chains.length}`);
  for (const c of chains) {
    const scoped =
      /\.eq\("user_email", actor\)/.test(c) || // reads, updates
      /user_email: actor\b/.test(c); // inserts, upserts
    assert.ok(scoped, `focus query not scoped to the actor:\n${c}`);
  }
});

test("no function in focus-core takes another person's email", () => {
  assert.doesNotMatch(core, /\b(other|target|owner)Email\b/);
  // Every row written carries user_email: actor (the type declaration aside).
  const writes = core.match(/user_email:\s*\w+/g) ?? [];
  assert.deepEqual([...new Set(writes.map((w) => w.split(/:\s*/)[1]))].sort(), ["actor", "string"]);
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === "node_modules" || name.startsWith(".")) return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

test("only focus-core touches the focus tables", () => {
  const offenders = [...walk(join(ROOT, "lib")), ...walk(join(ROOT, "app")), ...walk(join(ROOT, "components"))]
    .filter((p) => !p.endsWith("focus-core.ts") && !p.endsWith(".test.ts"))
    .filter((p) => /from\("focus_(entries|settings)"\)/.test(readFileSync(p, "utf8")));
  assert.deepEqual(offenders, []);
});

test("every focus API route gates on the session (or the brief's token)", () => {
  const dir = join(ROOT, "app", "api", "focus");
  const routes = walk(dir).filter((p) => p.endsWith("route.ts"));
  assert.ok(routes.length >= 6);
  for (const r of routes) {
    const src = readFileSync(r, "utf8");
    const handlers = src.match(/export async function (GET|POST|PUT|PATCH|DELETE)/g) ?? [];
    const gates = (src.match(/requireSession\(\)/g) ?? []).length;
    const brief = r.includes(join("focus", "brief"));
    assert.ok(brief ? /verifyMcpToken/.test(src) && /auth\(\)/.test(src) : gates === handlers.length, `ungated handler in ${r}`);
  }
});

test("personal projects are hidden from project lists", () => {
  const list = [
    { id: "a", is_personal: false },
    { id: "me", is_personal: true },
    { id: "old" }, // rows from before the column existed
  ];
  assert.deepEqual(displayProjects(list).map((p) => p.id), ["a", "old"]);
});

test("every project-list surface filters personal projects", () => {
  for (const f of ["app/api/projects/route.ts", "lib/mcp-server.ts", "lib/telegram.ts"]) {
    assert.match(readFileSync(join(ROOT, f), "utf8"), /displayProjects\(/, f);
  }
});

test("a personal project can't be shared", () => {
  const api = readFileSync(join(ROOT, "app", "api", "projects", "[id]", "route.ts"), "utf8");
  assert.match(api, /is_personal[\s\S]{0,120}stays private/);
  const header = readFileSync(join(ROOT, "components", "ProjectHeader.tsx"), "utf8");
  assert.match(header, /!project\.is_personal/);
});
