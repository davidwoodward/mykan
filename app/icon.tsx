import { ImageResponse } from "next/og";

// The browser-tab favicon, generated so its colour can vary by environment:
// RED on localhost/dev and brand indigo (#5b58d6) in production. This lets you
// tell a localhost tab from the live kanban.dbwoodward.com tab at a glance.
// Keyed off NODE_ENV — `next dev` is development (red); the Vercel build is
// production (indigo).
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// The 5-bar mykan mark, matching the old static icon.svg geometry (32×32 canvas).
const BARS = [
  { left: 5, top: 7, width: 6, height: 8 },
  { left: 5, top: 17, width: 6, height: 8 },
  { left: 13, top: 7, width: 6, height: 12 },
  { left: 21, top: 7, width: 6, height: 6 },
  { left: 21, top: 15, width: 6, height: 10 },
];

export default function Icon() {
  const bg = process.env.NODE_ENV === "production" ? "#5b58d6" : "#dc2626";
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          background: bg,
          borderRadius: 7,
          display: "flex",
          position: "relative",
        }}
      >
        {BARS.map((b, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: b.left,
              top: b.top,
              width: b.width,
              height: b.height,
              background: "#ffffff",
              borderRadius: 1.7,
            }}
          />
        ))}
      </div>
    ),
    { ...size },
  );
}
