export { auth as proxy } from "@/lib/auth";

export const config = {
  matcher: [
    "/((?!api/auth|api/mcp|mcp|api/telegram|icon|apple-icon|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
