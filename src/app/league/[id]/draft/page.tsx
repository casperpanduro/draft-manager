import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { displayMeta, accentStyle } from "@/lib/competition-branding";
import { competitionBg } from "@/lib/competition-bg";
import { type Position } from "@/lib/draft";
import { Container } from "@/components/container";
import { CompetitionCrest } from "@/components/competition-crest";
import { DraftRoom } from "@/components/draft-room";

export default async function DraftPage({
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
  if (league.status === "lobby") redirect(`/league/${id}`);

  const [{ data: teams }, { data: players }, { data: picks }] =
    await Promise.all([
      supabase
        .from("teams")
        .select(
          "id, name, user_id, draft_position, draft_queue, profile:profiles(display_name)",
        )
        .eq("league_id", id)
        .order("draft_position"),
      supabase
        .from("players")
        .select("id, name, position, club, rating, value")
        .eq("competition_id", league.competition_id)
        .order("rating", { ascending: false }),
      supabase
        .from("draft_picks")
        .select("id, player_id, team_id, pick_number, round, auto_picked")
        .eq("league_id", id)
        .order("pick_number"),
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

      {/* Compact branded hero */}
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
            <div className="kicker text-foreground/80 drop-shadow">{meta.name} · Draft</div>
            <h1 className="truncate font-display text-2xl uppercase leading-none drop-shadow-lg sm:text-3xl">
              {league.name}
            </h1>
          </div>
        </div>
      </Container>

      {/* Content card */}
      <Container className="relative flex-1 px-5 pb-10">
        <div className="clip-broadcast bg-pitch animate-rise p-3 shadow-2xl shadow-black/40 ring-1 ring-border sm:p-4">
          <DraftRoom
            leagueId={id}
            currentUserId={user.id}
            clockSeconds={league.clock_seconds}
            initialStatus={league.status}
            initialPickNumber={league.current_pick_number}
            initialDeadline={league.pick_deadline}
            teams={(teams ?? []).map((t) => ({
              id: t.id,
              name: t.name,
              userId: t.user_id,
              seat: t.draft_position ?? 0,
              manager: t.profile?.display_name ?? "Manager",
            }))}
            players={(players ?? []).map((p) => ({
              ...p,
              position: p.position as Position,
            }))}
            initialPicks={picks ?? []}
            initialQueue={myQueue}
          />
        </div>
      </Container>
    </main>
  );
}
