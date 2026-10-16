/**
 * Smoke test of the auth gate and the security headers against a REAL
 * production build, the way Vercel runs it.
 *
 *   npm run smoke:auth-gate               # next build, then next start, then checks
 *   npm run smoke:auth-gate -- --no-build # reuse the existing .next build
 *
 * Unit tests check the matcher and the gate's decisions in isolation; this
 * checks the assembled proxy: that a signed-out request to a screen (or a
 * server-action POST, or /gallery) is redirected, and that a signed-in one
 * renders with exactly one CSP, a nonce on every script, and next-auth's
 * refreshed session cookie kept.
 *
 * Uses a THROWAWAY random AUTH_SECRET for the server and mints a session
 * cookie for a fake address with it, so it needs no real credential and
 * prints none. The server picks a free port and is stopped by its own PID.
 * `next start` still loads .env.local, so the signed-in screens READ the real
 * database as that fake address (who owns nothing and is shared nothing);
 * nothing is written. Without .env.local those screens 500, and the
 * signed-in checks fail. (KANBAN-61, ported from lobe.)
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { encode } from "@auth/core/jwt";

const root = fileURLToPath(new URL("..", import.meta.url));
const nextBin = `${root}node_modules/.bin/next`;
const SESSION_COOKIE = "authjs.session-token"; // the name over http

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

if (!process.argv.includes("--no-build")) {
  console.log("next build ...");
  const b = spawnSync(nextBin, ["build"], { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
  if (b.status !== 0) {
    console.error("next build failed");
    process.exit(1);
  }
}

const secret = randomBytes(32).toString("base64");
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const server = spawn(nextBin, ["start", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: root,
  env: { ...process.env, NODE_ENV: "production", AUTH_SECRET: secret, AUTH_TRUST_HOST: "true" },
  stdio: ["ignore", "ignore", "ignore"],
});
console.log(`next start on ${base} (pid ${server.pid})`);

const stop = async () => {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise((r) => server.once("exit", r));
  server.kill("SIGTERM");
  const late = setTimeout(() => server.kill("SIGKILL"), 5000);
  await exited;
  clearTimeout(late);
};

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    up = await fetch(`${base}/robots.txt`).then((r) => r.ok, () => false);
    if (!up) await new Promise((r) => setTimeout(r, 500));
  }
  if (!up) throw new Error("server did not come up");

  const get = (path: string, init: RequestInit = {}) =>
    fetch(`${base}${path}`, { redirect: "manual", ...init });

  console.log("\nsigned out:");
  for (const path of ["/", "/KANBAN-1", "/projects/x", "/KANBAN-1.png", "/next.svg", "/icons", "/apple-icon"]) {
    const r = await get(path);
    const loc = r.headers.get("location") ?? "";
    check(r.status === 307 && loc.startsWith("/signin"), `GET ${path} redirects to /signin`, `${r.status} ${loc}`);
  }
  const rsc = await get("/", { headers: { RSC: "1" } });
  check(rsc.status === 307, "RSC GET / redirects", String(rsc.status));
  const action = await get("/", {
    method: "POST",
    headers: { "Next-Action": "0".repeat(42), "content-type": "text/plain" },
    body: "[]",
  });
  check(action.status === 307, "server-action POST / redirects", String(action.status));
  const signin = await get("/signin");
  check(signin.status === 200, "GET /signin is 200", String(signin.status));
  check(/'nonce-/.test(signin.headers.get("content-security-policy") ?? ""), "/signin carries the nonce CSP");
  const api = await get("/api/projects");
  check(
    api.status === 401 && (api.headers.get("content-type") ?? "").includes("application/json"),
    "GET /api/projects is a 401 JSON (the route gates itself)",
    `${api.status} ${api.headers.get("content-type")}`,
  );
  for (const path of ["/mcp", "/api/mcp"]) {
    const r = await get(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    check(
      r.status === 401 && (r.headers.get("content-type") ?? "").includes("application/json"),
      `POST ${path} without a token is a 401 JSON, not a redirect`,
      `${r.status} ${r.headers.get("content-type")}`,
    );
  }
  const tg = await get("/api/telegram", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  check(!tg.headers.get("location"), "POST /api/telegram without its secret is not redirected", String(tg.status));
  for (const path of ["/icon", "/apple-icon.png", "/robots.txt"]) {
    const r = await get(path);
    const csp = r.headers.get("content-security-policy") ?? "";
    check(r.status === 200 && csp.startsWith("default-src 'none'"), `GET ${path} is 200 with the static CSP`, String(r.status));
  }
  const robots = await (await get("/robots.txt")).text();
  check(/Disallow: \/\s*$/m.test(robots), "robots.txt disallows everything");
  const sec = await get("/.well-known/security.txt");
  check(sec.status === 404 && !sec.headers.get("location"), "/.well-known/security.txt is a plain 404", String(sec.status));

  console.log("\nsigned in (minted cookie, throwaway secret):");
  const token = await encode({
    token: { name: "Smoke", email: "smoke@example.invalid", sub: "smoke" },
    secret,
    salt: SESSION_COOKIE,
  });
  for (const path of ["/", "/signin"]) {
    const r = await get(path, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    const html = await r.text();
    check(r.status === 200, `GET ${path} is 200`, String(r.status));
    const csp = r.headers.get("content-security-policy") ?? "";
    // Headers.get joins repeats with ", "; a CSP never contains one.
    check(csp !== "" && !csp.includes(", "), `${path} carries exactly one CSP`);
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    const nonced = scripts.filter((s) => nonce && s.includes(`nonce="${nonce}"`));
    check(
      !!nonce && scripts.length > 0 && nonced.length === scripts.length,
      `${path}: every <script> carries this response's nonce`,
      `${nonced.length}/${scripts.length}`,
    );
    const cookies = r.headers.getSetCookie().filter((c) => c.startsWith(`${SESSION_COOKIE}=`));
    check(cookies.length === 1, `${path}: next-auth's refreshed session cookie is kept`, `${cookies.length} Set-Cookie`);
    check(r.headers.get("x-powered-by") === null, `${path}: no X-Powered-By`);
    check(r.headers.get("x-frame-options") === "DENY", `${path}: X-Frame-Options DENY`);
    check(r.headers.get("x-content-type-options") === "nosniff", `${path}: nosniff`);
  }
} catch (e) {
  console.error(String(e));
  failures++;
} finally {
  await stop();
  console.log(`\nserver pid ${server.pid} stopped (${server.signalCode ?? server.exitCode})`);
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
