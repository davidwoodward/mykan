"use server";

import { signOut } from "@/lib/auth";

/**
 * Sign the current user out and return to /signin. Extracted as a standalone
 * server action so the client-side ProfileMenu can drive it from inside its
 * dropdown (a "use server" inline action can't live in a client component).
 */
export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}
