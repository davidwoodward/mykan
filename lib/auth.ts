import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const DEFAULT_WHITELIST = [
  "dawoodward@gmail.com",
  "matthewl@experiencealign.com",
  "dwoody55@gmail.com",
];
const DEFAULT_OWNER = "dawoodward@gmail.com";

/**
 * The whitelisted member emails (lowercased). These are the people who can sign
 * in, and — for shared projects — the candidate assignees. Override with the
 * AUTH_ALLOWED_EMAILS env var (comma-separated).
 */
export function whitelist(): string[] {
  const fromEnv = process.env.AUTH_ALLOWED_EMAILS;
  const raw = fromEnv ? fromEnv.split(",") : DEFAULT_WHITELIST;
  return raw.map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/**
 * The single owner/admin who may mark projects private and is the only user who
 * sees private projects (and the Private/Public control). Everyone else sees
 * only public projects. Override with the OWNER_EMAIL env var.
 */
export function ownerEmail(): string {
  return (process.env.OWNER_EMAIL ?? DEFAULT_OWNER).trim().toLowerCase();
}

export function isOwner(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === ownerEmail();
}

/**
 * The identity the MCP (service) caller acts as. Defaults to the owner so the
 * agent sees every project (incl. private) and stamps authorship as the owner.
 * Override with MCP_ACTOR_EMAIL.
 */
export function mcpActorEmail(): string {
  return (process.env.MCP_ACTOR_EMAIL ?? ownerEmail()).trim().toLowerCase();
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
      const email = profile?.email?.toLowerCase();
      return !!email && whitelist().includes(email);
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
