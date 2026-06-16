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
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=/dashboard`,
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <main className="flex flex-1 items-center justify-center px-5 py-10">
      <div className="animate-rise w-full max-w-sm">
        <Link href="/" className="kicker mb-6 inline-block hover:text-foreground">
          ← Draft Manager
        </Link>

        <div className="clip-broadcast accent-bar relative bg-card p-7 pl-8 ring-1 ring-border">
          <div className="kicker mb-1">Manager access</div>
          <h1 className="font-display text-3xl uppercase">Team sheet check-in</h1>

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
            <form onSubmit={sendLink} className="mt-6 space-y-4">
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
