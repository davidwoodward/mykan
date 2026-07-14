import { createGatedMcpHandler } from "@/lib/mcp-server";

// Canonical MCP endpoint (KANBAN-30): https://kanban.dbwoodward.com/mcp.
// basePath "" makes mcp-handler serve the streamable HTTP transport at /mcp.
// Excluded from the session proxy (proxy.ts) and self-gated by a per-user bearer
// token (or the transitional shared key). Connect with:
//   claude mcp add --transport http mykan https://kanban.dbwoodward.com/mcp \
//     --header "Authorization: Bearer <your mk_… token>"
const handler = createGatedMcpHandler("");

export { handler as GET, handler as POST, handler as DELETE };
