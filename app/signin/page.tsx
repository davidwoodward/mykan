import { signIn } from "@/lib/auth";

const ERRORS: Record<string, string> = {
  AccessDenied: "That account is not authorized to use Mykan.",
  Configuration: "Authentication is misconfigured. Check the server logs.",
  Verification: "The sign-in link is invalid or has expired.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;
  const message = error ? (ERRORS[error] ?? "Sign-in failed. Try again.") : null;

  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-10">
          <h1 className="text-2xl font-semibold tracking-tight">Mykan</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Projects, items, and a kanban board.
          </p>
        </div>

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl ?? "/" });
          }}
        >
          <button
            type="submit"
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--color-ink)] px-4 text-sm font-medium text-[var(--color-canvas)] transition-colors hover:bg-[var(--color-accent-ink)]"
          >
            <GoogleMark />
            Continue with Google
          </button>
        </form>

        {message ? (
          <p className="mt-4 rounded-md bg-[var(--color-bug-bg)] px-3 py-2 text-sm text-[var(--color-bug)] ring-1 ring-inset ring-[var(--color-bug-line)]">
            {message}
          </p>
        ) : null}

        <p className="mt-8 text-xs text-[var(--color-faint)]">
          Access is restricted. Only the configured whitelist may sign in.
        </p>
      </div>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#fff"
        d="M21.6 12.227c0-.682-.061-1.337-.175-1.966H12v3.72h5.385a4.6 4.6 0 0 1-1.997 3.018v2.51h3.231c1.892-1.745 2.981-4.31 2.981-7.282z"
      />
      <path
        fill="#fff"
        opacity=".9"
        d="M12 22c2.7 0 4.964-.895 6.619-2.42l-3.231-2.51c-.895.6-2.04.955-3.388.955-2.605 0-4.81-1.76-5.598-4.123h-3.34v2.59A10 10 0 0 0 12 22z"
      />
      <path
        fill="#fff"
        opacity=".75"
        d="M6.402 13.902a6 6 0 0 1 0-3.804V7.508h-3.34a10 10 0 0 0 0 8.984z"
      />
      <path
        fill="#fff"
        opacity=".55"
        d="M12 5.977c1.47 0 2.787.505 3.823 1.495l2.866-2.866C16.96 3.045 14.695 2 12 2A10 10 0 0 0 3.062 7.508l3.34 2.59C7.19 7.737 9.395 5.977 12 5.977z"
      />
    </svg>
  );
}
