import { readFileSync } from "node:fs";
const [mig, reh] = process.argv.slice(2);
const ref = process.env.SUPABASE_PROJECT_REF || readFileSync("supabase/.temp/project-ref", "utf8").trim();
const sql = `begin;\n${readFileSync(mig, "utf8")}\n${readFileSync(reh, "utf8")}\nrollback;`;
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
console.log(res.status, text.replace(/\\n/g, "\n"));
