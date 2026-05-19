import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const DEFAULT_WHITELIST = ["dawoodward@gmail.com", "matthewl@experiencealign.com"];

function whitelist(): string[] {
  const fromEnv = process.env.AUTH_ALLOWED_EMAILS;
  const raw = fromEnv ? fromEnv.split(",") : DEFAULT_WHITELIST;
  return raw.map((e) => e.trim().toLowerCase()).filter(Boolean);
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
