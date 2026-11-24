"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { FocusSettings } from "@/lib/focus-rules";

/**
 * The focus list's settings inside the profile menu (KANBAN-81/78). One switch
 * turns the list on or off (off by default); while on, the thresholds show:
 * the hard cap, the "getting short" minimum, the stale threshold and the daily
 * review hour. The browser's time zone is saved with every change, so the
 * daily review opens at the person's own local hour.
 */
const FIELDS = [
  { key: "max_entries", label: "Maximum entries", hint: "Hard cap: drop one to add more", min: 1, max: 50 },
  { key: "min_entries", label: "Review when down to", hint: "Entries left that ask for a review", min: 0, max: 49 },
  { key: "stale_days", label: "Idle after (days)", hint: "A card that hasn't moved is flagged", min: 1, max: 365 },
  { key: "review_hour", label: "Daily review at (hour)", hint: "0–23, your local time", min: 0, max: 23 },
] as const;

type NumKey = (typeof FIELDS)[number]["key"];

const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export function FocusSettingsPanel() {
  const router = useRouter();
  const [s, setS] = useState<FocusSettings | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<NumKey, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/focus/settings")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: FocusSettings) => setS(d))
      .catch((e: Error) => setError(e.message));
  }, []);

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch("/api/focus/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...patch, time_zone: browserZone() }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((d as { error?: string }).error ?? `HTTP ${res.status}`);
      setS(d as FocusSettings);
      setError(null);
      router.refresh(); // the home page shows or hides the list
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function commit(key: NumKey) {
    const raw = drafts[key];
    setDrafts((d) => ({ ...d, [key]: undefined }));
    if (raw === undefined || !s) return;
    const n = Number(raw);
    if (raw.trim() === "" || n === s[key]) return;
    void save({ [key]: n });
  }

  const on = !!s?.enabled;

  return (
    <div className="mt-3 border-t border-[var(--color-line)] pt-3">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={!s || saving}
        onClick={() => void save({ enabled: !on })}
        className="flex w-full items-start justify-between gap-3 text-left disabled:opacity-60"
      >
        <span className="flex min-w-0 flex-col">
          <span className="font-medium text-[var(--color-ink)]">Focus list</span>
          <span className="text-[11px] leading-snug text-[var(--color-faint)]">
            Your private, ranked list of priorities across every project, at the top of Home.
          </span>
        </span>
        <span
          aria-hidden="true"
          className={`mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
            on ? "bg-[var(--color-accent)]" : "bg-[var(--color-line)]"
          }`}
        >
          <span className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-4" : "translate-x-0"}`} />
        </span>
      </button>

      {on && s ? (
        <div className="mt-2 grid grid-cols-2 items-start gap-x-3 gap-y-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex flex-col">
              <span className="text-[11px] font-medium text-[var(--color-muted)]">{f.label}</span>
              <input
                type="number"
                inputMode="numeric"
                min={f.min}
                max={f.max}
                value={drafts[f.key] ?? String(s[f.key])}
                disabled={saving}
                onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
                onBlur={() => commit(f.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit(f.key);
                  } else if (e.key === "Escape") {
                    // Esc saves a change (DESIGN.md); keep the menu open.
                    e.stopPropagation();
                    commit(f.key);
                  }
                }}
                className="mt-0.5 w-full rounded border border-[var(--color-line)] bg-transparent px-2 py-1 text-sm tabular-nums outline-none focus:border-[var(--color-accent)]"
              />
              <span className="mt-0.5 text-[10px] leading-snug text-[var(--color-faint)]">{f.hint}</span>
            </label>
          ))}
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-1 text-[11px] text-[var(--color-bug)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
