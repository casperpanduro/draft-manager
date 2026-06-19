"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { createClient } from "@/lib/supabase/client";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { PlayerAvatar } from "@/components/player-avatar";
import { PlayerPool, type PoolPlayer } from "@/components/player-pool";
import { QueuePanel } from "@/components/queue-panel";
import { ValueTag } from "@/components/value-tag";
import { ratingText, ratingRing } from "@/components/rating-badge";
import { useDraftQueue } from "@/components/use-draft-queue";
import { cn } from "@/lib/utils";
import {
  type Position,
  POSITIONS,
  POSITION_LABEL,
  SQUAD_QUOTA,
  ROSTER_SIZE,
  TOTAL_ROUNDS,
  countByPosition,
  canDraftPosition,
  seatForPick,
  roundForPick,
} from "@/lib/draft";
import { toast } from "sonner";

type Team = {
  id: string;
  name: string;
  userId: string;
  seat: number;
  manager: string;
};
type Player = PoolPlayer;
type Pick = {
  id: string;
  player_id: string;
  team_id: string;
  pick_number: number;
  round: number;
  auto_picked: boolean;
};

const surname = (name: string) => name.split(" ").slice(-1)[0];

export function DraftRoom({
  leagueId,
  currentUserId,
  clockSeconds,
  initialStatus,
  initialPickNumber,
  initialDeadline,
  teams,
  players,
  initialPicks,
  initialQueue,
}: {
  leagueId: string;
  currentUserId: string;
  clockSeconds: number;
  initialStatus: string;
  initialPickNumber: number;
  initialDeadline: string | null;
  teams: Team[];
  players: Player[];
  initialPicks: Pick[];
  initialQueue: string[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState(initialStatus);
  const [pickNumber, setPickNumber] = useState(initialPickNumber);
  const [deadline, setDeadline] = useState<string | null>(initialDeadline);
  const [picks, setPicks] = useState<Pick[]>(initialPicks);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  const { queue, reorder, toggle, remove } = useDraftQueue(leagueId, initialQueue);

  const playerById = useMemo(
    () => new Map(players.map((p) => [p.id, p])),
    [players],
  );
  const teamBySeat = useMemo(
    () => new Map(teams.map((t) => [t.seat, t])),
    [teams],
  );
  const teamCount = teams.length;
  const myTeam = teams.find((t) => t.userId === currentUserId) ?? null;

  // ── Realtime ───────────────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel(`draft:${leagueId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "draft_picks",
          filter: `league_id=eq.${leagueId}`,
        },
        (payload) => {
          const p = payload.new as Pick;
          setPicks((prev) =>
            prev.some((x) => x.id === p.id) ? prev : [...prev, p],
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "leagues",
          filter: `id=eq.${leagueId}`,
        },
        (payload) => {
          const l = payload.new as {
            status: string;
            current_pick_number: number;
            pick_deadline: string | null;
          };
          setStatus(l.status);
          setPickNumber(l.current_pick_number);
          setDeadline(l.pick_deadline);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, leagueId]);

  // ── Clock tick ─────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);

  // ── Derived state ────────────────────────────────────────────────────────
  const onClockSeat =
    status === "drafting" ? seatForPick(pickNumber, teamCount) : 0;
  const onClockTeam = teamBySeat.get(onClockSeat) ?? null;
  const isMyTurn =
    status === "drafting" && onClockTeam?.userId === currentUserId;
  const round = status === "drafting" ? roundForPick(pickNumber, teamCount) : 0;

  const deadlineMs = deadline ? new Date(deadline).getTime() : null;
  const secondsLeft = deadlineMs
    ? Math.max(0, Math.ceil((deadlineMs - now) / 1000))
    : null;

  const draftedIds = useMemo(
    () => new Set(picks.map((p) => p.player_id)),
    [picks],
  );
  const myPositions = useMemo<Position[]>(() => {
    if (!myTeam) return [];
    return picks
      .filter((p) => p.team_id === myTeam.id)
      .map((p) => playerById.get(p.player_id)?.position)
      .filter((x): x is Position => Boolean(x));
  }, [picks, myTeam, playerById]);

  const myCounts = useMemo(() => countByPosition(myPositions), [myPositions]);

  const canDraft = useCallback(
    (p: Player) => isMyTurn && canDraftPosition(myPositions, p.position),
    [isMyTurn, myPositions],
  );

  // ── Auto-pick on clock expiry ─────────────────────────────────────────────
  const triggeredFor = useRef(-1);

  const triggerAutoPick = useCallback(async () => {
    try {
      const { error } = await supabase.functions.invoke("auto-pick", {
        body: { leagueId },
      });
      if (error) throw error;
    } catch {
      await supabase.rpc("auto_pick", { p_league_id: leagueId });
    }
  }, [supabase, leagueId]);

  useEffect(() => {
    if (status !== "drafting" || !deadlineMs) return;
    const graceMs = isMyTurn ? 300 : 2500;
    if (now > deadlineMs + graceMs && triggeredFor.current !== pickNumber) {
      triggeredFor.current = pickNumber;
      void triggerAutoPick();
    }
  }, [now, deadlineMs, status, pickNumber, isMyTurn, triggerAutoPick]);

  async function draftPlayer(playerId: string) {
    setBusy(true);
    const { error } = await supabase.rpc("make_pick", {
      p_league_id: leagueId,
      p_player_id: playerId,
    });
    setBusy(false);
    if (error) toast.error(error.message);
  }

  const complete = status === "complete";

  return (
    <div className="flex flex-1 flex-col">
      <Scoreboard
        complete={complete}
        round={round}
        pickNumber={pickNumber}
        isMyTurn={isMyTurn}
        onClockTeam={onClockTeam}
        secondsLeft={secondsLeft}
        clockSeconds={clockSeconds}
      />

      <Tabs defaultValue="players" className="mt-5 flex flex-1 flex-col">
        <TabsList className="grid h-auto w-full grid-cols-4 gap-1 rounded-sm bg-card/70 p-1 ring-1 ring-border group-data-horizontal/tabs:h-auto">
          {[
            ["players", "Players"],
            ["queue", `Queue${queue.length ? ` · ${queue.length}` : ""}`],
            ["team", "Squad"],
            ["board", "Board"],
          ].map(([v, label]) => (
            <TabsTrigger
              key={v}
              value={v}
              className="kicker rounded-sm py-2 data-active:bg-brand data-active:text-brand-foreground"
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Players ── */}
        <TabsContent value="players" className="flex-1">
          {myTeam && <RosterQuota counts={myCounts} className="mb-3" />}
          <PlayerPool
            players={players}
            queue={queue}
            draftedIds={draftedIds}
            onToggleQueue={toggle}
            onDraft={draftPlayer}
            canDraft={canDraft}
            counts={myTeam ? myCounts : undefined}
            busy={busy}
          />
        </TabsContent>

        {/* ── Queue ── */}
        <TabsContent value="queue" className="flex-1">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="kicker text-foreground">Your priorities · {queue.length}</h3>
            <span className="kicker">
              {isMyTurn ? "Tap Pick to draft" : "Drag to reorder"}
            </span>
          </div>
          <QueuePanel
            queue={queue}
            playerById={playerById}
            draftedIds={draftedIds}
            onReorder={reorder}
            onRemove={remove}
            onPick={draftPlayer}
            canPick={(p) => canDraftPosition(myPositions, p.position)}
            myTurn={isMyTurn}
            busy={busy}
          />
        </TabsContent>

        {/* ── Squad ── */}
        <TabsContent value="team" className="flex-1">
          {myTeam ? (
            <SquadView
              picks={picks.filter((p) => p.team_id === myTeam.id)}
              playerById={playerById}
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              You are spectating this draft.
            </p>
          )}
        </TabsContent>

        {/* ── Board ── */}
        <TabsContent value="board" className="flex-1 space-y-6">
          <div>
            <h3 className="kicker mb-2 text-foreground">Draft order</h3>
            <div className="space-y-1.5">
              {[...teams]
                .sort((a, b) => a.seat - b.seat)
                .map((t) => {
                  const onClock = !complete && t.seat === onClockSeat;
                  return (
                    <div
                      key={t.id}
                      className={cn(
                        "flex items-center gap-3 rounded-sm bg-card/60 py-2.5 pl-2.5 pr-3 text-sm ring-1 ring-border",
                        onClock && "bg-brand/10 ring-brand/60",
                      )}
                    >
                      <span className="grid size-7 place-items-center rounded-sm bg-muted font-display text-xs tabular-nums text-muted-foreground">
                        {t.seat}
                      </span>
                      <span className="flex-1 font-display uppercase">
                        {t.name}
                      </span>
                      {t.userId === currentUserId && (
                        <span className="kicker text-brand">You</span>
                      )}
                      {onClock && (
                        <span className="kicker flex items-center gap-1.5 text-brand">
                          <span className="size-1.5 animate-[pulse-danger_1.2s_ease-in-out_infinite] rounded-full bg-brand" />
                          On the clock
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
          <div>
            <h3 className="kicker mb-2 text-foreground">Pick feed</h3>
            <div className="space-y-1.5">
              <AnimatePresence initial={false}>
                {[...picks]
                  .sort((a, b) => b.pick_number - a.pick_number)
                  .slice(0, 40)
                  .map((pk) => {
                    const pl = playerById.get(pk.player_id);
                    const tm = teams.find((t) => t.id === pk.team_id);
                    return (
                      <motion.div
                        key={pk.id}
                        layout
                        initial={{ opacity: 0, x: -24 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{
                          type: "spring",
                          stiffness: 420,
                          damping: 32,
                        }}
                        className="flex items-center gap-3 rounded-sm bg-card/60 py-2 pl-2.5 pr-3 text-sm ring-1 ring-border"
                      >
                        <span className="w-5 text-center font-display text-sm tabular-nums text-muted-foreground">
                          {pk.pick_number}
                        </span>
                        {pl && (
                          <PlayerAvatar
                            name={pl.name}
                            club={pl.club}
                            position={pl.position}
                            crest={pl.crest}
                            size={34}
                          />
                        )}
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{pl?.name}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            → {tm?.name}
                          </span>
                        </span>
                        {pk.auto_picked && (
                          <span className="kicker text-[0.6rem] text-muted-foreground">
                            auto
                          </span>
                        )}
                        {pl && <ValueTag value={pl.value} />}
                      </motion.div>
                    );
                  })}
              </AnimatePresence>
              {picks.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No picks yet — the board is clean.
                </p>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Scoreboard({
  complete,
  round,
  pickNumber,
  isMyTurn,
  onClockTeam,
  secondsLeft,
  clockSeconds,
}: {
  complete: boolean;
  round: number;
  pickNumber: number;
  isMyTurn: boolean;
  onClockTeam: Team | null;
  secondsLeft: number | null;
  clockSeconds: number;
}) {
  if (complete) {
    return (
      <div className="clip-broadcast accent-bar relative overflow-hidden bg-card p-7 pl-8 text-center ring-1 ring-border">
        <div className="kicker">Full time</div>
        <div className="font-display text-5xl uppercase">Draft complete</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Head to My XI to see your squad, or the Board for every roster.
        </p>
      </div>
    );
  }

  const danger = secondsLeft !== null && secondsLeft <= 10;
  const pct =
    secondsLeft !== null ? Math.max(0, Math.min(1, secondsLeft / clockSeconds)) : 0;
  const C = 2 * Math.PI * 44;

  return (
    <div
      className={cn(
        "clip-broadcast accent-bar relative flex items-center justify-between gap-4 overflow-hidden bg-card p-5 pl-6 ring-1 transition-shadow",
        isMyTurn ? "ring-brand shadow-[0_0_40px_-8px_var(--brand-glow)]" : "ring-border",
      )}
    >
      {isMyTurn && (
        <div className="pointer-events-none absolute inset-0 bg-[image:var(--brand-gradient)] opacity-[0.06]" />
      )}
      <div className="relative min-w-0 flex-1">
        <div className="kicker flex items-center gap-2">
          <span className="size-1.5 animate-[pulse-danger_1.4s_ease-in-out_infinite] rounded-full bg-destructive" />
          Round {round} of {TOTAL_ROUNDS} · Pick {pickNumber}
        </div>
        <div
          className={cn(
            "mt-1 font-display text-2xl uppercase leading-[0.92] text-balance",
            isMyTurn ? "text-brand" : "truncate",
          )}
        >
          {isMyTurn ? "You're on the clock" : onClockTeam?.name ?? "—"}
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">
          {isMyTurn
            ? "Make your pick before the buzzer"
            : onClockTeam
              ? `${onClockTeam.manager} is picking`
              : ""}
        </div>
      </div>

      {/* Clock */}
      <div className="relative grid size-20 shrink-0 place-items-center">
        <svg viewBox="0 0 100 100" className="size-20 -rotate-90">
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            strokeWidth="7"
            className="text-border"
            stroke="currentColor"
          />
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            stroke="currentColor"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct)}
            className={cn(
              "transition-[stroke-dashoffset] duration-300",
              danger ? "text-destructive" : "text-brand",
            )}
          />
        </svg>
        <span
          className={cn(
            "absolute font-display text-2xl tabular-nums",
            danger && "animate-[pulse-danger_0.8s_ease-in-out_infinite] text-destructive",
          )}
        >
          {secondsLeft ?? "—"}
        </span>
      </div>
    </div>
  );
}

/**
 * Per-position draft progress (GK 1/2 · DEF 3/5 · …). A position turns "full"
 * (and undraftable) once its quota is met — the visual half of the rule the
 * draft engine enforces in canDraftPosition.
 */
function RosterQuota({
  counts,
  className,
}: {
  counts: Record<Position, number>;
  className?: string;
}) {
  const total = POSITIONS.reduce((n, p) => n + counts[p], 0);
  return (
    <div className={cn("flex items-stretch gap-1.5", className)}>
      {POSITIONS.map((pos) => {
        const have = counts[pos];
        const need = SQUAD_QUOTA[pos];
        const full = have >= need;
        return (
          <div
            key={pos}
            className={cn(
              "flex flex-1 flex-col items-center rounded-sm py-1.5 ring-1 transition",
              full
                ? "bg-brand/15 ring-brand/50"
                : "bg-card/60 ring-border",
            )}
            title={`${POSITION_LABEL[pos]}: ${have} of ${need}${full ? " — full" : ""}`}
          >
            <span
              className={cn(
                "kicker leading-none",
                full ? "text-brand" : "text-muted-foreground",
              )}
            >
              {pos}
            </span>
            <span
              className={cn(
                "font-display text-lg leading-tight tabular-nums",
                full ? "text-brand" : "text-foreground",
              )}
            >
              {have}
              <span className="text-xs text-muted-foreground">/{need}</span>
            </span>
          </div>
        );
      })}
      <div className="flex flex-col items-center justify-center rounded-sm bg-muted/40 px-2.5 ring-1 ring-border">
        <span className="kicker leading-none text-muted-foreground">Squad</span>
        <span className="font-display text-lg leading-tight tabular-nums">
          {total}
          <span className="text-xs text-muted-foreground">/{ROSTER_SIZE}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * The drafted squad, laid out as fixed per-position quota slots (GK 2 · DEF 5 ·
 * MID 6 · FWD 3). Empty slots are placeholders so it's obvious what's left to
 * fill. Formation/XI selection happens in the season, not the draft.
 */
function SquadView({
  picks,
  playerById,
}: {
  picks: Pick[];
  playerById: Map<string, Player>;
}) {
  const byPos: Record<Position, Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const pk of [...picks].sort((a, b) => a.pick_number - b.pick_number)) {
    const pl = playerById.get(pk.player_id);
    if (pl) byPos[pl.position].push(pl);
  }
  const counts = countByPosition(
    picks
      .map((pk) => playerById.get(pk.player_id)?.position)
      .filter((x): x is Position => Boolean(x)),
  );
  const squadValue = picks.reduce(
    (sum, pk) => sum + (playerById.get(pk.player_id)?.value ?? 0),
    0,
  );
  const ratings = picks
    .map((pk) => playerById.get(pk.player_id)?.rating)
    .filter((x): x is number => typeof x === "number");
  const avgRating = ratings.length
    ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length)
    : 0;

  const rows: Position[] = ["GK", "DEF", "MID", "FWD"];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="kicker text-foreground">Your squad</h3>
        <div className="flex items-center gap-2">
          {avgRating > 0 && (
            <span className="kicker">
              ⌀ <span className={cn("font-display", ratingText(avgRating))}>{avgRating}</span>
            </span>
          )}
          <ValueTag value={squadValue} />
        </div>
      </div>

      <RosterQuota counts={counts} />

      <div className="space-y-3">
        {rows.map((pos) => (
          <div key={pos}>
            <div className="kicker mb-1.5 flex items-center justify-between">
              <span>{POSITION_LABEL[pos]}s</span>
              <span
                className={cn(
                  counts[pos] >= SQUAD_QUOTA[pos] ? "text-brand" : "text-muted-foreground",
                )}
              >
                {counts[pos]}/{SQUAD_QUOTA[pos]}
              </span>
            </div>
            <div className="grid grid-cols-6 gap-2 rounded-md bg-card/40 p-3 ring-1 ring-border">
              {Array.from({ length: SQUAD_QUOTA[pos] }).map((_, i) => (
                <Jersey key={`${pos}-${i}`} pos={pos} pl={byPos[pos][i]} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Jersey({ pl, pos }: { pl?: Player; pos?: Position }) {
  return (
    <div className="flex w-14 flex-col items-center gap-1">
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
          <span
            className={cn(
              "absolute -bottom-1 -right-1 grid h-4 min-w-4 place-items-center rounded-sm bg-background/95 px-1 font-display text-[10px] tabular-nums ring-1",
              ratingText(pl.rating),
              ratingRing(pl.rating),
            )}
          >
            {pl.rating}
          </span>
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
    </div>
  );
}
