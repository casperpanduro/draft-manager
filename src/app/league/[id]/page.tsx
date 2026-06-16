import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayMeta, accentStyle } from "@/lib/competition-branding";
import { competitionBg } from "@/lib/competition-bg";
import { Container } from "@/components/container";
import { CompetitionCrest } from "@/components/competition-crest";
import { LobbyClient } from "@/components/lobby-client";
import { type Position } from "@/lib/draft";

export default async function LeaguePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: league } = await supabase
    .from("leagues")
    .select(
      "*, competition:competitions(slug, name, short, tagline, theme, accent, bg_url)",
    )
    .eq("id", id)
    .single();

  if (!league) notFound();
  if (league.status !== "lobby") redirect(`/league/${id}/draft`);

  const [{ data: teams }, { data: players }] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name, user_id, draft_queue, profile:profiles(display_name)")
      .eq("league_id", id)
      .order("created_at"),
    supabase
      .from("players")
      .select("id, name, position, club, rating, value")
      .eq("competition_id", league.competition_id)
      .order("rating", { ascending: false }),
  ]);

  const comp = league.competition!;
  const meta = displayMeta(comp);
  const bg = comp.bg_url || competitionBg(comp.slug);
  const myQueue =
    ((teams ?? []).find((t) => t.user_id === user.id)?.draft_queue as
      | string[]
      | null) ?? [];

  return (
    <main
      data-theme={meta.theme}
      style={accentStyle(comp.accent)}
      className="relative flex flex-1 flex-col"
    >
      {/* Full-page competition art, fading to black for readability */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{ background: "var(--brand-gradient)", opacity: 0.35 }}
        />
        {bg ? (
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${bg})` }}
          />
        ) : (
          <div className="bg-pitch absolute inset-0 opacity-70" />
        )}
        <div className="bg-grain absolute inset-0 opacity-[0.08] mix-blend-overlay" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/85 via-background/60 to-background/30" />
      </div>

      {/* Branded hero */}
      <Container className="relative px-5 pb-6 pt-5">
        <Link
          href="/dashboard"
          className="kicker inline-flex items-center gap-1.5 text-white/90 transition-colors hover:text-white"
        >
          ← Dugout
        </Link>
        <div className="mt-16 flex items-end gap-4 sm:mt-24">
          <CompetitionCrest short={meta.short} className="h-16 w-auto drop-shadow-xl" />
          <div className="min-w-0 pb-1">
            <div className="kicker text-foreground/80 drop-shadow">{meta.name} · Lobby</div>
            <h1 className="truncate font-display text-4xl uppercase leading-[0.95] drop-shadow-lg sm:text-5xl">
              {league.name}
            </h1>
          </div>
        </div>
      </Container>

      <LobbyClient
        leagueId={id}
        joinCode={league.join_code}
        commissionerId={league.commissioner_id}
        currentUserId={user.id}
        initialTeams={(teams ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          user_id: t.user_id,
          profile: t.profile,
        }))}
        players={(players ?? []).map((p) => ({
          ...p,
          position: p.position as Position,
        }))}
        initialQueue={myQueue}
      />
    </main>
  );
}
