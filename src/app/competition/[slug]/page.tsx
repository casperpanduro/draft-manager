import Link from "next/link";
import { Plus, Ticket } from "lucide-react";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayMeta, accentStyle } from "@/lib/competition-branding";
import { competitionBg } from "@/lib/competition-bg";
import { CompetitionCrest } from "@/components/competition-crest";
import {
  CreateLeagueDialog,
  JoinLeagueDialog,
} from "@/components/dashboard-actions";
import { Container } from "@/components/container";
import { CompetitionBackdrop } from "@/components/competition-backdrop";
import { FixturesList } from "@/components/fixtures-list";
import { ScoringRules } from "@/components/scoring-rules";
import { getCrestMap } from "@/lib/crests";

const STATUS: Record<string, { label: string; live?: boolean }> = {
  lobby: { label: "In lobby" },
  drafting: { label: "Live", live: true },
  complete: { label: "Complete" },
};

export default async function CompetitionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: comp } = await supabase
    .from("competitions")
    .select("*")
    .eq("slug", slug)
    .single();

  // Only playable competitions have a real page; everything else is 404.
  if (!comp || !comp.playable) notFound();

  const { data: teams } = await supabase
    .from("teams")
    .select(
      "id, name, league:leagues!inner(id, name, status, competition_id)",
    )
    .eq("user_id", user.id)
    .eq("league.competition_id", comp.id)
    .order("created_at");

  const { data: events } = await supabase
    .from("events")
    .select("id, label, starts_at, status, result")
    .eq("competition_id", comp.id)
    .order("starts_at")
    .limit(20);

  const crests = await getCrestMap(supabase, comp.id);

  const myLeagues = (teams ?? []).filter((t) => t.league);
  const meta = displayMeta(comp);
  const bg = comp.bg_url || competitionBg(slug);
  const joined = myLeagues.length > 0;
  const live = myLeagues.some((t) => t.league!.status === "drafting");

  return (
    <main
      data-theme={meta.theme}
      style={accentStyle(comp.accent)}
      className="relative flex flex-1 flex-col"
    >
      {/* Full-page background: competition art up top, fading to black below */}
      <CompetitionBackdrop bg={bg} variant="hero" />

      {/* Hero — free over the art */}
      <Container size="wide" className="relative px-5 pb-8 pt-5">
        <Link
          href="/dashboard"
          className="kicker inline-flex items-center gap-1.5 text-white/90 transition-colors hover:text-white"
        >
          ← Dugout
        </Link>
        <div className="mt-24 flex items-end gap-4 sm:mt-32">
          <CompetitionCrest
            short={meta.short}
            className="h-20 w-auto drop-shadow-xl"
          />
          <div className="min-w-0 pb-1">
            <div className="kicker text-foreground/80 drop-shadow">
              {meta.tagline}
            </div>
            <h1 className="font-display text-4xl uppercase leading-[0.95] drop-shadow-lg sm:text-5xl">
              {comp.name}
            </h1>
            {joined && (
              <div className="mt-2 flex items-center gap-1.5 text-xs">
                <span className="size-1.5 rounded-full bg-brand" />
                <span className="kicker text-brand">
                  Joined · {myLeagues.length}{" "}
                  {myLeagues.length === 1 ? "league" : "leagues"}
                </span>
                {live && (
                  <span className="ml-1 flex items-center gap-1">
                    <span className="size-1.5 animate-[pulse-danger_1.2s_ease-in-out_infinite] rounded-full bg-destructive" />
                    <span className="kicker text-destructive">Live</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </Container>

      {/* Content card */}
      <Container size="wide" className="relative flex-1 px-5 pb-16">
        <div className="clip-broadcast bg-pitch animate-rise p-4 shadow-2xl shadow-black/40 ring-1 ring-border sm:p-6">
          {/* Actions */}
          <div className="grid grid-cols-2 gap-2.5 sm:max-w-md">
            <CreateLeagueDialog
              lockedSlug={slug}
              trigger={
                <button className="clip-broadcast sheen group flex h-full flex-col justify-between gap-6 bg-brand p-4 text-left text-brand-foreground ring-1 ring-transparent transition-all hover:brightness-110">
                  <span className="grid size-9 place-items-center rounded-sm bg-brand-foreground/15">
                    <Plus className="size-5" strokeWidth={2.5} />
                  </span>
                  <span>
                    <span className="block font-display text-lg uppercase leading-none">
                      New league
                    </span>
                    <span className="mt-1 block text-xs opacity-80">
                      You&apos;re the gaffer
                    </span>
                  </span>
                </button>
              }
            />
            <JoinLeagueDialog
              trigger={
                <button className="clip-broadcast group flex h-full flex-col justify-between gap-6 bg-background/60 p-4 text-left ring-1 ring-border transition-all hover:ring-brand/60">
                  <span className="grid size-9 place-items-center rounded-sm bg-card text-brand ring-1 ring-border transition-colors group-hover:ring-brand/50">
                    <Ticket className="size-5" />
                  </span>
                  <span>
                    <span className="block font-display text-lg uppercase leading-none">
                      Join league
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Got an invite code?
                    </span>
                  </span>
                </button>
              }
            />
          </div>

          {/* Your leagues here */}
          <h2 className="kicker mb-3 mt-8 text-foreground">
            Your {meta.short} leagues · {myLeagues.length}
          </h2>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {myLeagues.length === 0 && (
              <div className="clip-broadcast bg-background/40 px-5 py-12 text-center ring-1 ring-border sm:col-span-2">
                <p className="font-display text-xl uppercase text-muted-foreground">
                  No leagues yet
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Create one or join with a code to get started.
                </p>
              </div>
            )}

            {myLeagues.map((t, i) => {
            const league = t.league!;
            const status = STATUS[league.status] ?? { label: league.status };
            const href =
              league.status === "lobby"
                ? `/league/${league.id}`
                : `/league/${league.id}/draft`;
            return (
              <Link
                key={t.id}
                href={href}
                className="animate-rise group block"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="clip-broadcast accent-bar relative flex items-center gap-4 bg-card py-3.5 pl-5 pr-4 ring-1 ring-border transition-all group-hover:ring-brand/60 group-hover:brightness-110">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-lg uppercase leading-tight">
                      {league.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t.name}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {status.live && (
                      <span className="size-1.5 animate-[pulse-danger_1.2s_ease-in-out_infinite] rounded-full bg-destructive" />
                    )}
                    <span className="kicker text-foreground/80">
                      {status.label}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
          </div>

          <FixturesList events={events ?? []} crests={crests} />

          <div className="mt-8">
            <ScoringRules />
          </div>
        </div>
      </Container>
    </main>
  );
}
