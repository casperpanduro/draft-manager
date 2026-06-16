import type { Metadata } from "next";
import { Anton, Saira } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const anton = Anton({
  variable: "--font-display",
  weight: "400",
  subsets: ["latin"],
});

const saira = Saira({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Draft Manager — Live Football Drafts",
  description: "Start a league, call up your friends, and draft your squad live.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${anton.variable} ${saira.variable} h-full antialiased`}
    >
      <body className="relative min-h-full flex flex-col bg-background text-foreground overflow-x-hidden">
        {/* Atmosphere: floodlight glow + pitch grain + vignette */}
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-pitch" />
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-grain opacity-[0.05]" />
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-vignette" />
        {children}
        <Toaster richColors position="top-center" theme="dark" />
      </body>
    </html>
  );
}
