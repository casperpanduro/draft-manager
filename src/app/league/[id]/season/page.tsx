import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayMeta, accentStyle } from "@/lib/competition-branding";
import { competitionBg } from "@/lib/competition-bg";
import { Container } from "@/components/container";
import { CompetitionCrest } from "@/components/competition-crest";
import { CompetitionBackdrop } from "@/components/competition-backdrop";
import { SeasonRoom } from "@/components/season-room";
import { getCrestMap, crestFor } from "@/lib/crests";
import { type Position, DEFAULT_FORMATION } from "@/lib/draft";
import { type Lineup } from "@/lib/season";

/** Read a stored lineup JSONB, defaulting the formation for legacy rows. */
function normalizeLineup(raw: unknown): Lineup {
  const l = (raw ?? {}) as Partial<Lineup>;
  return {
    xi: l.xi ?? [],
    bench: l.bench ?? [],
    formation: l.formation || DEFAULT_FORMATION,
  };
}

export default async function SeasonPage({
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
  // Route to the right screen for the league's phase.
  if (league.status === "lobby") redirect(`/league/${id}`);
  if (league.status !== "complete") redirect(`/league/${id}/draft`);

  const [
    { data: teams },
    { data: players },
    { data: teamPlayers },
    { data: teamRounds },
    { data: playerScores },
    { data: matchResults },
    { data: transfers },
    { data: fixtures },
  ] = await Promise.all([
    supabase
      .from("teams")
      .select("id, name, user_id, budget, profile:profiles(display_name)")
      .eq("league_id", id)
      .order("created_at"),
    supabase
      .from("players")
      .select("id, name, position, club, rating, value")
      .eq("competition_id", league.competition_id)
      .order("rating", { ascending: false }),
    supabase
      .from("team_players")
      .select("team_id, player_id, acquired_round")
      .eq("league_id", id),
    supabase
      .from("team_rounds")
      .select("team_id, round, lineup, points, locked")
      .eq("league_id", id)
      .order("round"),
    supabase
      .from("player_scores")
      .select("round, player_id, points, stats")
      .eq("league_id", id),
    supabase
      .from("match_results")
      .select("round, event_id, home, away, home_goals, away_goals")
      .eq("league_id", id)
      .order("round"),
    supabase
      .from("transfers")
      .select("team_id, round, out_player_id, in_player_id, fee")
      .eq("league_id", id),
    supabase
      .from("event_rounds")
      .select("id, label, starts_at, round")
      .eq("competition_id", league.competition_id)
      .order("starts_at"),
  ]);

  const comp = league.competition!;
  const meta = displayMeta(comp);
  const bg = comp.bg_url || competitionBg(comp.slug);
  const crests = await getCrestMap(supabase, league.competition_id);

  return (
    <main
      data-theme={meta.theme}
      style={accentStyle(comp.accent)}
      className="relative flex flex-1 flex-col"
    >
      <CompetitionBackdrop bg={bg} />

      <Container className="relative px-5 pb-3 pt-4">
        <Link
          href="/dashboard"
          className="kicker inline-flex items-center gap-1.5 text-white/90 transition-colors hover:text-white"
        >
          ← Dugout
        </Link>
        <div className="mt-3 flex items-center gap-3">
          <CompetitionCrest short={meta.short} className="h-12 w-auto drop-shadow-xl" />
          <div className="min-w-0">
            <div className="kicker text-foreground/80 drop-shadow">
              {meta.name} · Season
            </div>
            <h1 className="truncate font-display text-2xl uppercase leading-none drop-shadow-lg sm:text-3xl">
              {league.name}
            </h1>
          </div>
        </div>
      </Container>

      <Container className="relative flex-1 px-5 pb-10">
        <div className="clip-broadcast bg-pitch animate-rise p-3 shadow-2xl shadow-black/40 ring-1 ring-border sm:p-4">
          <SeasonRoom
            leagueId={id}
            crests={crests}
            currentUserId={user.id}
            isCommissioner={league.commissioner_id === user.id}
            seasonStatus={league.season_status}
            currentRound={league.current_round}
            totalRounds={league.total_rounds}
            freeTransfersPerRound={league.free_transfers_per_round}
            transferFee={league.transfer_fee}
            teams={(teams ?? []).map((t) => ({
              id: t.id,
              name: t.name,
              userId: t.user_id,
              budget: t.budget,
              manager: t.profile?.display_name ?? "Manager",
            }))}
            players={(players ?? []).map((p) => ({
              ...p,
              position: p.position as Position,
              crest: crestFor(crests, p.club),
            }))}
            teamPlayers={teamPlayers ?? []}
            teamRounds={(teamRounds ?? []).map((r) => ({
              teamId: r.team_id,
              round: r.round,
              lineup: normalizeLineup(r.lineup),
              points: r.points,
              locked: r.locked,
            }))}
            playerScores={(playerScores ?? []).map((s) => ({
              round: s.round,
              playerId: s.player_id,
              points: s.points,
              stats: s.stats as Record<string, unknown> | null,
            }))}
            matchResults={matchResults ?? []}
            transfers={transfers ?? []}
            fixtures={(fixtures ?? [])
              .filter((f) => f.id && f.round != null)
              .map((f) => ({
                id: f.id!,
                label: f.label ?? "",
                starts_at: f.starts_at,
                round: f.round!,
              }))}
          />
        </div>
      </Container>
    </main>
  );
}
