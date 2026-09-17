import Link from "next/link";
import { Brand } from "@/components/Brand";

// One not-found for the whole app (KANBAN-44). It deliberately says nothing
// about why: an unknown key, a card that doesn't exist, and a private project
// the viewer can't see all read the same, so nothing leaks.
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-canvas)]">
        <div className="mx-auto flex w-full items-center gap-4 px-3 py-2 text-sm sm:w-[95%] sm:px-4">
          <Brand />
        </div>
      </header>
      <main className="mx-auto w-full flex-1 px-3 pt-16 pb-12 sm:w-[95%] sm:px-4">
        <h1 className="text-lg font-semibold tracking-tight text-[var(--color-ink)]">Not found</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          There&rsquo;s no project or card at this address, or it isn&rsquo;t shared with you.
        </p>
        <Link
          href="/"
          className="mt-4 inline-block text-sm text-[var(--color-accent)] underline-offset-2 hover:underline"
        >
          All projects
        </Link>
      </main>
    </div>
  );
}
