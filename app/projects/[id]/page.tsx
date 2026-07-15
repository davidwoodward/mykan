import { auth, isOwner, whitelist } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { ProjectDetailView } from "@/components/ProjectDetailView";
import { ProjectHeader } from "@/components/ProjectHeader";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import { ProfileMenu } from "@/components/ProfileMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GithubConnect } from "@/components/GithubConnect";
import { McpTokenSettings } from "@/components/McpTokenSettings";
import { Brand } from "@/components/Brand";
import type { Project } from "@/lib/types";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");
  const { id } = await params;

  const project = await fetchProject(id);
  if (!project) notFound();

  return (
    // Desktop (≥lg): the viewport is locked to one screen — header pinned, add
    // form + toolbar static, and the board/list is the only scroll region,
    // sized by flex to fill exactly the leftover height (no page scroll).
    // Below lg (phones/tablets, incl. landscape): plain full-page scroll with
    // only the header pinned.
    <div className="flex min-h-screen flex-col lg:h-[100svh] lg:overflow-hidden">
      <header className="sticky top-0 z-20 border-b border-[var(--color-line)] bg-[var(--color-canvas)]">
        <div className="mx-auto flex w-full items-center justify-between gap-4 px-3 py-2 text-sm sm:w-[95%] sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Brand />
            <ProjectSwitcher currentId={project.id} />
            <ProjectHeader
              project={project}
              isOwner={isOwner(session.user.email)}
              viewerEmail={session.user.email}
              allMembers={whitelist()}
            />
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <GithubConnect />
            <McpTokenSettings />
            <ThemeToggle />
            <ProfileMenu
              name={session.user.name}
              email={session.user.email}
              keyboardDefault={isOwner(session.user.email)}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full flex-1 flex-col px-3 pt-4 pb-12 sm:w-[95%] sm:px-4 lg:min-h-0 lg:pb-4">
        <ProjectDetailView
          projectId={project.id}
          projectKey={project.key}
          members={projectMembers(project)}
          isPrivate={project.is_private}
          keyboardDefault={isOwner(session.user.email)}
        />
      </main>
    </div>
  );
}

/**
 * Who can be assigned on a project = who can see it: the owner plus the members
 * it's shared with (deduped). Assignee candidates are drawn from this, not the
 * whole whitelist, so you can't assign someone who can't see the project.
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

async function fetchProject(id: string): Promise<Project | null> {
  const hdrs = await headers();
  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host");
  const proto = hdrs.get("x-forwarded-proto") ?? "http";
  if (!host) return null;
  const res = await fetch(`${proto}://${host}/api/projects/${id}`, {
    headers: { cookie: hdrs.get("cookie") ?? "" },
    cache: "no-store",
  });
  if (!res.ok) return null;
  return (await res.json()) as Project;
}
