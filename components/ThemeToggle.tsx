"use client";

/**
 * Icon-only light/dark switch shown in the top bar. The actual theme is the
 * `dark` class on <html>; the inline script in layout.tsx sets it before paint
 * (from localStorage, falling back to the OS preference). This button just flips
 * that class and remembers the choice — which icon shows is handled entirely in
 * CSS off the `dark` class (see globals.css), so there's no React state to drift
 * out of sync with the DOM.
 */
export function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    const isDark = root.classList.toggle("dark");
    try {
      localStorage.setItem("theme", isDark ? "dark" : "light");
    } catch {
      // Private mode / storage disabled — the toggle still works for this session.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
      className="grid h-8 w-8 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-accent-soft)] hover:text-[var(--color-accent-ink)]"
    >
      {/* Crescent moon — shown in light mode (click to go dark). */}
      <svg className="theme-moon h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z"
          fill="currentColor"
        />
      </svg>
      {/* Sun — shown in dark mode (click to go light). */}
      <svg
        className="theme-sun h-[18px] w-[18px]"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
        <path d="M12 2.5v2M12 19.5v2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M2.5 12h2M19.5 12h2M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4" />
      </svg>
    </button>
  );
}
