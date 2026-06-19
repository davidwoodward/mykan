import { auth } from "@/lib/auth";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { ProjectDetailView } from "@/components/ProjectDetailView";
import { SignOutButton } from "@/components/SignOutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Brand } from "@/components/Brand";
import { Byline } from "@/components/Byline";
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
    // On ≥sm the viewport is pinned (h-screen) and the items area scrolls on
    // its own, so the nav + add form + toolbar stay static. On mobile we fall
    // back to ordinary full-page scroll.
    <div className="flex min-h-screen flex-col sm:h-screen sm:min-h-0">
      <header className="sticky top-0 z-20 shrink-0 border-b border-[var(--color-line)] bg-[var(--color-canvas)]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-2 text-sm">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link
              href="/"
              aria-label="Back to projects"
              title="Back to projects"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)]"
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
            <Brand />
            <div className="flex min-w-0 items-baseline gap-2.5">
              <span className="text-[var(--color-line-strong)]" aria-hidden="true">
                /
              </span>
              <h1
                className="truncate text-base font-semibold tracking-tight"
                title={project.description ?? undefined}
              >
                {project.name}
              </h1>
              <Byline
                createdBy={project.created_by}
                updatedBy={project.updated_by}
                updatedAt={project.updated_at}
                className="hidden shrink-0 sm:inline"
              />
            </div>
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

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 pt-4 pb-12 sm:min-h-0 sm:overflow-hidden sm:pb-4">
        <ProjectDetailView projectId={project.id} />
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
