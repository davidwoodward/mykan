import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function requireSession() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    } as const;
  }
  return { session, email } as const;
}
