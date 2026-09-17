"use client";

import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  GITHUB_HELP_SECTIONS,
  GITHUB_HELP_TITLE,
  GITHUB_PAT_DOCS_URL,
  GITHUB_REQUIRED_PERMISSIONS,
  type HelpLine,
} from "@/lib/github-help";

/**
 * The "?" help for GitHub setup (KANBAN-28), one component for every GitHub
 * config surface (the Connect panel, the project's GitHub account, the Areas
 * repo bindings). It opens a dialog rendered from the one content source,
 * `lib/github-help.ts`.
 *
 * - Icon button: `aria-label` plus `title`, which the app-wide tooltip layer
 *   shows promptly (KANBAN-47). Enter/Space/click/tap open.
 * - Esc, the ✕, or a press on the backdrop closes the help ONLY, and focus goes
 *   back to the "?". The surfaces it sits in own Esc and click-off themselves
 *   (the Connect popover, the project panel, the Areas modal, the card page), so:
 *     * Esc is taken in the window's capture phase and stopped there, before any
 *       of their listeners see it;
 *     * the dialog is portaled into its own container on <body>, and that
 *       container stops pointer, mouse, touch, click and key events from bubbling
 *       further. React's own `stopPropagation` is not enough: in the App Router
 *       React listens on `document`, the same node as those click-off listeners.
 *       (React also listens on a portal's container, so the dialog's own
 *       handlers still run.) React events are stopped at the backdrop as well,
 *       since they bubble to the portal's React parents.
 * - Tab stays inside the dialog while it is open.
 */
export function GithubHelpButton({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  // The portal's own container, created once in the browser (null on the server).
  const [host] = useState<HTMLDivElement | null>(() =>
    typeof document === "undefined" ? null : document.createElement("div"),
  );

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }
  const closeFn = useRef(close);
  useLayoutEffect(() => {
    closeFn.current = close;
  });

  useLayoutEffect(() => {
    if (!open || !host) return;
    document.body.appendChild(host);
    const stop = (e: Event) => e.stopPropagation();
    const isolated = [
      "pointerdown",
      "pointerup",
      "mousedown",
      "mouseup",
      "touchstart",
      "touchend",
      "click",
      "keydown",
      "keyup",
    ];
    for (const t of isolated) host.addEventListener(t, stop);
    function onEsc(e: globalThis.KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      closeFn.current();
    }
    window.addEventListener("keydown", onEsc, true);
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onEsc, true);
      for (const t of isolated) host.removeEventListener(t, stop);
      host.remove();
    };
  }, [open, host]);

  // Keep Tab inside the dialog.
  function onPanelKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusable = panelRef.current.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !panelRef.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <span className={`inline-flex shrink-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="GitHub setup help"
        title="GitHub setup help"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="grid h-6 w-6 place-items-center rounded-md text-[var(--color-faint)] outline-none transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)] focus-visible:text-[var(--color-ink)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
      >
        <svg
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <path d="M9.6 9.3a2.5 2.5 0 0 1 4.86.83c0 1.67-2.46 2.2-2.46 3.62" />
          <path d="M12 17h.01" />
        </svg>
      </button>

      {open && host
        ? createPortal(
            <div
              className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/30 p-3 pt-[6svh] text-left normal-case tracking-normal sm:p-4 sm:pt-[8svh]"
              // React events still bubble to the React parents of a portal (the
              // Areas modal's backdrop closes on mousedown), so stop them here too.
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                if (e.target === e.currentTarget) close();
              }}
            >
              <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="github-help-title"
                // Focusable, so a press on its text keeps focus inside the dialog.
                tabIndex={-1}
                onKeyDown={onPanelKeyDown}
                className="flex max-h-[88svh] w-full max-w-lg flex-col outline-none rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] shadow-xl"
              >
                <header className="flex items-center justify-between gap-4 border-b border-[var(--color-line)] px-4 py-2.5">
                  <h2 id="github-help-title" className="text-sm font-semibold">
                    {GITHUB_HELP_TITLE}
                  </h2>
                  <button
                    ref={closeRef}
                    type="button"
                    onClick={close}
                    aria-label="Close help"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--color-faint)] outline-none transition-colors hover:bg-[var(--color-canvas)] hover:text-[var(--color-ink)] focus-visible:text-[var(--color-ink)] focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </header>

                <div className="overflow-y-auto overscroll-contain px-4 py-3 text-[13px] leading-relaxed text-[var(--color-muted)]">
                  {GITHUB_HELP_SECTIONS.map((s) => (
                    <section key={s.id} className="mb-4 last:mb-1">
                      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink)]">
                        {s.title}
                      </h3>
                      {(s.intro ?? []).map((line, i) => (
                        <p key={i} className="mb-1.5">
                          <Rich line={line} />
                        </p>
                      ))}
                      {s.permissions ? (
                        <dl className="mb-1.5 grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-y-1 rounded-md border border-[var(--color-line)] bg-[var(--color-canvas)] px-3 py-2">
                          {GITHUB_REQUIRED_PERMISSIONS.map((p) => (
                            <div key={p.name} className="contents">
                              <dt className="font-medium text-[var(--color-ink)]">
                                {p.name}: {p.access}
                              </dt>
                              <dd className="mb-1 sm:mb-0">{p.why}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      {s.steps ? (
                        <ol className="ml-5 list-decimal space-y-1 marker:text-[var(--color-faint)]">
                          {s.steps.map((line, i) => (
                            <li key={i}>
                              <Rich line={line} />
                            </li>
                          ))}
                        </ol>
                      ) : null}
                      {s.bullets ? (
                        <ul className="ml-5 list-disc space-y-1 marker:text-[var(--color-faint)]">
                          {s.bullets.map((line, i) => (
                            <li key={i}>
                              <Rich line={line} />
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </section>
                  ))}
                  <p className="border-t border-[var(--color-line)] pt-2 text-xs text-[var(--color-faint)]">
                    GitHub&rsquo;s own guide:{" "}
                    <ExternalLink href={GITHUB_PAT_DOCS_URL}>
                      Creating a fine-grained personal access token
                    </ExternalLink>
                  </p>
                </div>
              </div>
            </div>,
            host,
          )
        : null}
    </span>
  );
}

function Rich({ line }: { line: HelpLine }) {
  return (
    <>
      {line.map((span, i) => {
        if (typeof span === "string") return <span key={i}>{span}</span>;
        if ("strong" in span)
          return (
            <strong key={i} className="font-medium text-[var(--color-ink)]">
              {span.strong}
            </strong>
          );
        if ("code" in span)
          return (
            <code
              key={i}
              className="rounded bg-[var(--color-canvas)] px-1 py-px font-mono text-[12px] text-[var(--color-ink)]"
            >
              {span.code}
            </code>
          );
        return (
          <ExternalLink key={i} href={span.href}>
            {span.link}
          </ExternalLink>
        );
      })}
    </>
  );
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-[var(--color-accent-ink)] underline-offset-2 hover:underline"
    >
      {children}
      <span aria-hidden="true"> ↗</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
