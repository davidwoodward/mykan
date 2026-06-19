import { auth, isOwner } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ProjectsView } from "@/components/ProjectsView";
import { SignOutButton } from "@/components/SignOutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Brand } from "@/components/Brand";

export default async function Home() {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-canvas)]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-2 text-sm">
          <Brand />
          <div className="flex items-center gap-4">
            <span className="text-[var(--color-faint)]">{session.user.email}</span>
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 pt-4 pb-12">
        <ProjectsView isOwner={isOwner(session.user.email)} viewerEmail={session.user.email} />
      </main>
    </div>
  );
}
