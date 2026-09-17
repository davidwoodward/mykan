import { auth, isOwner, whitelist } from "@/lib/auth";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import type { Metadata } from "next";
import { ProjectDetailView } from "@/components/ProjectDetailView";
import { CardPage } from "@/components/CardPage";
import { ProjectHeader } from "@/components/ProjectHeader";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { ProfileMenu } from "@/components/ProfileMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GithubConnect } from "@/components/GithubConnect";
import { McpTokenSettings } from "@/components/McpTokenSettings";
import { Brand } from "@/components/Brand";
import { itemByNumber, projectForKey } from "@/lib/route-resolve";
import {
  keyMatchDecision,
  lookupDecision,
  routeDecision,
  withQuery,
  type KeyMatchDecision,
  type RootSegment,
} from "@/lib/card-url";
import { richDocTitle, type Item, type Project } from "@/lib/types";

// The root segment is a project key (/FPOON, the board) or a card ref
// (/FPOON-42, the card page), KANBAN-44. Static top-level routes (api, mcp,
// signin, projects, icon) always win over this dynamic segment, and keys can
// never equal them (lib/card-url.ts RESERVED_KEYS, mirrored in the database).
// A project's old key (KANBAN-45) redirects permanently to the same page under
// its current key, only once the viewer is known to see that project.
//
// Status codes: every decision (redirect, not found) is made before anything
// renders and there is deliberately no loading.tsx or Suspense boundary in this
// segment, so nothing streams first and a miss is a real 404, not a 200 page.

type Props = {
  params: Promise<{ ref: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type Resolved =
  | { action: "render"; project: Project; item: Item | null; segment: RootSegment }
  | Exclude<KeyMatchDecision, { action: "resolve" }>;

/**
 * Resolve a canonical segment for this viewer: render it, redirect an old key
 * to the current one, or not found. Visibility is decided before any redirect,
 * so an old key of a hidden project is the same 404 as an unknown key.
 */
async function resolve(segment: RootSegment, email: string): Promise<Resolved> {
  const { match, project } = await projectForKey(segment.key, email);
  const byKey = keyMatchDecision(segment, match);
  if (byKey.action !== "resolve") return byKey;
  const item =
    project && segment.kind === "card" ? await itemByNumber(project.id, segment.number) : null;
  const decision = lookupDecision({
    projectVisible: !!project,
    wantsCard: segment.kind === "card",
    cardFound: !!item,
  });
  return decision === "render" && project
    ? { action: "render", project, item, segment }
    : { action: "notFound" };
}

// The open project or card in the browser tab. Never throws or 404s itself
// (metadata can stream); the page makes the not-found decision.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const session = await auth();
  const email = session?.user?.email;
  const d = routeDecision((await params).ref);
  if (!email || d.action !== "lookup") return { title: "MyKan" };
  const r = await resolve(d.segment, email);
  if (r.action === "redirect") return { title: "MyKan" };
  if (r.action !== "render") return { title: "Not found · MyKan" };
  if (r.item && r.segment.kind === "card") {
    const title = richDocTitle(r.item.body);
    const ref = `${r.segment.key}-${r.segment.number}`;
    return { title: `${ref}${title ? ` ${title}` : ""} · MyKan` };
  }
  return { title: `${r.project.name} · MyKan` };
}

export default async function RootRefPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");
  const email = session.user.email;
  const { ref } = await params;
  const query = await searchParams;

  const d = routeDecision(ref);
  if (d.action === "notFound") notFound();
  if (d.action === "redirect") {
    // Case/zero normalising is syntactic: it says nothing about whether the
    // project exists. Keep the board's query (filters) across it.
    permanentRedirect(withQuery(d.to, query));
  }

  const r = await resolve(d.segment, email);
  // An old key of a project the viewer can see: /OLD-7 -> /NEW-7, query kept.
  if (r.action === "redirect") permanentRedirect(withQuery(r.to, query));
  if (r.action !== "render") notFound();
  const { project, item } = r;
  const members = projectMembers(project);

  return (
    // Desktop (≥lg): the viewport is locked to one screen with the header
    // pinned; the board/list, or each card page column, is its own scroll
    // region. Below lg: plain full-page scroll with only the header pinned.
    <div className="flex min-h-screen flex-col lg:h-[100svh] lg:overflow-hidden">
      <header className="sticky top-0 z-20 border-b border-[var(--color-line)] bg-[var(--color-canvas)]">
        <div className="mx-auto flex min-h-[var(--app-header-h)] w-full items-center justify-between gap-4 px-3 py-2 text-sm sm:w-[95%] sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Brand />
            <ProjectSwitcher currentId={project.id} />
            <ProjectHeader
              project={project}
              isOwner={isOwner(email)}
              viewerEmail={email}
              allMembers={whitelist()}
            />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <GithubConnect />
            <McpTokenSettings />
            <ThemeToggle />
            <ProfileMenu
              name={session.user.name}
              email={email}
              keyboardDefault={isOwner(email)}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full flex-1 flex-col px-3 pt-4 pb-12 sm:w-[95%] sm:px-4 lg:min-h-0 lg:pb-4">
        {item && project.key ? (
          <CardPage
            // A different card is a different editor: fresh draft session.
            key={item.id}
            projectId={project.id}
            projectKey={project.key}
            initialItem={item}
          />
        ) : (
          <ProjectDetailView
            projectId={project.id}
            projectKey={project.key}
            members={members}
            isPrivate={project.is_private}
            keyboardDefault={isOwner(email)}
          />
        )}
      </main>
    </div>
  );
}

/**
 * Who can be assigned on a project = who can see it: the owner plus the members
 * it's shared with (deduped).
 */
function projectMembers(project: Project): string[] {
  return Array.from(
    new Set(
      [project.created_by, ...(project.shared_with ?? [])].filter(
        (e): e is string => !!e,
      ),
    ),
  );
}
