import type { NextConfig } from "next";
import {
  SIMPLE_SECURITY_HEADERS,
  STATIC_CSP,
  STATIC_CSP_PATHS,
} from "./lib/security-headers.ts";

const nextConfig: NextConfig = {
  // No `X-Powered-By: Next.js`: it tells a scanner what to try, and nothing
  // reads it.
  poweredByHeader: false,
  // The headers every response gets, static assets included. The page CSP is
  // NOT here: it carries a per-request nonce, so proxy.ts sets it. Only the
  // paths the proxy does not match get the static CSP (lib/security-headers.ts
  // says why the two must never overlap). KANBAN-61.
  async headers() {
    return [
      { source: "/:path*", headers: [...SIMPLE_SECURITY_HEADERS] },
      ...STATIC_CSP_PATHS.map((source) => ({
        source,
        headers: [{ key: "Content-Security-Policy", value: STATIC_CSP }],
      })),
    ];
  },
};

export default nextConfig;
