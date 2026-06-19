"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { fmtCoins, Coin } from "@/components/value-tag";
import { SeasonPitch } from "@/components/season-pitch";
import { TransferMarket } from "@/components/transfer-market";
import { SeasonStats } from "@/components/season-stats";
import { ScoringRules } from "@/components/scoring-rules";
import {
  ScoreBreakdownLines,
  resultLine,
} from "@/components/player-score-breakdown";
import { TeamCrest } from "@/components/team-crest";
import { crestFor, type CrestMap } from "@/lib/crests";
import { cn } from "@/lib/utils";
import { type Position } from "@/lib/draft";
import {
  type Lineup,
  type TeamRoundRow,
  type PlayerRoundStats,
  computeStandings,
  roundLabel,
} from "@/lib/season";
import { POS_TAG } from "@/components/player-pool";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";

// ── Per-fixture points haul for the current manager ──────────────────────
export type HaulPlayer = {
  id: string;
  name: string;
  position: Position;
  club: string;
  points: number;
  stats: PlayerRoundStats | null;
};
export type FixtureHaul = { total: number; players: HaulPlayer[] };

// ── Shared view types (imported by the season sub-components) ─────────────
export type ViewTeam = {
  id: string;
  name: string;
  userId: string;
  budget: number;
  manager: string;
};
export type ViewPlayer = {
  id: string;
  name: string;
  position: Position;
  club: string;
  rating: number;
  value: number;
  crest?: string | null;
};
export type TeamRound = {
  teamId: string;
  round: number;
  lineup: Lineup;
  points: number | null;
  locked: boolean;
};
export type PlayerScore = {
  round: number;
  playerId: string;
  points: number;
  stats: Record<string, unknown> | null;
};
export type MatchResult = {
  round: number;
  event_id: string;
  home: string;
  away: string;
  home_goals: number;
  away_goals: number;
};
export type Transfer = {
  team_id: string;
  round: number;
  out_player_id: string;
  in_player_id: string;
  fee: number;
};
export type Fixture = {
  id: string;
  label: string;
  starts_at: string | null;
  round: number;
};

export const surname = (name: string) => name.split(" ").slice(-1)[0];

// Locale/timezone-stable date label (avoids server/client hydration mismatch
// from toLocaleDateString). Fixed month names + UTC fields.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(s: string | null): string {
  if (!s) return "TBD";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "TBD";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function SeasonRoom({
  leagueId,
  crests,
  currentUserId,
  isCommissioner,
  seasonStatus,
  currentRound,
  totalRounds,
  freeTransfersPerRound,
  transferFee,
  teams,
  players,
  teamPlayers,
  teamRounds,
  playerScores,
  matchResults,
  transfers,
  fixtures,
}: {
  leagueId: string;
  crests: CrestMap;
  currentUserId: string;
  isCommissioner: boolean;
  seasonStatus: string;
  currentRound: number;
  totalRounds: number;
  freeTransfersPerRound: number;
  transferFee: number;
  teams: ViewTeam[];
  players: ViewPlayer[];
  teamPlayers: { team_id: string; player_id: string; acquired_round: number }[];
  teamRounds: TeamRound[];
  playerScores: PlayerScore[];
  matchResults: MatchResult[];
  transfers: Transfer[];
  fixtures: Fixture[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const playerById = useMemo(
    () => new Map(players.map((p) => [p.id, p])),
    [players],
  );
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const myTeam = teams.find((t) => t.userId === currentUserId) ?? null;
  const finished = seasonStatus === "finished";

  // ── Realtime: refresh on any season change in this league ────────────────
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => router.refresh(), 250);
    };
    const channel = supabase.channel(`season:${leagueId}`);
    for (const table of [
      "leagues",
      "team_rounds",
      "team_players",
      "transfers",
      "match_results",
    ]) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter:
            table === "leagues"
              ? `id=eq.${leagueId}`
              : `league_id=eq.${leagueId}`,
        },
        scheduleRefresh,
      );
    }
    channel.subscribe();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      supabase.removeChannel(channel);
    };
  }, [supabase, leagueId, router]);

  // ── Derived: squads, lineups, standings, scores ──────────────────────────
  const mySquad = useMemo<ViewPlayer[]>(() => {
    if (!myTeam) return [];
    return teamPlayers
      .filter((tp) => tp.team_id === myTeam.id)
      .map((tp) => playerById.get(tp.player_id))
      .filter((p): p is ViewPlayer => Boolean(p));
  }, [teamPlayers, myTeam, playerById]);

  const ownedIds = useMemo(
    () => new Set(teamPlayers.map((tp) => tp.player_id)),
    [teamPlayers],
  );

  const standingRows = useMemo<TeamRoundRow[]>(
    () =>
      teamRounds.map((r) => ({
        teamId: r.teamId,
        round: r.round,
        points: r.points,
      })),
    [teamRounds],
  );
  const standings = useMemo(() => computeStandings(standingRows), [standingRows]);
  const myRank = myTeam
    ? standings.find((s) => s.teamId === myTeam.id)?.rank ?? null
    : null;

  const freeUsed = myTeam
    ? transfers.filter(
        (t) => t.team_id === myTeam.id && t.round === currentRound,
      ).length
    : 0;
  const freeLeft = Math.max(0, freeTransfersPerRound - freeUsed);

  // Manager headline stats (shown above the tab menu, on every tab).
  const myTotal = myTeam
    ? standingRows
        .filter((r) => r.teamId === myTeam.id && r.points != null)
        .reduce((s, r) => s + (r.points ?? 0), 0)
    : 0;
  const lastRoundPts = myTeam
    ? standingRows.find(
        (r) => r.teamId === myTeam.id && r.round === currentRound - 1,
      )?.points ?? null
    : null;

  // Has the current round been played yet? (results exist)
  const currentPlayed = matchResults.some((m) => m.round === currentRound);

  // Per-fixture points haul: for each played round, attribute each of my XI
  // players' points to the fixture their nation featured in. Drives the
  // clickable "+N pts" chip + breakdown on the Fixtures tab.
  const myFixtureHaul = useMemo(() => {
    const map = new Map<string, FixtureHaul>();
    if (!myTeam) return map;

    const playedRounds = new Set(matchResults.map((m) => m.round));
    const scoreByKey = new Map(
      playerScores.map((s) => [`${s.round}:${s.playerId}`, s]),
    );

    for (const tr of teamRounds) {
      if (tr.teamId !== myTeam.id || !playedRounds.has(tr.round)) continue;
      const roundFixtures = fixtures.filter((f) => f.round === tr.round);

      for (const pid of tr.lineup?.xi ?? []) {
        const pl = playerById.get(pid);
        if (!pl) continue;
        const fx = roundFixtures.find((f) => {
          const [h, a] = f.label.split(" vs ");
          return h?.trim() === pl.club || a?.trim() === pl.club;
        });
        if (!fx) continue;

        const sc = scoreByKey.get(`${tr.round}:${pid}`);
        const points = sc?.points ?? 0;
        const entry = map.get(fx.id) ?? { total: 0, players: [] };
        entry.total += points;
        entry.players.push({
          id: pid,
          name: pl.name,
          position: pl.position,
          club: pl.club,
          points,
          stats: (sc?.stats as PlayerRoundStats | null) ?? null,
        });
        map.set(fx.id, entry);
      }
    }

    for (const entry of map.values()) {
      entry.players.sort((a, b) => b.points - a.points);
    }
    return map;
  }, [myTeam, teamRounds, fixtures, playerById, playerScores, matchResults]);

  // ── Actions ───────────────────────────────────────────────────────────────
  async function saveLineup(lineup: Lineup) {
    setBusy(true);
    const { error } = await supabase.rpc("set_lineup", {
      p_league_id: leagueId,
      p_xi: lineup.xi,
      p_bench: lineup.bench,
      p_formation: lineup.formation,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Lineup saved");
      router.refresh();
    }
  }

  async function doTransfer(outId: string, inId: string) {
    setBusy(true);
    const { error } = await supabase.rpc("make_transfer", {
      p_league_id: leagueId,
      p_out: outId,
      p_in: inId,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    toast.success("Transfer complete");
    router.refresh();
    return true;
  }

  async function playRound() {
    setBusy(true);
    const { error } = await supabase.rpc("play_round", {
      p_league_id: leagueId,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(`Round ${currentRound} played`);
      router.refresh();
    }
  }

  const TABS: [string, string][] = [
    ["overview", "Overview"],
    ["xi", "My XI"],
    ["transfers", "Transfers"],
    ["standings", "Table"],
    ["fixtures", "Fixtures"],
    ["stats", "Stats"],
    ["scoring", "Scoring"],
  ];

  return (
    <div className="flex flex-1 flex-col">
      <SeasonScoreboard
        finished={finished}
        currentRound={currentRound}
        totalRounds={totalRounds}
        currentPlayed={currentPlayed}
        isCommissioner={isCommissioner}
        busy={busy}
        champion={finished ? teamById.get(standings[0]?.teamId)?.name : undefined}
        onPlay={playRound}
      />

      {myTeam && (
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Rank" value={myRank ? `${ordinal(myRank)}` : "—"} sub={`of ${teams.length}`} />
          <Stat label="Total pts" value={String(myTotal)} />
          <Stat
            label="Last round"
            value={lastRoundPts != null ? `${lastRoundPts}` : "—"}
            sub={lastRoundPts != null ? "pts" : "not played"}
          />
          <Stat label="Free transfers" value={String(freeLeft)} sub="left this round" />
        </div>
      )}

      <Tabs defaultValue="overview" className="mt-5 flex flex-1 flex-col">
        <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-sm bg-card/70 p-1 ring-1 ring-border sm:grid-cols-7">
          {TABS.map(([v, label]) => (
            <TabsTrigger
              key={v}
              value={v}
              className="kicker rounded-sm py-2 data-active:bg-brand data-active:text-brand-foreground"
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="flex-1">
          <Overview
            crests={crests}
            myTeam={myTeam}
            currentRound={currentRound}
            totalRounds={totalRounds}
            mySquad={mySquad}
            fixtures={fixtures.filter((f) => f.round === currentRound)}
            currentPlayed={currentPlayed}
            finished={finished}
          />
        </TabsContent>

        {/* ── My XI ── */}
        <TabsContent value="xi" className="flex-1">
          {myTeam ? (
            <SeasonPitch
              squad={mySquad}
              playerById={playerById}
              teamRounds={teamRounds.filter((r) => r.teamId === myTeam.id)}
              currentRound={currentRound}
              totalRounds={totalRounds}
              playerScores={playerScores}
              fixtures={fixtures}
              crests={crests}
              busy={busy}
              onSave={saveLineup}
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              You are spectating this league.
            </p>
          )}
        </TabsContent>

        {/* ── Transfers ── */}
        <TabsContent value="transfers" className="flex-1">
          {myTeam ? (
            <TransferMarket
              squad={mySquad}
              freeAgents={players.filter((p) => !ownedIds.has(p.id))}
              budget={myTeam.budget}
              freeLeft={freeLeft}
              transferFee={transferFee}
              locked={currentPlayed}
              busy={busy}
              onTransfer={doTransfer}
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              You are spectating this league.
            </p>
          )}
        </TabsContent>

        {/* ── Standings ── */}
        <TabsContent value="standings" className="flex-1">
          <StandingsTable
            standings={standings}
            teamById={teamById}
            currentUserId={currentUserId}
          />
        </TabsContent>

        {/* ── Fixtures ── */}
        <TabsContent value="fixtures" className="flex-1">
          <FixturesTab
            crests={crests}
            fixtures={fixtures}
            matchResults={matchResults}
            currentRound={currentRound}
            totalRounds={totalRounds}
            myNations={new Set(mySquad.map((p) => p.club))}
            haul={myFixtureHaul}
          />
        </TabsContent>

        {/* ── Stats ── */}
        <TabsContent value="stats" className="flex-1">
          <SeasonStats
            myTeam={myTeam}
            teamRounds={teamRounds}
            standingRows={standingRows}
            playerScores={playerScores}
            playerById={playerById}
            mySquad={mySquad}
          />
        </TabsContent>

        {/* ── Scoring rules ── */}
        <TabsContent value="scoring" className="flex-1">
          <ScoringRules className="py-1" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Scoreboard / commissioner control ────────────────────────────────────
function SeasonScoreboard({
  finished,
  currentRound,
  totalRounds,
  currentPlayed,
  isCommissioner,
  busy,
  champion,
  onPlay,
}: {
  finished: boolean;
  currentRound: number;
  totalRounds: number;
  currentPlayed: boolean;
  isCommissioner: boolean;
  busy: boolean;
  champion?: string;
  onPlay: () => void;
}) {
  if (finished) {
    return (
      <div className="clip-broadcast accent-bar relative overflow-hidden bg-card p-7 pl-8 text-center ring-1 ring-border">
        <div className="kicker">Season complete</div>
        <div className="font-display text-4xl uppercase sm:text-5xl">
          {champion ?? "—"} win
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {totalRounds} rounds played. Check the Table for the final standings.
        </p>
      </div>
    );
  }

  return (
    <div className="clip-broadcast accent-bar relative flex items-center justify-between gap-4 overflow-hidden bg-card p-5 pl-6 ring-1 ring-border">
      <div className="min-w-0 flex-1">
        <div className="kicker flex items-center gap-2">
          <span className="size-1.5 animate-[pulse-danger_1.4s_ease-in-out_infinite] rounded-full bg-brand" />
          {roundLabel(currentRound, totalRounds)}
        </div>
        <div className="mt-1 font-display text-2xl uppercase leading-[0.92]">
          {currentPlayed ? "Round in the books" : "Round open"}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {currentPlayed
            ? "Results are in — set up the next round."
            : "Edit your XI and transfers before kickoff."}
        </div>
      </div>
      {isCommissioner && !currentPlayed && (
        <Button
          onClick={onPlay}
          disabled={busy}
          className="sheen h-12 shrink-0 font-display uppercase tracking-wider"
        >
          {busy ? "Playing…" : `Play round ${currentRound}`}
        </Button>
      )}
      {!isCommissioner && !currentPlayed && (
        <span className="kicker shrink-0 text-muted-foreground">
          Waiting for commissioner
        </span>
      )}
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────
function Overview({
  crests,
  myTeam,
  currentRound,
  totalRounds,
  mySquad,
  fixtures,
  currentPlayed,
  finished,
}: {
  crests: CrestMap;
  myTeam: ViewTeam | null;
  currentRound: number;
  totalRounds: number;
  mySquad: ViewPlayer[];
  fixtures: Fixture[];
  currentPlayed: boolean;
  finished: boolean;
}) {
  const myNations = new Set(mySquad.map((p) => p.club));

  return (
    <div className="space-y-5">
      {myTeam && (
        <div className="flex items-center justify-between rounded-sm bg-card/60 px-4 py-3 ring-1 ring-border">
          <span className="kicker text-foreground">Budget</span>
          <span className="inline-flex items-center gap-1.5 font-display text-lg tabular-nums text-amber-300">
            <Coin /> {fmtCoins(myTeam.budget)}
          </span>
        </div>
      )}

      {!finished && (
        <div>
          <h3 className="kicker mb-2 text-foreground">
            Round {currentRound} fixtures · your nations highlighted
          </h3>
          <div className="clip-broadcast divide-y divide-border bg-background/40 ring-1 ring-border">
            {fixtures.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No fixtures this round.
              </p>
            )}
            {fixtures.slice(0, 10).map((f, i) => {
              const [home, away] = f.label.split(" vs ");
              const mine = myNations.has(home) || myNations.has(away);
              return (
                <div
                  key={f.id}
                  className={cn(
                    "animate-rise flex items-center justify-between px-4 py-2.5 text-sm",
                    mine && "bg-brand/5",
                  )}
                  style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
                >
                  <span
                    className={cn(
                      "flex items-center gap-1.5",
                      mine && "font-medium text-brand",
                    )}
                  >
                    <TeamCrest src={crestFor(crests, home)} name={home} size={15} />
                    <span>{home}</span>
                    <span className="text-muted-foreground">v</span>
                    <span>{away}</span>
                    <TeamCrest src={crestFor(crests, away)} name={away} size={15} />
                  </span>
                  <span className="kicker text-muted-foreground">
                    {fmtDate(f.starts_at)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        {currentPlayed
          ? "This round has been played — results are on the other tabs."
          : `${roundLabel(currentRound, totalRounds)} is open. Set your XI and make transfers before the commissioner plays it.`}
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="clip-broadcast bg-card/60 p-3 ring-1 ring-border">
      <div className="kicker text-[0.6rem]">{label}</div>
      <div className="mt-1 font-display text-2xl leading-none tabular-nums">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[0.65rem] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ── Standings tab ──────────────────────────────────────────────────────────
function StandingsTable({
  standings,
  teamById,
  currentUserId,
}: {
  standings: ReturnType<typeof computeStandings>;
  teamById: Map<string, ViewTeam>;
  currentUserId: string;
}) {
  if (standings.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No rounds played yet — the table fills once the season kicks off.
      </p>
    );
  }
  return (
    <div className="clip-broadcast divide-y divide-border bg-background/40 ring-1 ring-border">
      <div className="kicker flex items-center gap-3 px-3 py-2 text-[0.6rem] text-muted-foreground">
        <span className="w-5 text-center">#</span>
        <span className="flex-1">Manager</span>
        <span className="w-12 text-right">Played</span>
        <span className="w-14 text-right">Points</span>
      </div>
      {standings.map((s, i) => {
        const t = teamById.get(s.teamId);
        const me = t?.userId === currentUserId;
        return (
          <div
            key={s.teamId}
            className={cn(
              "animate-rise flex items-center gap-3 px-3 py-3 text-sm",
              me && "bg-brand/10",
            )}
            style={{ animationDelay: `${Math.min(i, 12) * 45}ms` }}
          >
            <RankPip rank={s.rank} />
            <span className="min-w-0 flex-1">
              <span className="font-display uppercase">{t?.name ?? "—"}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {t?.manager}
                {me && <span className="text-brand"> · You</span>}
              </span>
            </span>
            <span className="w-12 text-right tabular-nums text-muted-foreground">
              {s.played}
            </span>
            <span className="w-14 text-right font-display text-lg tabular-nums text-brand">
              {s.total}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Podium medal for the top three, plain number otherwise.
const MEDAL: Record<number, string> = {
  1: "bg-amber-300/20 text-amber-200 ring-amber-300/50",
  2: "bg-slate-300/15 text-slate-100 ring-slate-300/40",
  3: "bg-orange-400/15 text-orange-300 ring-orange-400/40",
};
function RankPip({ rank }: { rank: number }) {
  const medal = MEDAL[rank];
  if (!medal) {
    return (
      <span className="grid size-7 shrink-0 place-items-center font-display tabular-nums text-muted-foreground">
        {rank}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center rounded-sm font-display text-sm tabular-nums ring-1",
        medal,
      )}
    >
      {rank}
    </span>
  );
}

// ── Fixtures tab ────────────────────────────────────────────────────────────
function FixturesTab({
  crests,
  fixtures,
  matchResults,
  currentRound,
  totalRounds,
  myNations,
  haul,
}: {
  crests: CrestMap;
  fixtures: Fixture[];
  matchResults: MatchResult[];
  currentRound: number;
  totalRounds: number;
  myNations: Set<string>;
  haul: Map<string, FixtureHaul>;
}) {
  const [detail, setDetail] = useState<{
    fixture: Fixture;
    haul: FixtureHaul;
  } | null>(null);
  const resultByEvent = useMemo(
    () => new Map(matchResults.map((m) => [m.event_id, m])),
    [matchResults],
  );
  const rounds = useMemo(
    () => [...new Set(fixtures.map((f) => f.round))].sort((a, b) => a - b),
    [fixtures],
  );

  return (
    <div className="space-y-6">
      {rounds.map((round) => {
        const list = fixtures.filter((f) => f.round === round);
        const played = list.some((f) => resultByEvent.has(f.id));
        return (
          <div key={round}>
            <h3 className="kicker mb-2 flex items-center gap-2 text-foreground">
              {roundLabel(round, totalRounds)}
              {round === currentRound && (
                <span className="rounded-sm bg-brand/15 px-1.5 py-0.5 text-[0.6rem] text-brand ring-1 ring-brand/30">
                  current
                </span>
              )}
              {played && <span className="text-[0.6rem] text-muted-foreground">FT</span>}
            </h3>
            <div className="clip-broadcast divide-y divide-border bg-background/40 ring-1 ring-border">
              {list.map((f) => {
                const [home, away] = f.label.split(" vs ");
                const r = resultByEvent.get(f.id);
                const mine = myNations.has(home) || myNations.has(away);
                const h = haul.get(f.id);
                return (
                  <div
                    key={f.id}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2.5 text-sm",
                      mine && "bg-brand/5",
                    )}
                  >
                    <span
                      className={cn(
                        "flex flex-1 items-center justify-end gap-1.5",
                        mine && myNations.has(home) && "font-medium text-brand",
                      )}
                    >
                      <span className="truncate">{home}</span>
                      <TeamCrest src={crestFor(crests, home)} name={home} size={16} />
                    </span>
                    <span className="shrink-0 rounded-sm bg-card px-2 py-0.5 font-display tabular-nums ring-1 ring-border">
                      {r ? `${r.home_goals}–${r.away_goals}` : "vs"}
                    </span>
                    <span
                      className={cn(
                        "flex flex-1 items-center gap-1.5",
                        mine && myNations.has(away) && "font-medium text-brand",
                      )}
                    >
                      <TeamCrest src={crestFor(crests, away)} name={away} size={16} />
                      <span className="truncate">{away}</span>
                    </span>
                    {h ? (
                      <button
                        type="button"
                        onClick={() => setDetail({ fixture: f, haul: h })}
                        title="Your points from this game — tap for the breakdown"
                        className="sheen group flex shrink-0 items-center gap-1 rounded-sm bg-brand/15 py-1 pl-2 pr-1.5 font-display text-xs tabular-nums text-brand ring-1 ring-brand/30 transition hover:bg-brand/25"
                      >
                        +{h.total}
                        <ChevronRight className="size-3.5 opacity-70 transition-transform group-hover:translate-x-0.5" />
                      </button>
                    ) : (
                      <span className="w-12 shrink-0" aria-hidden />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="clip-broadcast border-0 bg-card p-0 ring-1 ring-border sm:max-w-md">
          {detail && (
            <div className="accent-bar p-5 pl-6">
              <DialogHeader>
                <div className="kicker">
                  {roundLabel(detail.fixture.round, totalRounds)} · your haul
                </div>
                <DialogTitle className="font-display text-2xl uppercase">
                  {detail.fixture.label}
                </DialogTitle>
              </DialogHeader>

              <div className="mt-3 flex items-center justify-between rounded-sm bg-background/40 px-4 py-3 ring-1 ring-border">
                <span className="font-display text-sm tabular-nums text-muted-foreground">
                  {(() => {
                    const r = resultByEvent.get(detail.fixture.id);
                    return r ? `FT ${r.home_goals}–${r.away_goals}` : "—";
                  })()}
                </span>
                <span className="font-display text-2xl tabular-nums text-brand">
                  +{detail.haul.total}
                  <span className="ml-1 text-sm">pts</span>
                </span>
              </div>

              <ul className="mt-3 space-y-1.5">
                {detail.haul.players.map((p) => (
                  <PlayerHaulRow key={p.id} player={p} />
                ))}
              </ul>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── One player's haul, with the per-category points breakdown (D3) ────────
function PlayerHaulRow({ player }: { player: HaulPlayer }) {
  return (
    <li className="rounded-sm bg-background/40 px-3 py-2 ring-1 ring-border">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid w-9 shrink-0 place-items-center rounded-sm py-0.5 font-display text-[10px] ring-1",
            POS_TAG[player.position],
          )}
        >
          {player.position}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-sm uppercase leading-tight">
            {player.name}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {resultLine(player.stats)}
          </span>
        </span>
        <span className="font-display text-lg tabular-nums text-brand">
          {player.points}
        </span>
      </div>

      <div className="mt-1.5 border-t border-border/60 pt-1.5">
        <ScoreBreakdownLines stats={player.stats} position={player.position} />
      </div>
    </li>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
