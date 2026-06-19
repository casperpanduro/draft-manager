"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { POS_TAG } from "@/components/player-pool";
import { type Position } from "@/lib/draft";
import { type PlayerRoundStats, rawFromStats } from "@/lib/season";
import { scorePlayerMatch } from "@/lib/scoring";
import { cn } from "@/lib/utils";

/** The per-category points lines for one player's match (D3 breakdown). */
export function ScoreBreakdownLines({
  stats,
  position,
}: {
  stats: PlayerRoundStats | null;
  position: Position;
}) {
  const breakdown =
    stats && stats.played
      ? scorePlayerMatch(rawFromStats(stats), position, stats.ga ?? 0)
      : null;

  if (!breakdown || breakdown.lines.length === 0) {
    return (
      <p className="text-[0.7rem] text-muted-foreground">
        {stats?.played ? "No points this match." : "Did not feature."}
      </p>
    );
  }

  return (
    <ul className="space-y-0.5">
      {breakdown.lines.map((l, i) => (
        <li
          key={`${l.label}-${i}`}
          className="flex items-center justify-between text-[0.7rem] text-muted-foreground"
        >
          <span>
            {l.label}
            {l.detail && <span className="text-muted-foreground/70"> · {l.detail}</span>}
          </span>
          <span className={cn("tabular-nums", l.points >= 0 ? "text-foreground" : "text-red-400")}>
            {l.points > 0 ? `+${l.points}` : l.points}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Short match-context line (result + scoreline) for a player's round. */
export function resultLine(s: PlayerRoundStats | null): string {
  if (!s) return "No data";
  if (!s.played) return "Did not feature";
  const result = s.won ? "Win" : s.gf === s.ga ? "Draw" : "Loss";
  const bits = [result];
  if (s.gf != null && s.ga != null) bits.push(`${s.gf}–${s.ga}`);
  return bits.join(" · ");
}

/** Tap-a-player dialog (overall): one player's points round-by-round. */
export function OverallBreakdownDialog({
  open,
  onOpenChange,
  name,
  position,
  total,
  rows,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  name: string;
  position: Position;
  total: number;
  rows: { round: number; points: number }[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="clip-broadcast border-0 bg-card p-0 ring-1 ring-border sm:max-w-sm">
        <div className="accent-bar p-5 pl-6">
          <DialogHeader>
            <div className="kicker flex items-center gap-2">
              <span
                className={cn(
                  "grid w-9 place-items-center rounded-sm py-0.5 font-display text-[10px] ring-1",
                  POS_TAG[position],
                )}
              >
                {position}
              </span>
              Season so far
            </div>
            <DialogTitle className="font-display text-2xl uppercase">{name}</DialogTitle>
          </DialogHeader>

          <div className="mt-3 flex items-center justify-between rounded-sm bg-background/40 px-4 py-3 ring-1 ring-border">
            <span className="font-display text-sm tabular-nums text-muted-foreground">
              {rows.length} {rows.length === 1 ? "round" : "rounds"}
            </span>
            <span className="font-display text-2xl tabular-nums text-brand">
              {total > 0 ? `+${total}` : total}
              <span className="ml-1 text-sm">pts</span>
            </span>
          </div>

          <ul className="mt-3 space-y-0.5 border-t border-border/60 pt-3">
            {rows.length === 0 ? (
              <li className="text-[0.7rem] text-muted-foreground">
                Hasn&apos;t featured in your XI yet.
              </li>
            ) : (
              rows.map((r) => (
                <li
                  key={r.round}
                  className="flex items-center justify-between text-[0.75rem] text-muted-foreground"
                >
                  <span>Round {r.round}</span>
                  <span
                    className={cn(
                      "tabular-nums",
                      r.points >= 0 ? "text-foreground" : "text-red-400",
                    )}
                  >
                    {r.points > 0 ? `+${r.points}` : r.points}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Tap-a-player dialog: one player's points broken down by category. */
export function PlayerBreakdownDialog({
  open,
  onOpenChange,
  name,
  position,
  points,
  roundLabel,
  stats,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  name: string;
  position: Position;
  points: number;
  roundLabel: string;
  stats: PlayerRoundStats | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="clip-broadcast border-0 bg-card p-0 ring-1 ring-border sm:max-w-sm">
        <div className="accent-bar p-5 pl-6">
          <DialogHeader>
            <div className="kicker flex items-center gap-2">
              <span
                className={cn(
                  "grid w-9 place-items-center rounded-sm py-0.5 font-display text-[10px] ring-1",
                  POS_TAG[position],
                )}
              >
                {position}
              </span>
              {roundLabel}
            </div>
            <DialogTitle className="font-display text-2xl uppercase">{name}</DialogTitle>
          </DialogHeader>

          <div className="mt-3 flex items-center justify-between rounded-sm bg-background/40 px-4 py-3 ring-1 ring-border">
            <span className="font-display text-sm tabular-nums text-muted-foreground">
              {resultLine(stats)}
            </span>
            <span className="font-display text-2xl tabular-nums text-brand">
              {points > 0 ? `+${points}` : points}
              <span className="ml-1 text-sm">pts</span>
            </span>
          </div>

          <div className="mt-3 border-t border-border/60 pt-3">
            <ScoreBreakdownLines stats={stats} position={position} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
