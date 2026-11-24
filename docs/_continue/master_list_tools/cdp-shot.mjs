import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
const S = process.argv[2];
const { base, cookie } = JSON.parse(readFileSync(`${S}/server.json`, "utf8"));
const freePort = () => new Promise((res) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => res(port)); }); });
const port = await freePort();
const profile = mkdtempSync(`${S}/chrome-`);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: "ignore" });
let ver;
for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await new Promise(r => setTimeout(r, 200)); } }
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}, sessionId) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
const { result: { targetId } } = await send("Target.createTarget", { url: "about:blank" });
const { result: { sessionId } } = await send("Target.attachToTarget", { targetId, flatten: true });
const s = (m, p) => send(m, p, sessionId);
await s("Page.enable"); await s("Network.enable");
await s("Network.setCookie", { name: "authjs.session-token", value: cookie, url: base });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const evalJs = async (expr) => (await s("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
async function shot(name, { width = 1280, height = 900, dark = false, mobile = false, before, path = "/" } = {}) {
  await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await s("Page.navigate", { url: base + path });
  await wait(300);
  await evalJs(`localStorage.setItem("theme", "${dark ? "dark" : "light"}")`);
  await s("Page.navigate", { url: base + path });
  await wait(3500);
  if (before) { await evalJs(before); await wait(1200); }
  const { result } = await s("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(`${S}/${name}.png`, Buffer.from(result.data, "base64"));
  console.log("wrote", name);
}
const steps = JSON.parse(process.argv[3]);
for (const st of steps) await shot(st.name, st);
await send("Browser.close").catch(() => {});
await wait(500);
try { process.kill(chrome.pid, "SIGTERM"); } catch {}
process.exit(0);
