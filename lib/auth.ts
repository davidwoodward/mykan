import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { currentMcpActor } from "@/lib/mcp-actor-context";
import { canonicalEmail } from "@/lib/types";

const DEFAULT_WHITELIST = [
  "dawoodward@gmail.com",
  "matthewl@experiencealign.com",
  "dwoody55@gmail.com",
  "kenyon.congdon@permitsaige.com",
  "cherie.woodward.27@gmail.com",
];
const DEFAULT_OWNER = "dawoodward@gmail.com";

/**
 * The whitelisted member emails, canonicalised (see `canonicalEmail`). These are
 * the people who can sign in, and — for shared projects — the candidate
 * assignees. Override with the AUTH_ALLOWED_EMAILS env var (comma-separated).
 *
 * Canonicalising here means a Gmail address may be written either way in the
 * list or the env var and still match; it is also the exact form stored in
 * `projects.shared_with` and `items.assignees`, because the signed-in identity
 * is canonicalised too (see the `jwt` callback).
 */
export function whitelist(): string[] {
  const fromEnv = process.env.AUTH_ALLOWED_EMAILS;
  const raw = fromEnv ? fromEnv.split(",") : DEFAULT_WHITELIST;
  const out: string[] = [];
  for (const e of raw) {
    const v = canonicalEmail(e);
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * The single owner/admin who may mark projects private and is the only user who
 * sees private projects (and the Private/Public control). Everyone else sees
 * only public projects. Override with the OWNER_EMAIL env var.
 */
export function ownerEmail(): string {
  return canonicalEmail(process.env.OWNER_EMAIL ?? DEFAULT_OWNER);
}

export function isOwner(email: string | null | undefined): boolean {
  return !!email && canonicalEmail(email) === ownerEmail();
}

/**
 * The identity the MCP caller acts as for the CURRENT request. With per-user
 * tokens (KANBAN-30) the route gate resolves the token → user and runs the
 * handler inside runAsMcpActor(), so this returns that user's email — every tool
 * then uses that user's GitHub PAT (no credential borrowing).
 *
 * Falls back to the shared-key default (MCP_ACTOR_EMAIL, else the owner) when no
 * per-request actor is set — i.e. the transitional shared MYKAN_SERVICE_API_KEY
 * path, which still authenticates as the owner.
 */
export function mcpActorEmail(): string {
  const perRequest = currentMcpActor();
  if (perRequest) return perRequest;
  return defaultMcpActorEmail();
}

/** The identity the shared MYKAN_SERVICE_API_KEY authenticates as (owner). */
export function defaultMcpActorEmail(): string {
  return canonicalEmail(process.env.MCP_ACTOR_EMAIL ?? ownerEmail());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  callbacks: {
    signIn({ profile }) {
      const email = canonicalEmail(profile?.email);
      return !!email && whitelist().includes(email);
    },
    /**
     * The signed-in identity, canonicalised. Everything downstream compares this
     * email as an exact string — `listProjects` and `loadProjectForAccess`
     * against `projects.shared_with`, `normalizeAssignees` against the whitelist
     * — so it has to be the same spelling those hold. Auth.js builds
     * `session.user.email` from `token.email` and runs this callback on every
     * session read, so existing sessions are folded on their next request too.
     *
     * A no-op for every address whose canonical form is itself, which is all
     * four accounts that predate this.
     */
    jwt({ token }) {
      if (token.email) token.email = canonicalEmail(token.email);
      return token;
    },
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      if (pathname.startsWith("/signin")) return true;
      // API routes gate themselves (requireSession / service key) and must answer
      // with their own JSON — including a 401 when unauthenticated. If the proxy
      // instead redirects them to the /signin HTML page, any client `fetch().json()`
      // blows up with "Unexpected token '<', <!DOCTYPE …". Let /api through and let
      // the route decide.
      if (pathname.startsWith("/api/")) return true;
      return !!auth?.user;
    },
  },
});
