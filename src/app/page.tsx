import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand-mark";
import { BroadcastTicker } from "@/components/broadcast-ticker";
import { Container } from "@/components/container";
import { getTickerData } from "@/lib/ticker";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  const ticker = await getTickerData(supabase);

  return (
    <main className="relative flex flex-1 flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-8" />
          <span className="font-display text-sm uppercase tracking-[0.2em]">
            Draft Manager
          </span>
        </div>
        <Link
          href="/login"
          className="kicker transition-colors hover:text-foreground"
        >
          Sign in
        </Link>
      </div>

      {/* Hero */}
      <div className="flex flex-1 flex-col justify-center px-5 pb-10">
        <Container>
          <div
            className="animate-rise flex items-center gap-2"
            style={{ animationDelay: "0ms" }}
          >
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-2 animate-ping rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-destructive" />
            </span>
            <span className="kicker text-foreground/80">
              Live snake draft · 2–20 managers
            </span>
          </div>

          <h1
            className="animate-rise mt-4 font-display text-[clamp(3.2rem,16vw,8rem)] uppercase leading-[0.84]"
            style={{ animationDelay: "80ms" }}
          >
            Call up
            <br />
            <span className="bg-[image:var(--brand-gradient)] bg-clip-text text-transparent">
              your squad
            </span>
          </h1>

          <p
            className="animate-rise mt-6 max-w-md text-lg text-muted-foreground"
            style={{ animationDelay: "180ms" }}
          >
            Start a league, invite your mates, and draft a starting XI live —
            randomised snake order, a ticking pick clock, the works.
          </p>

          <div
            className="animate-rise mt-8 flex flex-col gap-3 sm:flex-row"
            style={{ animationDelay: "260ms" }}
          >
            <Button
              size="lg"
              className="sheen group h-13 gap-2 px-8 font-display text-base uppercase tracking-wider"
              render={<Link href="/login" />}
            >
              Enter the draft room
              <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" />
            </Button>
          </div>
        </Container>
      </div>

      {/* Broadcast lower-third ticker */}
      <div className="animate-rise" style={{ animationDelay: "340ms" }}>
        <BroadcastTicker tag={ticker.tag} items={ticker.items} />
      </div>
    </main>
  );
}
