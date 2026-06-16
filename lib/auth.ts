import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const DEFAULT_WHITELIST = ["dawoodward@gmail.com", "matthewl@experiencealign.com"];
const DEFAULT_OWNER = "dawoodward@gmail.com";

function whitelist(): string[] {
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
      return !!auth?.user;
    },
  },
});
