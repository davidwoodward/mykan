import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { headers } from "next/headers";
import { ProjectDetailView } from "@/components/ProjectDetailView";
import { SignOutButton } from "@/components/SignOutButton";
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
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-10">
      <header className="mb-8 flex items-baseline justify-between">
        <div className="min-w-0 flex-1">
          <Link
            href="/"
            className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            ← Projects
          </Link>
          <h1 className="mt-2 truncate text-xl font-semibold tracking-tight">
            {project.name}
          </h1>
          {project.description ? (
            <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">
              {project.description}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-[var(--color-faint)]">{session.user.email}</span>
          <SignOutButton />
        </div>
      </header>

      <ProjectDetailView projectId={project.id} />
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
