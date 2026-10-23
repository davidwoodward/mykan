// Planning for "Sync with GitHub" (KANBAN-65): which cards to check, grouped by
// repo, and which of them to move once each repo's closed issues are known.
// Pure — no database, no network. The I/O lives in lib/github-core.ts.
import { parseGithubIssue, type GithubSync, type ItemStatus } from "./types.ts";

/** The fields of a card the sync plan reads. */
export type SyncCandidate = {
  id: string;
  number: number;
  status: ItemStatus;
  archived_at: string | null;
  github_issue: string | null;
  github_imported_at: string | null;
  /** Set when a write-back failed: the issue may not match the card's status. */
  github_sync: GithubSync;
};

/** One repo's cards to check, keyed by issue number. */
export type RepoCheck = {
  owner: string;
  repo: string;
  /** Issue number → the cards linked to it (normally exactly one). */
  cards: Map<number, SyncCandidate[]>;
  /**
   * The earliest import time among these cards, or null when any card lacks
   * one. An issue can only have been closed after its card was imported (import
   * takes open issues only), so closed issues updated before this can be skipped.
   */
  since: string | null;
};

/**
 * Group the cards that need checking by repo: non-archived, not Done, with a
 * parseable backlink. Repos are keyed case-insensitively (GitHub logins and repo
 * names are), keeping the first spelling seen for display and requests.
 */
export function planRepoChecks(cards: SyncCandidate[]): RepoCheck[] {
  const byRepo = new Map<string, RepoCheck & { missingSince: boolean }>();
  for (const card of cards) {
    if (card.archived_at || card.status === "done") continue;
    const link = parseGithubIssue(card.github_issue);
    if (!link) continue;
    const key = `${link.owner}/${link.repo}`.toLowerCase();
    let check = byRepo.get(key);
    if (!check) {
      check = { owner: link.owner, repo: link.repo, cards: new Map(), since: null, missingSince: false };
      byRepo.set(key, check);
    }
    const list = check.cards.get(link.number) ?? [];
    list.push(card);
    check.cards.set(link.number, list);
    if (!card.github_imported_at) check.missingSince = true;
    else if (!check.since || card.github_imported_at < check.since) check.since = card.github_imported_at;
  }
  return [...byRepo.values()].map(({ missingSince, ...check }) => ({
    ...check,
    since: missingSince ? null : check.since,
  }));
}

/**
 * The cards in a repo check whose issue number is among the closed ones, split
 * into those to move to Done and those to leave alone. A card flagged not synced
 * is left alone: its issue may be closed only because a reopen failed after
 * someone moved the card out of Done, and Sync must not undo that move.
 */
export function cardsToClose(
  check: RepoCheck,
  closedNumbers: Iterable<number>,
): { close: SyncCandidate[]; notSynced: SyncCandidate[] } {
  const hit: SyncCandidate[] = [];
  for (const n of closedNumbers) hit.push(...(check.cards.get(n) ?? []));
  hit.sort((a, b) => a.number - b.number);
  return {
    close: hit.filter((c) => !c.github_sync),
    notSynced: hit.filter((c) => c.github_sync),
  };
}

/** A card Sync moved to Done because its GitHub issue was closed. */
export interface SyncMovedCard {
  ref: string;
  /** The backlink, `owner/repo#number`. */
  issue: string;
}

/** What one Sync with GitHub run did (the API and MCP response). */
export interface SyncSummary {
  account: string | null;
  /** No usable PAT for the project's account: nothing was imported or moved. */
  needs_connect?: { account: string; reason: "missing" | "invalid" };
  /** Refs of cards created for new open issues, across every repo-linked area. */
  imported: string[];
  /** Cards moved to Done because their issue was closed on GitHub. */
  moved: SyncMovedCard[];
  /** Cards whose issue is closed but which are flagged not synced: left where they are. */
  not_synced: SyncMovedCard[];
  /** Per-repo problems (bad repo, GitHub error, a card that couldn't move). */
  errors: { repo: string; error: string }[];
}

/** The board's one-line result after a sync, with a tone for its colour. */
export function syncMessage(s: SyncSummary): { text: string; tone: "ok" | "warn" | "err" } {
  if (s.needs_connect) {
    const verb = s.needs_connect.reason === "invalid" ? "Reconnect" : "Connect";
    return { text: `${verb} GitHub for ${s.needs_connect.account} (top bar) to sync.`, tone: "warn" };
  }
  const parts: string[] = [];
  if (s.moved.length) {
    parts.push(`Moved ${s.moved.length} to Done: ${s.moved.map((m) => m.ref).join(", ")}`);
  }
  if (s.imported.length) {
    parts.push(`Imported ${s.imported.length}: ${s.imported.join(", ")}`);
  }
  if (s.not_synced.length) {
    parts.push(
      `Left ${s.not_synced.map((m) => m.ref).join(", ")} where ${s.not_synced.length === 1 ? "it is" : "they are"} (not synced; issue closed on GitHub)`,
    );
  }
  for (const e of s.errors) parts.push(`${e.repo}: ${e.error}`);
  if (!parts.length) return { text: "Up to date with GitHub.", tone: "ok" };
  const text = parts.join(" · ");
  // GitHub error strings already end in a full stop; don't double it.
  return { text: /[.!?]\)?$/.test(text) ? text : `${text}.`, tone: s.errors.length ? "err" : "ok" };
}
