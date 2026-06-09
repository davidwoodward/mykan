import { auth } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import { ProjectDetailView } from "@/components/ProjectDetailView";
import { SignOutButton } from "@/components/SignOutButton";
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
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-canvas)]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-2 text-sm">
          <Brand />
          <div className="flex items-center gap-4">
            <span className="text-[var(--color-faint)]">{session.user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 pt-4 pb-12">
        <div className="mb-3">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {project.name}
          </h1>
          {project.description ? (
            <p className="mt-0.5 max-w-2xl text-sm text-[var(--color-muted)]">
              {project.description}
            </p>
          ) : null}
          <Byline
            createdBy={project.created_by}
            updatedBy={project.updated_by}
            updatedAt={project.updated_at}
            className="mt-1 block"
          />
        </div>

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
