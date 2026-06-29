import { auth, isOwner, whitelist } from "@/lib/auth";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { ProjectDetailView } from "@/components/ProjectDetailView";
import { ProjectHeader } from "@/components/ProjectHeader";
import { SignOutButton } from "@/components/SignOutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
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
            <Link
              href="/"
              aria-label="Back to projects"
              title="Back to projects"
              className="ml-3 grid h-8 w-8 shrink-0 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)]"
            >
              <svg
                className="h-[18px] w-[18px]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </Link>
            <ProjectHeader
              project={project}
              isOwner={isOwner(session.user.email)}
              viewerEmail={session.user.email}
            />
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <span className="hidden text-[var(--color-faint)] sm:inline">
              {session.user.email}
            </span>
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full flex-1 flex-col px-3 pt-4 pb-12 sm:w-[95%] sm:px-4 lg:min-h-0 lg:pb-4">
        <ProjectDetailView
          projectId={project.id}
          projectKey={project.key}
          members={whitelist()}
          isPrivate={project.is_private}
        />
      </main>
    </div>
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
