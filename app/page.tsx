import { auth, isOwner, whitelist } from "@/lib/auth";
import { redirect } from "next/navigation";
import { ProjectsView } from "@/components/ProjectsView";
import { ProfileMenu } from "@/components/ProfileMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { GithubConnect } from "@/components/GithubConnect";
import { McpTokenSettings } from "@/components/McpTokenSettings";
import { Brand } from "@/components/Brand";
import { FocusList } from "@/components/FocusList";
import { FocusPeek } from "@/components/FocusPeek";
import { getSupabase } from "@/lib/supabase-server";
import { getFocusSettings } from "@/lib/focus-core";

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
  // The focus list (KANBAN-74) is opt-in per person; off shows Home as before.
  const focus = await getFocusSettings(getSupabase(), session.user.email);
  const focusOn = focus.ok && focus.data.enabled;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-canvas)]">
        <div className="mx-auto flex w-full items-center justify-between gap-4 px-3 py-2 text-sm sm:w-[95%] sm:px-4">
          <Brand />
          <div className="flex items-center gap-3">
            {focusOn ? <FocusPeek /> : null}
            {/* Touch layout: these three move into the profile menu (KANBAN-87). */}
            <div className="flex items-center gap-3 compact:hidden">
              <GithubConnect />
              <McpTokenSettings />
              <ThemeToggle />
            </div>
            <ProfileMenu
              name={session.user.name}
              email={session.user.email}
              keyboardDefault={isOwner(session.user.email)}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full flex-1 px-3 pt-4 pb-12 sm:w-[95%] sm:px-4">
        {focusOn ? <FocusList /> : null}
        <ProjectsView
          viewerEmail={session.user.email}
          members={whitelist()}
          startAdding={startAdding}
        />
      </main>
    </div>
  );
}
