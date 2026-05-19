import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ProjectsView } from "@/components/ProjectsView";
import { SignOutButton } from "@/components/SignOutButton";

export default async function Home() {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-10">
      <header className="mb-10 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Mykan</h1>
          <p className="mt-0.5 text-sm text-[var(--color-muted)]">Projects</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-[var(--color-faint)]">{session.user.email}</span>
          <SignOutButton />
        </div>
      </header>

      <ProjectsView />
    </div>
  );
}
