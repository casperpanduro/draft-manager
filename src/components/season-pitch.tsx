"use client";

import { useMemo, useState } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlayerAvatar } from "@/components/player-avatar";
import { ratingText } from "@/components/rating-badge";
import { TeamCrest } from "@/components/team-crest";
import { crestFor, type CrestMap } from "@/lib/crests";
import { cn } from "@/lib/utils";
import {
  type Position,
  BENCH_SIZE,
  FOOTBALL_TEMPLATE,
  FOOTBALL_FORMATIONS,
  DEFAULT_FORMATION,
  formationByName,
} from "@/lib/draft";
import {
  type Lineup,
  type PlayerRoundStats,
  type SquadPlayer,
  defaultLineup,
  applyFormation,
  squadStrength,
  stageLabel,
} from "@/lib/season";
import {
  type ViewPlayer,
  type TeamRound,
  type PlayerScore,
  type Fixture,
  surname,
} from "@/components/season-room";
import { PlayerBreakdownDialog } from "@/components/player-score-breakdown";

// Locale/timezone-stable short date (matches season-room's fmtDate).
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(s: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Opponent (+ home/away) a nation faces in a round, parsed from "Home vs Away". */
type Opponent = { name: string; home: boolean };

export function SeasonPitch({
  squad,
  playerById,
  teamRounds,
  currentRound,
  totalRounds,
  playerScores,
  fixtures,
  crests,
  busy,
  onSave,
}: {
  squad: ViewPlayer[];
  /** All competition players, so past-round lineups (incl. transferred-out
   *  players) still render. */
  playerById: Map<string, ViewPlayer>;
  /** Every round this manager has — drives the round switcher. */
  teamRounds: TeamRound[];
  currentRound: number;
  totalRounds: number;
  playerScores: PlayerScore[];
  fixtures: Fixture[];
  crests: CrestMap;
  busy: boolean;
  onSave: (lineup: Lineup) => void;
}) {
  // Which round the pitch is showing. Defaults to the open round (for editing);
  // step back to review a played gameweek with each player's points.
  const [viewRound, setViewRound] = useState(currentRound);
  // Snap back to the open round when it advances (after a round is played).
  const [syncedRound, setSyncedRound] = useState(currentRound);
  if (syncedRound !== currentRound) {
    setSyncedRound(currentRound);
    setViewRound(currentRound);
  }

  const viewTeamRound = useMemo(
    () => teamRounds.find((r) => r.round === viewRound) ?? null,
    [teamRounds, viewRound],
  );
  // Editable only on the open, unlocked round.
  const editable = viewRound === currentRound && !viewTeamRound?.locked;

  const serverLineup = useMemo<Lineup>(
    () =>
      viewTeamRound?.lineup ??
      (editable
        ? defaultLineup(squad, FOOTBALL_TEMPLATE)
        : { xi: [], bench: [], formation: DEFAULT_FORMATION }),
    [viewTeamRound, squad, editable],
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
    JSON.stringify(lineup.bench) !== JSON.stringify(serverLineup.bench) ||
    lineup.formation !== serverLineup.formation;

  // Scores for the round being viewed (once it's been played).
  const scoreByPlayer = useMemo(() => {
    const m = new Map<string, PlayerScore>();
    for (const s of playerScores) if (s.round === viewRound) m.set(s.playerId, s);
    return m;
  }, [playerScores, viewRound]);
  const played = viewTeamRound?.points != null;

  // ── Fixtures: per-round counts (for stage names) + earliest date ─────────
  const { countByRound, dateByRound } = useMemo(() => {
    const count = new Map<number, number>();
    const date = new Map<number, string | null>();
    for (const f of fixtures) {
      count.set(f.round, (count.get(f.round) ?? 0) + 1);
      const cur = date.get(f.round);
      if (cur == null || (f.starts_at && f.starts_at < cur))
        date.set(f.round, f.starts_at);
    }
    return { countByRound: count, dateByRound: date };
  }, [fixtures]);
  const label = (r: number) => stageLabel(r, totalRounds, countByRound.get(r));

  // Opponent each nation faces in the viewed round (for the open-lineup hint).
  const oppByClub = useMemo(() => {
    const m = new Map<string, Opponent>();
    for (const f of fixtures) {
      if (f.round !== viewRound) continue;
      const [home, away] = f.label.split(" vs ").map((s) => s.trim());
      if (home && away) {
        m.set(home, { name: away, home: true });
        m.set(away, { name: home, home: false });
      }
    }
    return m;
  }, [fixtures, viewRound]);
  // Show the upcoming opponent only on the open (not-yet-played) round.
  const showOpponents = !played;

  // Tap-a-player points breakdown (played rounds only).
  const [detail, setDetail] = useState<ViewPlayer | null>(null);

  function tap(id: string) {
    if (!editable) {
      const pl = playerById.get(id);
      if (pl && scoreByPlayer.has(id)) setDetail(pl);
      return;
    }
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
        formation: lineup.formation,
      });
      setSelected(null);
    } else {
      setSelected(id);
    }
  }

  // Squad as SquadPlayer[] for formation re-shaping.
  const squadForLineup = useMemo<SquadPlayer[]>(
    () => squad.map((p) => ({ id: p.id, position: p.position, rating: p.rating })),
    [squad],
  );

  function changeFormation(name: string) {
    setLineup(applyFormation(squadForLineup, FOOTBALL_TEMPLATE, name));
    setSelected(null);
  }

  const currentFormation =
    formationByName(FOOTBALL_TEMPLATE, lineup.formation)?.name ??
    lineup.formation;
  const xiSlots =
    formationByName(FOOTBALL_TEMPLATE, lineup.formation)?.slots ??
    ({ GK: 1, DEF: 4, MID: 4, FWD: 2 } as Record<string, number>);

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

  const roundTotal = viewTeamRound?.points ?? null;

  // Round points lookup for the tab subtitles.
  const pointsByRound = useMemo(
    () => new Map(teamRounds.map((r) => [r.round, r.points])),
    [teamRounds],
  );

  // Tab strip: every round. Future rounds (no lineup yet) show their date but
  // aren't selectable.
  const tabs = Array.from({ length: totalRounds }, (_, i) => i + 1).map((r) => {
    const pts = pointsByRound.get(r);
    const sub =
      r < currentRound || pts != null
        ? `${pts ?? 0} pts`
        : r === currentRound
          ? "Open"
          : fmtDate(dateByRound.get(r) ?? null) || "TBD";
    return { round: r, label: label(r), sub };
  });
  const selectable = (r: number) => r <= currentRound;

  // Upcoming opponent for a player (open round only).
  const oppFor = (pl?: ViewPlayer) => {
    if (!showOpponents || !pl) return undefined;
    const o = oppByClub.get(pl.club);
    if (!o) return undefined;
    return { ...o, crest: crestFor(crests, o.name) };
  };

  return (
    <div className="space-y-4">
      {/* Round tabs */}
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {tabs.map((t) => {
          const active = viewRound === t.round;
          const canPick = selectable(t.round);
          const isOpen = t.round === currentRound;
          return (
            <button
              key={t.round}
              type="button"
              disabled={!canPick}
              onClick={() => canPick && setViewRound(t.round)}
              className={cn(
                "flex min-w-[5.5rem] shrink-0 flex-col items-center gap-0.5 border-b-2 px-3 py-2 text-center transition",
                active
                  ? "border-brand text-foreground"
                  : "border-transparent text-muted-foreground",
                canPick ? "hover:text-foreground" : "opacity-40",
              )}
            >
              <span
                className={cn(
                  "font-display text-sm uppercase leading-none",
                  active && "text-brand",
                )}
              >
                {t.label}
              </span>
              <span
                className={cn(
                  "rounded-full px-1.5 text-[0.65rem] leading-tight tabular-nums",
                  isOpen && t.sub === "Open"
                    ? "bg-emerald-400/90 font-display text-emerald-950"
                    : "text-muted-foreground",
                )}
              >
                {t.sub}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <h3 className="kicker text-foreground">Starting XI · {currentFormation}</h3>
        <div className="flex items-center gap-2">
          <span className="kicker">
            ⌀ <span className={cn("font-display", ratingText(strength))}>{strength}</span>
          </span>
          {played ? (
            <span className="kicker rounded-sm bg-brand/15 px-1.5 py-0.5 text-brand">
              {roundTotal} pts
            </span>
          ) : editable ? (
            <span className="kicker text-brand">
              {selected ? "Tap a highlighted player to swap" : "Tap to sub"}
            </span>
          ) : (
            <span className="kicker rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground">
              Locked
            </span>
          )}
        </div>
      </div>

      {/* Formation selector (open round only) */}
      {editable && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1">
          {FOOTBALL_FORMATIONS.map((f) => {
            const active = f.name === currentFormation;
            return (
              <button
                key={f.name}
                type="button"
                onClick={() => changeFormation(f.name)}
                className={cn(
                  "kicker shrink-0 rounded-sm px-3 py-1.5 ring-1 tabular-nums transition",
                  active
                    ? "bg-brand text-brand-foreground ring-transparent"
                    : "ring-border hover:ring-foreground/40",
                )}
              >
                {f.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Pitch */}
      <div className="bg-turf relative flex flex-col justify-between gap-5 overflow-hidden rounded-md p-5 ring-1 ring-white/10 shadow-[inset_0_1px_0_oklch(1_0_0/0.08)]">
        <div className="pointer-events-none absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/25" />
        <div className="pointer-events-none absolute inset-x-6 top-1/2 h-px -translate-y-1/2 bg-white/20" />
        <div className="pointer-events-none absolute left-1/2 top-3 h-9 w-24 -translate-x-1/2 rounded-b-sm border border-t-0 border-white/18" />
        <div className="pointer-events-none absolute bottom-3 left-1/2 h-9 w-24 -translate-x-1/2 rounded-t-sm border border-b-0 border-white/18" />

        {rows.map((pos) => (
          <div key={pos} className="relative flex justify-around gap-2">
            {Array.from({ length: xiSlots[pos] ?? 0 }).map((_, i) => (
              <Jersey
                key={`${pos}-${i}`}
                pos={pos}
                pl={xiByPos[pos][i]}
                pts={xiByPos[pos][i] ? scoreByPlayer.get(xiByPos[pos][i].id)?.points : undefined}
                opp={oppFor(xiByPos[pos][i])}
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
              pts={benchPlayers[i] ? scoreByPlayer.get(benchPlayers[i].id)?.points : undefined}
              opp={oppFor(benchPlayers[i])}
              onTap={tap}
              {...swapState(benchPlayers[i])}
            />
          ))}
        </div>
      </div>

      {editable && dirty && (
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

      <PlayerBreakdownDialog
        open={!!detail}
        onOpenChange={(o) => !o && setDetail(null)}
        name={detail?.name ?? ""}
        position={detail?.position ?? "MID"}
        points={detail ? scoreByPlayer.get(detail.id)?.points ?? 0 : 0}
        roundLabel={label(viewRound)}
        stats={
          detail
            ? ((scoreByPlayer.get(detail.id)?.stats as PlayerRoundStats | null) ?? null)
            : null
        }
      />
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
  opp,
  onTap,
}: {
  pl?: ViewPlayer;
  pos?: Position;
  isSel?: boolean;
  eligible?: boolean;
  hint?: "in" | "out" | null;
  dim?: boolean;
  pts?: number;
  opp?: { name: string; home: boolean; crest?: string | null };
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
          {/* Points badge only — player ratings ("rank") stay in the draft /
              player pool / transfer market, not in-game. */}
          {pts != null && (
            <span className="absolute -bottom-1 -right-1 grid h-4 min-w-4 place-items-center rounded-sm bg-brand px-1 font-display text-[10px] tabular-nums text-brand-foreground">
              {pts}
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
      {pl && opp && (
        <span
          className="flex max-w-full items-center gap-0.5 text-[9px] leading-none text-white/70"
          title={`${opp.home ? "vs" : "away to"} ${opp.name}`}
        >
          <span className="text-white/45">{opp.home ? "v" : "@"}</span>
          <TeamCrest src={opp.crest} name={opp.name} size={11} />
          <span className="truncate">{opp.name}</span>
        </span>
      )}
    </button>
  );
}
