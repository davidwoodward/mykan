// How the light/dark theme is applied (KANBAN-49).
//
// The theme IS the `dark` class on <html>; every token in globals.css hangs off
// it. Two pieces live here so they can't drift apart:
//
//  - `resolveTheme` — the decision (stored choice wins, else the OS preference),
//    pure and unit-tested.
//  - `THEME_SCRIPT` — the same decision as a string, run inline before paint by
//    app/layout.tsx. It can't import `resolveTheme` (it is a standalone
//    <script> in the document, not part of any bundle), so the rule is written
//    out once more there. Change one, change the other; the test below the
//    export pins the shared behaviour.
//
// The script also installs a guard, and that is the point of it. The class is
// added by the script *before* React exists, but it lives on <html>, an element
// React owns and whose `className` it re-applies from the server-rendered value
// whenever it client-renders the root — which React does to recover from a
// hydration mismatch anywhere in the tree. The server's className never
// contains `dark`, so a single mismatch on any page silently turned the app
// light on the next load (KANBAN-49). The guard watches <html>'s class and puts
// the resolved theme back the moment something clears it. MutationObserver
// callbacks run at the microtask checkpoint, before the next paint, so the
// correction is never visible.
//
// The guard is a safety net, not the fix: a hydration mismatch is still a bug
// and still gets fixed at its source.

export type Theme = "dark" | "light";

/**
 * The theme to apply: an explicit stored choice ("dark"/"light") wins;
 * otherwise follow the OS preference. Anything else in storage (absent, or
 * corrupt) is treated as "no choice made".
 */
export function resolveTheme(stored: string | null | undefined, prefersDark: boolean): Theme {
  if (stored === "dark") return "dark";
  if (stored === "light") return "light";
  return prefersDark ? "dark" : "light";
}

/** The localStorage key holding the viewer's explicit choice. */
export const THEME_STORAGE_KEY = "theme";

/**
 * Runs inline, before paint, as the first thing in <body> — so the class is on
 * <html> before any of the page's own markup is parsed and there is no flash of
 * the wrong theme. Mirrors `resolveTheme`, then guards the result (see above).
 * Every browser call is wrapped: private mode must not break the page.
 */
export const THEME_SCRIPT = `(function(){
var r=document.documentElement;
function want(){
try{var t=localStorage.getItem('theme');if(t==='dark')return true;if(t==='light')return false;}catch(e){}
try{return matchMedia('(prefers-color-scheme: dark)').matches;}catch(e){return false;}
}
function apply(){var d=want();if(d!==r.classList.contains('dark'))r.classList.toggle('dark',d);}
apply();
try{new MutationObserver(apply).observe(r,{attributes:true,attributeFilter:['class']});}catch(e){}
})();`;
