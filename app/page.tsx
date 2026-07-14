import { auth, whitelist } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ProjectsView } from "@/components/ProjectsView";
import { SignOutButton } from "@/components/SignOutButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GithubConnect } from "@/components/GithubConnect";
import { McpTokenSettings } from "@/components/McpTokenSettings";
import { Brand } from "@/components/Brand";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.email) redirect("/signin");
  // /?new=1 (the project switcher's "New project" option) lands with the
  // create form already open.
  const startAdding = (await searchParams).new === "1";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-canvas)]">
        <div className="mx-auto flex w-full items-center justify-between gap-4 px-3 py-2 text-sm sm:w-[95%] sm:px-4">
          <Brand />
          <div className="flex items-center gap-4">
            <span className="text-[var(--color-faint)]">{session.user.email}</span>
            <GithubConnect />
            <McpTokenSettings />
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full flex-1 px-3 pt-4 pb-12 sm:w-[95%] sm:px-4">
        <ProjectsView
          viewerEmail={session.user.email}
          members={whitelist()}
          startAdding={startAdding}
        />
      </main>
    </div>
  );
}
