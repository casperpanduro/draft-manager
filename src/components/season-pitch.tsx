"use client";

import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlayerAvatar } from "@/components/player-avatar";
import { ratingText, ratingRing } from "@/components/rating-badge";
import { cn } from "@/lib/utils";
import { type Position, XI_SLOTS, BENCH_SIZE, FOOTBALL_TEMPLATE } from "@/lib/draft";
import { type Lineup, defaultLineup, squadStrength } from "@/lib/season";
import {
  type ViewPlayer,
  type TeamRound,
  type PlayerScore,
  surname,
} from "@/components/season-room";

export function SeasonPitch({
  squad,
  teamRound,
  locked,
  currentRound,
  playerScores,
  busy,
  onSave,
}: {
  squad: ViewPlayer[];
  teamRound: TeamRound | null;
  locked: boolean;
  currentRound: number;
  playerScores: PlayerScore[];
  busy: boolean;
  onSave: (lineup: Lineup) => void;
}) {
  const playerById = useMemo(
    () => new Map(squad.map((p) => [p.id, p])),
    [squad],
  );

  const serverLineup = useMemo<Lineup>(
    () => teamRound?.lineup ?? defaultLineup(squad, FOOTBALL_TEMPLATE),
    [teamRound, squad],
  );

  const [lineup, setLineup] = useState<Lineup>(serverLineup);
  const [selected, setSelected] = useState<string | null>(null);

  // Reset local edits to server state whenever it changes (after a refresh).
  // Adjusting state during render (React's recommended pattern over an effect).
  const [syncedTo, setSyncedTo] = useState(serverLineup);
  if (syncedTo !== serverLineup) {
    setSyncedTo(serverLineup);
    setLineup(serverLineup);
    setSelected(null);
  }

  const dirty =
    JSON.stringify(lineup.xi) !== JSON.stringify(serverLineup.xi) ||
    JSON.stringify(lineup.bench) !== JSON.stringify(serverLineup.bench);

  // Points overlay once the round has been played.
  const ptsByPlayer = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of playerScores)
      if (s.round === currentRound) m.set(s.playerId, s.points);
    return m;
  }, [playerScores, currentRound]);

  function tap(id: string) {
    if (locked) return;
    if (selected === null) {
      setSelected(id);
      return;
    }
    if (selected === id) {
      setSelected(null);
      return;
    }
    const a = selected;
    const b = id;
    const aXi = lineup.xi.includes(a);
    const bXi = lineup.xi.includes(b);
    const posA = playerById.get(a)?.position;
    const posB = playerById.get(b)?.position;
    // Valid sub = one starter ↔ one bench, same position (keeps 1-4-4-2).
    if (aXi !== bXi && posA === posB) {
      const starter = aXi ? a : b;
      const benched = aXi ? b : a;
      setLineup({
        xi: lineup.xi.map((x) => (x === starter ? benched : x)),
        bench: lineup.bench.map((x) => (x === benched ? starter : x)),
      });
      setSelected(null);
    } else {
      setSelected(id);
    }
  }

  // Group XI by position for the pitch rows.
  const xiByPos = useMemo(() => {
    const g: Record<Position, ViewPlayer[]> = { GK: [], DEF: [], MID: [], FWD: [] };
    for (const id of lineup.xi) {
      const p = playerById.get(id);
      if (p) g[p.position].push(p);
    }
    return g;
  }, [lineup.xi, playerById]);

  const benchPlayers = lineup.bench
    .map((id) => playerById.get(id))
    .filter((p): p is ViewPlayer => Boolean(p));

  const strength = squadStrength(
    lineup.xi.map((id) => playerById.get(id)?.rating ?? 0),
  );

  // Swap guidance while a player is selected: highlight the valid same-position
  // counterparts (bench↔XI) with a direction badge, dim everyone else.
  const selectedP = selected ? playerById.get(selected) ?? null : null;
  const selectedInXi = selected ? lineup.xi.includes(selected) : false;
  function swapState(pl?: ViewPlayer): {
    isSel: boolean;
    eligible: boolean;
    hint: "in" | "out" | null;
    dim: boolean;
  } {
    if (!pl || !selected || !selectedP)
      return { isSel: false, eligible: false, hint: null, dim: false };
    if (pl.id === selected)
      return {
        isSel: true,
        eligible: false,
        hint: selectedInXi ? "out" : "in",
        dim: false,
      };
    const plInXi = lineup.xi.includes(pl.id);
    const eligible = plInXi !== selectedInXi && pl.position === selectedP.position;
    return {
      isSel: false,
      eligible,
      hint: eligible ? (plInXi ? "out" : "in") : null,
      dim: !eligible,
    };
  }

  const rows: Position[] = ["FWD", "MID", "DEF", "GK"];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="kicker text-foreground">Starting XI · 1-4-4-2</h3>
        <div className="flex items-center gap-2">
          <span className="kicker">
            ⌀ <span className={cn("font-display", ratingText(strength))}>{strength}</span>
          </span>
          {locked ? (
            <span className="kicker rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground">
              Locked
            </span>
          ) : (
            <span className="kicker text-brand">
              {selected ? "Tap a highlighted player to swap" : "Tap to sub"}
            </span>
          )}
        </div>
      </div>

      {/* Pitch */}
      <div className="bg-turf relative flex flex-col justify-between gap-5 overflow-hidden rounded-md p-5 ring-1 ring-white/10 shadow-[inset_0_1px_0_oklch(1_0_0/0.08)]">
        <div className="pointer-events-none absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/25" />
        <div className="pointer-events-none absolute inset-x-6 top-1/2 h-px -translate-y-1/2 bg-white/20" />
        <div className="pointer-events-none absolute left-1/2 top-3 h-9 w-24 -translate-x-1/2 rounded-b-sm border border-t-0 border-white/18" />
        <div className="pointer-events-none absolute bottom-3 left-1/2 h-9 w-24 -translate-x-1/2 rounded-t-sm border border-b-0 border-white/18" />

        {rows.map((pos) => (
          <div key={pos} className="relative flex justify-around gap-2">
            {Array.from({ length: XI_SLOTS[pos] }).map((_, i) => (
              <Jersey
                key={`${pos}-${i}`}
                pos={pos}
                pl={xiByPos[pos][i]}
                pts={xiByPos[pos][i] ? ptsByPlayer.get(xiByPos[pos][i].id) : undefined}
                onTap={tap}
                {...swapState(xiByPos[pos][i])}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Bench */}
      <div>
        <div className="kicker mb-2">Bench</div>
        <div className="flex justify-around gap-2 rounded-md bg-card/60 p-3 ring-1 ring-border">
          {Array.from({ length: BENCH_SIZE }).map((_, i) => (
            <Jersey
              key={`bench-${i}`}
              pl={benchPlayers[i]}
              pts={benchPlayers[i] ? ptsByPlayer.get(benchPlayers[i].id) : undefined}
              onTap={tap}
              {...swapState(benchPlayers[i])}
            />
          ))}
        </div>
      </div>

      {!locked && dirty && (
        <div className="flex items-center gap-2">
          <Button
            onClick={() => onSave(lineup)}
            disabled={busy}
            className="sheen h-11 flex-1 font-display uppercase tracking-wider"
          >
            {busy ? "Saving…" : "Save lineup"}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setLineup(serverLineup);
              setSelected(null);
            }}
            disabled={busy}
            className="h-11"
          >
            Reset
          </Button>
        </div>
      )}
    </div>
  );
}

function Jersey({
  pl,
  pos,
  isSel = false,
  eligible = false,
  hint = null,
  dim = false,
  pts,
  onTap,
}: {
  pl?: ViewPlayer;
  pos?: Position;
  isSel?: boolean;
  eligible?: boolean;
  hint?: "in" | "out" | null;
  dim?: boolean;
  pts?: number;
  onTap: (id: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={!pl}
      onClick={() => pl && onTap(pl.id)}
      className={cn(
        "flex w-14 flex-col items-center gap-1 rounded-sm p-0.5 transition",
        pl && "hover:bg-white/5",
        isSel && "bg-brand/20 ring-1 ring-brand",
        eligible &&
          hint === "in" &&
          "animate-pulse-soft bg-emerald-400/10 ring-1 ring-emerald-400/70",
        eligible &&
          hint === "out" &&
          "animate-pulse-soft bg-amber-400/10 ring-1 ring-amber-400/70",
        dim && "opacity-40",
      )}
    >
      {pl ? (
        <div className="relative">
          <PlayerAvatar
            name={pl.name}
            club={pl.club}
            position={pl.position}
            crest={pl.crest}
            size={46}
            className="shadow-lg shadow-black/40 ring-2 ring-white/25"
          />
          {hint && (
            <span
              className={cn(
                "absolute -right-1 -top-1 z-10 grid size-4 place-items-center rounded-full ring-1 ring-black/50",
                hint === "in"
                  ? "bg-emerald-400 text-emerald-950"
                  : "bg-amber-400 text-amber-950",
              )}
              aria-label={hint === "in" ? "Sub in" : "Sub out"}
            >
              {hint === "in" ? (
                <ArrowUp className="size-3" strokeWidth={3} />
              ) : (
                <ArrowDown className="size-3" strokeWidth={3} />
              )}
            </span>
          )}
          {pts != null ? (
            <span className="absolute -bottom-1 -right-1 grid h-4 min-w-4 place-items-center rounded-sm bg-brand px-1 font-display text-[10px] tabular-nums text-brand-foreground">
              {pts}
            </span>
          ) : (
            <span
              className={cn(
                "absolute -bottom-1 -right-1 grid h-4 min-w-4 place-items-center rounded-sm bg-background/95 px-1 font-display text-[10px] tabular-nums ring-1",
                ratingText(pl.rating),
                ratingRing(pl.rating),
              )}
            >
              {pl.rating}
            </span>
          )}
        </div>
      ) : (
        <div className="grid size-11 place-items-center rounded-full border border-dashed border-white/30 bg-black/25 font-display text-xs text-white/40">
          {pos ?? "SUB"}
        </div>
      )}
      <span
        className={cn(
          "max-w-full truncate text-[10px] font-medium drop-shadow",
          pl ? "text-white" : "text-white/40",
        )}
      >
        {pl ? surname(pl.name) : "—"}
      </span>
    </button>
  );
}
