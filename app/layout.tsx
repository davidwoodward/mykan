import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TooltipLayer } from "@/components/TooltipLayer";
import { THEME_SCRIPT } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MyKan",
  description: "Projects, items, and a kanban board.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {/* Before paint: applies the saved theme (or the OS preference) so there
            is no flash of the wrong one, and keeps it applied if React ever
            client-renders the root and rewrites <html>'s className — see
            lib/theme.ts (KANBAN-49). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {children}
        <TooltipLayer />
      </body>
    </html>
  );
}
