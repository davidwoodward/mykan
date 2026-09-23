// Run with `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { displayName, itemRef, localPart } from "./format.ts";

test("named members show their name, not their email local-part", () => {
  assert.equal(displayName("dawoodward@gmail.com"), "David");
  assert.equal(displayName("matthewl@experiencealign.com"), "Matthew");
  assert.equal(displayName("dwoody55@gmail.com"), "Woody");
  assert.equal(displayName("kenyon.congdon@permitsaige.com"), "Kenyon");
  assert.equal(displayName("cheriewoodward27@gmail.com"), "Cherie");
});

test("anyone unnamed falls back to their email local-part", () => {
  assert.equal(displayName("someone.new@example.org"), "someone.new");
  assert.equal(displayName("plain@gmail.com"), "plain");
});

test("an override matches however a gmail address is spelled", () => {
  // Stored emails are canonical, but a hand-typed or legacy value may not be.
  assert.equal(displayName("cherie.woodward.27@gmail.com"), "Cherie");
  assert.equal(displayName("  Cherie.Woodward.27@GoogleMail.com "), "Cherie");
});

test("avatar initials stay unique across the whole member list", () => {
  // The reason "Woody" exists: dwoody55 would otherwise collide with
  // dawoodward on "D". A new name must not reintroduce a collision.
  const members = [
    "dawoodward@gmail.com",
    "matthewl@experiencealign.com",
    "dwoody55@gmail.com",
    "kenyon.congdon@permitsaige.com",
    "cheriewoodward27@gmail.com",
  ];
  const initials = members.map((m) => displayName(m).charAt(0).toUpperCase());
  assert.deepEqual(initials, ["D", "M", "W", "K", "C"]);
  assert.deepEqual(members.map(displayName), [
    "David",
    "Matthew",
    "Woody",
    "Kenyon",
    "Cherie",
  ]);
  assert.equal(new Set(initials).size, members.length, `collision in ${initials}`);
});

test("a missing member renders as an em dash, not a crash", () => {
  assert.equal(displayName(null), "—");
  assert.equal(displayName(undefined), "—");
  assert.equal(displayName(""), "—");
  assert.equal(localPart(null), "—");
});

test("itemRef prefers the project key and falls back to #number", () => {
  assert.equal(itemRef("FPOON", 12), "FPOON-12");
  assert.equal(itemRef(null, 12), "#12");
  assert.equal(itemRef("", 12), "#12");
  assert.equal(itemRef("FPOON", null), null);
});
