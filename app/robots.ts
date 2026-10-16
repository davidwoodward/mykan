import type { MetadataRoute } from "next";

/**
 * mykan is a private, signed-in app: nothing on it is for a search engine.
 * proxy.ts lets /robots.txt past the auth gate, because a crawler redirected
 * to /signin gets an HTML page, which is not a valid robots file (KANBAN-61).
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
