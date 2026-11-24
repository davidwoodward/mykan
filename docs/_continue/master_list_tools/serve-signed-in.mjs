import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { writeFileSync } from "node:fs";
import { encode } from "@auth/core/jwt";
const root = process.cwd() + "/";
const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const secret = randomBytes(32).toString("base64");
const port = await freePort();
const server = spawn(`${root}node_modules/.bin/next`, ["start", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: root, env: { ...process.env, NODE_ENV: "production", AUTH_SECRET: secret, AUTH_TRUST_HOST: "true" }, stdio: "ignore", detached: false,
});
const token = await encode({ token: { name: "Focus Check", email: "focus-check@example.invalid", sub: "focus-check" }, secret, salt: "authjs.session-token" });
writeFileSync(process.argv[2], JSON.stringify({ base: `http://127.0.0.1:${port}`, cookie: token, pid: server.pid }));
console.log("server pid", server.pid, "port", port);
process.on("SIGTERM", () => { server.kill("SIGTERM"); process.exit(0); });
setInterval(() => {}, 1 << 30);
