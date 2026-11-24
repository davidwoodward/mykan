import { NextResponse } from "next/server";
import type { CoreResult } from "@/lib/projects-core";

/** A focus core result as a JSON response. */
export function respond<T>(r: CoreResult<T>, okStatus = 200): NextResponse {
  return r.ok
    ? NextResponse.json(r.data, { status: okStatus })
    : NextResponse.json({ error: r.error }, { status: r.status });
}

/** The request's JSON object body, or {} when absent or not an object. */
export async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}
