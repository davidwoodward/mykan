// The focus list's rules (KANBAN-74). Pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_FOCUS_SETTINGS,
  capError,
  dailyWindowStart,
  describeReason,
  formatFocusText,
  isStale,
  newest,
  personalKeyCandidates,
  reviewReasons,
  validateSettingsPatch,
  type FocusEntryView,
} from "./focus-rules.ts";

const S = DEFAULT_FOCUS_SETTINGS;

test("settings: valid changes pass, bad ones name the field", () => {
  assert.deepEqual(validateSettingsPatch(S, { enabled: true, max_entries: 5 }), {
    ok: true,
    patch: { enabled: true, max_entries: 5 },
  });
  assert.equal(validateSettingsPatch(S, { review_hour: 24 }).ok, false);
  assert.equal(validateSettingsPatch(S, { stale_days: 1.5 }).ok, false);
  assert.equal(validateSettingsPatch(S, { enabled: "yes" }).ok, false);
  assert.equal(validateSettingsPatch(S, { time_zone: "Mars/Olympus" }).ok, false);
  assert.equal(validateSettingsPatch(S, { time_zone: "America/Los_Angeles" }).ok, true);
});

test("settings: the minimum must stay below the maximum", () => {
  const r = validateSettingsPatch(S, { max_entries: 2 });
  assert.equal(r.ok, false);
  assert.equal(validateSettingsPatch(S, { min_entries: 1, max_entries: 2 }).ok, true);
});

test("settings: unknown fields are ignored", () => {
  assert.deepEqual(validateSettingsPatch(S, { personal_project_id: "x", user_email: "y" }), {
    ok: true,
    patch: {},
  });
});

test("hard cap: refuses at the maximum, allows below it", () => {
  assert.equal(capError(6, 7), null);
  assert.match(capError(7, 7) ?? "", /full \(7 of 7\)/);
  assert.match(capError(9, 7) ?? "", /Drop an entry/);
});

test("daily window: the most recent review hour in the person's zone", () => {
  // 2026-11-24 15:00 UTC is 07:00 in Los Angeles (PST, UTC-8): before 08:00,
  // so the window opened yesterday at 08:00 PST = 2026-11-23 16:00 UTC.
  assert.equal(
    dailyWindowStart(new Date("2026-11-24T15:00:00Z"), 8, "America/Los_Angeles").toISOString(),
    "2026-11-23T16:00:00.000Z",
  );
  // 17:00 UTC is 09:00 PST: today's window, 16:00 UTC.
  assert.equal(
    dailyWindowStart(new Date("2026-11-24T17:00:00Z"), 8, "America/Los_Angeles").toISOString(),
    "2026-11-24T16:00:00.000Z",
  );
  // Summer time (PDT, UTC-7).
  assert.equal(
    dailyWindowStart(new Date("2026-07-01T20:00:00Z"), 8, "America/Los_Angeles").toISOString(),
    "2026-07-01T15:00:00.000Z",
  );
  assert.equal(dailyWindowStart(new Date("2026-11-24T00:30:00Z"), 0, "UTC").toISOString(), "2026-11-24T00:00:00.000Z");
  // A bad zone falls back to UTC rather than throwing.
  assert.equal(dailyWindowStart(new Date("2026-11-24T09:00:00Z"), 8, "Nope/Nowhere").toISOString(), "2026-11-24T08:00:00.000Z");
});

test("staleness and newest", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  assert.equal(isStale("2026-11-17T11:00:00Z", 7, now), true);
  assert.equal(isStale("2026-11-18T13:00:00Z", 7, now), false);
  assert.equal(isStale(null, 7, now), false);
  assert.equal(newest([null, "2026-11-01T00:00:00Z", "2026-11-20T00:00:00Z", undefined]), "2026-11-20T00:00:00Z");
  assert.equal(newest([]), null);
});

const entry = (ref: string, over: Partial<FocusEntryView> = {}): FocusEntryView => ({
  id: ref,
  item_id: ref,
  position: 1024,
  why_now: null,
  target_date: null,
  added_at: "2026-11-01T00:00:00Z",
  visible: true,
  ref,
  url: null,
  title: `Title ${ref}`,
  type: "epic",
  status: "in_progress",
  project_key: ref.split("-")[0],
  personal: false,
  progress: null,
  open_questions: 0,
  last_moved_at: "2026-11-24T10:00:00Z",
  stale: false,
  ...over,
});

const NOW = new Date("2026-11-24T17:00:00Z"); // 09:00 in Los Angeles
const settings = (last: string | null) => ({ ...S, time_zone: "America/Los_Angeles", last_reviewed_at: last });

test("review: never reviewed is due (daily)", () => {
  const r = reviewReasons({ settings: settings(null), active: [entry("A-1"), entry("B-1"), entry("C-1")], history: [], now: NOW });
  assert.deepEqual(r, [{ kind: "daily" }]);
});

test("review: reviewed since today's window opened, nothing changed, not due", () => {
  const r = reviewReasons({
    settings: settings("2026-11-24T16:30:00Z"),
    active: [entry("A-1", { stale: true }), entry("B-1")],
    history: [],
    now: NOW,
  });
  assert.deepEqual(r, [], "a short list and a stale card alone do not re-raise a confirmed review");
});

test("review: a completion after the last review raises it, with short when at the minimum", () => {
  const r = reviewReasons({
    settings: settings("2026-11-24T16:30:00Z"),
    active: [entry("A-1"), entry("B-1")],
    history: [
      { ref: "PS-9", title: "Mac mini", completed_at: "2026-11-24T16:45:00Z" },
      { ref: "PS-1", title: "old", completed_at: "2026-11-20T00:00:00Z" },
    ],
    now: NOW,
  });
  assert.deepEqual(r, [
    { kind: "completed", ref: "PS-9", title: "Mac mini" },
    { kind: "short", count: 2, min: 2 },
  ]);
  assert.equal(r.map(describeReason).join(" · "), "PS-9 done · 2 entries left");
});

test("review: the daily window brings back short and stale", () => {
  const r = reviewReasons({
    settings: settings("2026-11-23T20:00:00Z"),
    active: [entry("A-1", { stale: true, last_moved_at: "2026-11-10T00:00:00Z" })],
    history: [],
    now: NOW,
  });
  assert.deepEqual(r, [
    { kind: "daily" },
    { kind: "short", count: 1, min: 2 },
    { kind: "stale", ref: "A-1", title: "Title A-1", days: 14 },
  ]);
  assert.equal(describeReason(r[2]), "A-1 idle 14d");
});

test("personal project keys start at ME", () => {
  const k = personalKeyCandidates();
  assert.equal(k[0], "ME");
  assert.equal(k[1], "ME2");
  assert.ok(k.every((x) => /^[A-Z][A-Z0-9]{1,9}$/.test(x)));
});

test("text: header, review line, table, width", () => {
  const text = formatFocusText(
    {
      entries: [
        entry("PS-147", { title: "Mac mini running", why_now: "unblocks Kenyon", progress: { done: 2, total: 5 } }),
        entry("AMOS-3", { title: "Pre-release", stale: true, last_moved_at: "2026-11-10T00:00:00Z" }),
        entry("X-1", { visible: false, ref: null, title: null }),
      ],
      max_entries: 7,
      reasons: [{ kind: "daily" }],
    },
    NOW,
    60,
  );
  const lines = text.split("\n");
  assert.equal(lines[0], "Focus list (3 of 7)");
  assert.equal(lines[1], "Review due: daily review");
  assert.equal(lines[2], "```");
  assert.match(lines[3], /^#\s+Card\s+Status\s+Done\s+Moved\s+Note$/);
  assert.match(lines[5], /PS-147.*2\/5.*today.*Mac mini running/);
  assert.match(lines[6], /AMOS-3.*!14d/);
  assert.match(lines[7], /\(no access\)/);
  assert.ok(lines.every((l) => Array.from(l).length <= 60), "no line wider than 60");
});

test("text: an empty list says so", () => {
  const text = formatFocusText({ entries: [], max_entries: 7, reasons: [] }, NOW);
  assert.match(text, /^Focus list \(0 of 7\)\nYour focus list is empty/);
});
