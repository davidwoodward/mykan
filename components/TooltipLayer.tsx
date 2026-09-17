"use client";

import { useEffect } from "react";
import { mountTooltipLayer } from "@/lib/tooltip-layer";

/**
 * The app-wide tooltip layer (KANBAN-47), mounted once in app/layout.tsx: every
 * element with a `title` gets a prompt styled tooltip instead of the slow
 * native one. All the behavior lives in lib/tooltip-layer.ts; this only mounts
 * it on the client. Renders nothing itself (the tip element goes on <body>).
 */
export function TooltipLayer() {
  useEffect(() => mountTooltipLayer(document), []);
  return null;
}
