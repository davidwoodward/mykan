"use client";

import { createContext, useContext, useEffect } from "react";

/**
 * Finish an open editor: save once if something changed. Resolves whether it's
 * safe to leave (false = the save failed and the editor stays, text intact).
 */
export type Finisher = () => Promise<boolean>;

/**
 * The card page's open editors (KANBAN-38). The description editor and every
 * open entry editor register here, so leaving the page (Esc, the back arrow, a
 * card link) finishes ALL of them before navigating, and stays when any save
 * fails. Registration returns its own unregister.
 */
export const CardFinishContext = createContext<(finish: Finisher) => () => void>(
  () => () => {},
);

/** Register `finish` with the page for as long as the caller is mounted. */
export function useRegisterFinisher(finish: Finisher) {
  const register = useContext(CardFinishContext);
  useEffect(() => register(finish), [register, finish]);
}
