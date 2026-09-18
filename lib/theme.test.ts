// The theme decision (KANBAN-49): an explicit stored choice wins, otherwise
// the OS preference. The inline THEME_SCRIPT writes the same rule out by hand
// (it can't import), so these tests also pin what that script must do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTheme, THEME_SCRIPT } from "./theme.ts";

test("resolveTheme: an explicit choice wins over the OS preference", () => {
  assert.equal(resolveTheme("dark", false), "dark");
  assert.equal(resolveTheme("light", true), "light");
});

test("resolveTheme: no choice follows the OS preference", () => {
  assert.equal(resolveTheme(null, true), "dark");
  assert.equal(resolveTheme(null, false), "light");
  assert.equal(resolveTheme(undefined, true), "dark");
});

test("resolveTheme: an unrecognised stored value is no choice at all", () => {
  assert.equal(resolveTheme("", true), "dark");
  assert.equal(resolveTheme("Dark", false), "light");
  assert.equal(resolveTheme("{}", true), "dark");
});

test("THEME_SCRIPT reads the same storage key and both explicit values", () => {
  assert.match(THEME_SCRIPT, /localStorage\.getItem\('theme'\)/);
  assert.match(THEME_SCRIPT, /t==='dark'/);
  assert.match(THEME_SCRIPT, /t==='light'/);
  assert.match(THEME_SCRIPT, /prefers-color-scheme: dark/);
});

test("THEME_SCRIPT re-applies the theme when something clears the class", () => {
  // The guard is what survives React client-rendering the root and rewriting
  // <html>'s className from the server value, which never has `dark`.
  assert.match(THEME_SCRIPT, /new MutationObserver\(apply\)/);
  assert.match(THEME_SCRIPT, /attributeFilter:\['class'\]/);
});
