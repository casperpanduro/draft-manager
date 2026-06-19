"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    // Abort if the request hangs (e.g. Supabase stack unreachable) so the
    // button never gets stuck on "Sending…" with no feedback.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out — is the server reachable?")), 12000),
    );

    try {
      const supabase = createClient();
      const { error } = await Promise.race([
        supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/confirm?next=/dashboard`,
          },
        }),
        timeout,
      ]);
      if (error) {
        toast.error(error.message);
        return;
      }
      setSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send magic link.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex flex-1 items-center justify-center px-5 py-10">
      {/* Floodlight glow behind the card */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2"
        style={{
          background: "radial-gradient(circle, var(--brand-glow), transparent 68%)",
        }}
      />
      <div className="animate-rise relative w-full max-w-sm">
        <Link href="/" className="kicker mb-6 inline-block hover:text-foreground">
          ← Draft Manager
        </Link>

        <div className="clip-broadcast accent-bar relative bg-card p-7 pl-8 shadow-2xl shadow-black/40 ring-1 ring-border">
          <div className="animate-rise kicker mb-1" style={{ animationDelay: "80ms" }}>
            Manager access
          </div>
          <h1
            className="animate-rise font-display text-3xl uppercase"
            style={{ animationDelay: "140ms" }}
          >
            Team sheet check-in
          </h1>

          {sent ? (
            <div className="mt-6 space-y-3 text-sm">
              <div className="flex items-center gap-2 text-brand">
                <span className="size-2 rounded-full bg-brand" />
                <span className="font-display uppercase tracking-wide">
                  Link dispatched
                </span>
              </div>
              <p className="text-muted-foreground">
                We sent a magic link to{" "}
                <strong className="text-foreground">{email}</strong>. Open it to
                step onto the pitch.
              </p>
              <p className="text-muted-foreground">
                Local dev: links land in Mailpit at{" "}
                <a
                  className="text-brand underline underline-offset-2"
                  href="http://127.0.0.1:54324"
                  target="_blank"
                  rel="noreferrer"
                >
                  127.0.0.1:54324
                </a>
                .
              </p>
            </div>
          ) : (
            <form
              onSubmit={sendLink}
              className="animate-rise mt-6 space-y-4"
              style={{ animationDelay: "200ms" }}
            >
              <div className="space-y-1.5">
                <label
                  htmlFor="email"
                  className="kicker block text-foreground/70"
                >
                  Email
                </label>
                <Input
                  id="email"
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-12"
                />
              </div>
              <Button
                type="submit"
                className="sheen h-12 w-full font-display text-sm uppercase tracking-wider"
                disabled={loading}
              >
                {loading ? "Sending…" : "Send magic link"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                No password — we email you a one-tap sign-in link.
              </p>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
