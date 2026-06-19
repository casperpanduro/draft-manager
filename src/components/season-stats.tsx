"use client";

import { useMemo } from "react";
import { PlayerAvatar } from "@/components/player-avatar";
import { RatingBadge } from "@/components/rating-badge";
import { cn } from "@/lib/utils";
import {
  type TeamRoundRow,
  computeTimeline,
  squadStrength,
} from "@/lib/season";
import {
  type ViewTeam,
  type ViewPlayer,
  type TeamRound,
  type PlayerScore,
} from "@/components/season-room";

export function SeasonStats({
  myTeam,
  teamRounds,
  standingRows,
  playerScores,
  playerById,
  mySquad,
}: {
  myTeam: ViewTeam | null;
  teamRounds: TeamRound[];
  standingRows: TeamRoundRow[];
  playerScores: PlayerScore[];
  playerById: Map<string, ViewPlayer>;
  mySquad: ViewPlayer[];
}) {
  const timeline = useMemo(
    () => (myTeam ? computeTimeline(myTeam.id, standingRows) : []),
    [myTeam, standingRows],
  );

  // Squad strength per played round, from that round's stored XI.
  const strengthByRound = useMemo(() => {
    const m = new Map<number, number>();
    if (!myTeam) return m;
    for (const tr of teamRounds) {
      if (tr.teamId !== myTeam.id || tr.points == null) continue;
      m.set(
        tr.round,
        squadStrength(tr.lineup.xi.map((id) => playerById.get(id)?.rating ?? 0)),
      );
    }
    return m;
  }, [teamRounds, myTeam, playerById]);

  // Player totals (mine + league leaders) across all played rounds.
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of playerScores)
      m.set(s.playerId, (m.get(s.playerId) ?? 0) + s.points);
    return m;
  }, [playerScores]);

  const mySquadRanked = useMemo(
    () =>
      [...mySquad]
        .map((p) => ({ p, pts: totals.get(p.id) ?? 0 }))
        .sort((a, b) => b.pts - a.pts),
    [mySquad, totals],
  );

  const leaders = useMemo(
    () =>
      [...totals.entries()]
        .map(([id, pts]) => ({ p: playerById.get(id), pts }))
        .filter((x): x is { p: ViewPlayer; pts: number } => Boolean(x.p))
        .sort((a, b) => b.pts - a.pts)
        .slice(0, 10),
    [totals, playerById],
  );

  if (timeline.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Stats appear once the first round has been played.
      </p>
    );
  }

  return (
    <div className="space-y-7">
      {/* Cumulative points sparkline */}
      <div>
        <h3 className="kicker mb-2 text-foreground">Points trajectory</h3>
        <div className="clip-broadcast bg-card/60 p-4 ring-1 ring-border">
          <Sparkline values={timeline.map((t) => t.cumulative)} />
          <div className="mt-2 flex justify-between text-[0.65rem] text-muted-foreground">
            <span>R{timeline[0].round}</span>
            <span className="font-display text-base tabular-nums text-brand">
              {timeline[timeline.length - 1].cumulative} pts
            </span>
            <span>R{timeline[timeline.length - 1].round}</span>
          </div>
        </div>
      </div>

      {/* Per-round progression */}
      <div>
        <h3 className="kicker mb-2 text-foreground">Round by round</h3>
        <div className="clip-broadcast divide-y divide-border bg-background/40 ring-1 ring-border">
          {timeline.map((t) => (
            <div key={t.round} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <span className="kicker w-12 text-muted-foreground">R{t.round}</span>
              <span className="w-14 font-display text-lg tabular-nums text-brand">
                {t.points}
              </span>
              <span className="flex-1 text-xs text-muted-foreground">
                total {t.cumulative} · ⌀ {strengthByRound.get(t.round) ?? "—"}
              </span>
              <RankBadge rank={t.rank} delta={t.rankDelta} />
            </div>
          ))}
        </div>
      </div>

      {/* My squad scorers */}
      <div>
        <h3 className="kicker mb-2 text-foreground">Your scorers</h3>
        <div className="clip-broadcast divide-y divide-border bg-background/40 ring-1 ring-border">
          {mySquadRanked.map(({ p, pts }) => (
            <PlayerRow key={p.id} p={p} pts={pts} />
          ))}
        </div>
      </div>

      {/* League leaders */}
      <div>
        <h3 className="kicker mb-2 text-foreground">League top scorers</h3>
        <div className="clip-broadcast divide-y divide-border bg-background/40 ring-1 ring-border">
          {leaders.map(({ p, pts }, i) => (
            <PlayerRow key={p.id} p={p} pts={pts} rank={i + 1} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PlayerRow({
  p,
  pts,
  rank,
}: {
  p: ViewPlayer;
  pts: number;
  rank?: number;
}) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5 text-sm">
      {rank != null && (
        <span className="w-4 text-center font-display text-xs tabular-nums text-muted-foreground">
          {rank}
        </span>
      )}
      <PlayerAvatar
        name={p.name}
        club={p.club}
        position={p.position}
        crest={p.crest}
        size={32}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{p.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{p.club}</span>
      </span>
      <RatingBadge rating={p.rating} className="text-xs" />
      <span className="w-8 text-right font-display text-lg tabular-nums text-brand">
        {pts}
      </span>
    </div>
  );
}

function RankBadge({ rank, delta }: { rank: number; delta: number }) {
  return (
    <span className="flex items-center gap-1">
      <span className="font-display text-sm tabular-nums">{rank}</span>
      {delta !== 0 && (
        <span
          className={cn(
            "text-[0.65rem]",
            delta > 0 ? "text-emerald-400" : "text-rose-400",
          )}
        >
          {delta > 0 ? `▲${delta}` : `▼${Math.abs(delta)}`}
        </span>
      )}
    </span>
  );
}

/** Lightweight cumulative-points line — no chart library. */
function Sparkline({ values }: { values: number[] }) {
  const w = 280;
  const h = 64;
  const pad = 4;
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, i) => {
    const x = pad + i * step;
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${pad + (values.length - 1) * step},${h - pad}`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-16 w-full" preserveAspectRatio="none">
      <polygon points={area} className="fill-brand/15" />
      <polyline
        points={line}
        fill="none"
        className="stroke-brand"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.5" className="fill-brand" />
      ))}
    </svg>
  );
}
