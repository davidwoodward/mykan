// Renaming a project key (KANBAN-45, David 2026-09-17).
//
// A key can be renamed; the old key is kept as an alias of the project so every
// link and ref written with it keeps working (/OLD-7 redirects to /NEW-7, and
// MCP tools accept OLD-7). Pure: no React, no database, so the rules run under
// `node --test` and are shared by the API and the project edit panel. The
// database enforces the same rules (supabase/migrations/
// 2026-09-17-1-project-key-aliases.sql); these are the clear messages up front.

import { keyError, projectPath } from "./card-url.ts";

export type KeyWriteError = { error: string; status: number };

/**
 * Why `next` can't become the key of project `projectId` (null for a new
 * project), or null when it can. The caller looks up who holds `next` today:
 * `keyOwnerId` is the project whose current key it is, `aliasOwnerId` the
 * project it is an old key of. Expects the normalised (uppercase) key.
 */
export function keyWriteError(input: {
  next: string;
  projectId: string | null;
  keyOwnerId: string | null;
  aliasOwnerId: string | null;
}): KeyWriteError | null {
  const { next, projectId, keyOwnerId, aliasOwnerId } = input;
  const bad = keyError(next);
  if (bad) return { error: bad, status: 400 };
  if (keyOwnerId && keyOwnerId !== projectId) {
    return { error: `The key ${next} is already used by another project`, status: 409 };
  }
  if (aliasOwnerId && aliasOwnerId !== projectId) {
    return {
      error: `The key ${next} is an old key of another project, and old links to it still go there. Choose another key.`,
      status: 409,
    };
  }
  return null;
}

/** The warning shown before a rename is saved. */
export type KeyRenameWarning = {
  title: string;
  lines: string[];
};

/**
 * What changes when `from` becomes `to`, and what keeps working. `sample` is a
 * card number for the example (FPOON-12 becomes FP-12). `ownOldKey` is true
 * when `to` is one of this project's own old keys.
 */
export function keyRenameWarning(input: {
  from: string;
  to: string;
  sample?: number;
  ownOldKey?: boolean;
}): KeyRenameWarning {
  const { from, to, ownOldKey = false } = input;
  const n = input.sample && input.sample > 0 ? input.sample : 12;
  const lines = [
    `Every card ref becomes ${to}-N (${from}-${n} becomes ${to}-${n}) and the board moves to ${projectPath(to)}.`,
    `Old links and refs keep working: ${projectPath(from)} and ${from}-${n} lead to ${projectPath(to)} and ${to}-${n}, in the app and over MCP. ${from} stays with this project.`,
    `Text already written (card text, commits, notes) is not rewritten.`,
  ];
  if (ownOldKey) lines.push(`${to} was this project's key before; it becomes the current key again.`);
  return { title: `Rename key ${from} to ${to}?`, lines };
}

/**
 * Where the browser should go after a rename, from the page it is on: the
 * board /FROM becomes /TO, a card /FROM-7 becomes /TO-7. null when the path is
 * not one of this project's pages (stay, just refresh).
 */
export function pathAfterRename(pathname: string, from: string, to: string): string | null {
  if (pathname === `/${from}`) return `/${to}`;
  const m = /^\/([A-Z][A-Z0-9]*)-(\d+)$/.exec(pathname);
  if (m && m[1] === from) return `/${to}-${m[2]}`;
  return null;
}
