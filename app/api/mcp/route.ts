import { createGatedMcpHandler } from "@/lib/mcp-server";

// Backward-compatible endpoint. `/mcp` (app/mcp/route.ts) is the canonical URL
// as of KANBAN-30; this legacy path is kept working so existing
// `claude mcp add … https://kanban.dbwoodward.com/api/mcp` registrations don't
// break. basePath "/api" makes the handler serve at /api/mcp.
const handler = createGatedMcpHandler("/api");

export { handler as GET, handler as POST, handler as DELETE };
