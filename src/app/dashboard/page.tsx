import Link from "next/link";
import { Ticket } from "lucide-react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { competitionMeta } from "@/lib/competitions";
import { competitionBg } from "@/lib/competition-bg";
import { Button } from "@/components/ui/button";
import { JoinLeagueDialog } from "@/components/dashboard-actions";
import {
  CompetitionCard,
  type CompetitionCardData,
} from "@/components/competition-card";
import { BrandMark } from "@/components/brand-mark";
import { BroadcastTicker } from "@/components/broadcast-ticker";
import { getTickerData } from "@/lib/ticker";
import { Container } from "@/components/container";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: profile }, { data: competitions }, { data: teams }] =
    await Promise.all([
      supabase.from("profiles").select("display_name, is_admin").eq("id", user.id).single(),
      supabase.from("competitions").select("*").order("sort"),
      supabase
        .from("teams")
        .select(
          "id, name, league:leagues(id, name, status, competition:competitions(slug))",
        )
        .eq("user_id", user.id),
    ]);

  const myTeams = (teams ?? []).filter((t) => t.league);

  // Per-competition rollup: how many of my leagues live here + any drafting now.
  const stats = new Map<string, { joined: number; live: boolean }>();
  for (const t of myTeams) {
    const slug = t.league!.competition!.slug;
    const s = stats.get(slug) ?? { joined: 0, live: false };
    s.joined += 1;
    if (t.league!.status === "drafting") s.live = true;
    stats.set(slug, s);
  }

  const cards: CompetitionCardData[] = (competitions ?? []).map((c) => {
    const s = stats.get(c.slug);
    return {
      slug: c.slug,
      name: c.name,
      playable: c.playable,
      joined: s?.joined ?? 0,
      live: s?.live ?? false,
      bg: c.bg_url || competitionBg(c.slug),
      accent: c.accent,
    };
  });

  const ticker = await getTickerData(supabase);

  // Jump back in: active leagues only (lobby / drafting), live ones first.
  const active = myTeams
    .filter((t) => t.league!.status !== "complete")
    .sort((a, b) =>
      a.league!.status === b.league!.status
        ? 0
        : a.league!.status === "drafting"
          ? -1
          : 1,
    );

  return (
    <Container as="main" size="wide" className="flex-1 px-5 pb-16">
      {/* Top bar */}
      <header className="flex items-center justify-between py-5">
        <div className="flex items-center gap-2.5">
          <BrandMark className="size-8" />
          <span className="font-display text-sm uppercase tracking-[0.2em]">
            Draft Manager
          </span>
        </div>
        <div className="flex items-center gap-1">
          {profile?.is_admin && (
            <Button
              render={<Link href="/admin" />}
              variant="ghost"
              size="sm"
              className="kicker"
            >
              Admin
            </Button>
          )}
          <JoinLeagueDialog
            trigger={
              <Button variant="ghost" size="sm" className="kicker gap-1.5">
                <Ticket className="size-3.5" />
                Join
              </Button>
            }
          />
          <form action="/auth/signout" method="post">
            <Button variant="ghost" size="sm" type="submit" className="kicker">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      {/* Broadcast ticker (flush within the content column) */}
      <div className="animate-rise -mx-5">
        <BroadcastTicker tag={ticker.tag} items={ticker.items} />
      </div>

      {/* Title block */}
      <div className="animate-rise mb-7 mt-5">
        <div className="kicker">{profile?.display_name ?? user.email}</div>
        <h1 className="font-display text-5xl uppercase leading-none">
          The Gaffer&apos;s
          <br />
          <span className="text-muted-foreground">dugout</span>
        </h1>
      </div>

      {/* Jump back in */}
      {active.length > 0 && (
        <section className="animate-rise mb-8 max-w-3xl">
          <h2 className="kicker mb-3 text-foreground">Jump back in</h2>
          <div className="space-y-2.5">
            {active.map((t) => {
              const league = t.league!;
              const meta = competitionMeta(league.competition!.slug);
              const live = league.status === "drafting";
              const href = live
                ? `/league/${league.id}/draft`
                : `/league/${league.id}`;
              return (
                <Link
                  key={t.id}
                  href={href}
                  data-theme={meta.theme}
                  className="group block"
                >
                  <div className="clip-broadcast accent-bar relative flex items-center gap-4 bg-card py-3.5 pl-5 pr-4 ring-1 ring-border transition-all group-hover:ring-brand/60 group-hover:brightness-110">
                    <div
                      className="grid size-11 shrink-0 place-items-center rounded-sm font-display text-xs text-brand-foreground"
                      style={{ background: "var(--brand-gradient)" }}
                    >
                      {meta.short}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-lg uppercase leading-tight">
                        {league.name}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {meta.name} · {t.name}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {live && (
                        <span className="size-1.5 animate-[pulse-danger_1.2s_ease-in-out_infinite] rounded-full bg-destructive" />
                      )}
                      <span className="kicker text-foreground/80">
                        {live ? "Live" : "In lobby"}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Competitions */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="kicker text-foreground">Competitions</h2>
      </div>
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 lg:grid-cols-4">
        {cards.map((comp, i) => (
          <CompetitionCard key={comp.slug} comp={comp} index={i} />
        ))}
      </div>
    </Container>
  );
}
