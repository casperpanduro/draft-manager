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
import { PlayerPool, POS_TAG, type PoolPlayer } from "@/components/player-pool";
import { QueuePanel } from "@/components/queue-panel";
import { ValueTag } from "@/components/value-tag";
import { useDraftQueue } from "@/components/use-draft-queue";
import { cn } from "@/lib/utils";
import {
  type Position,
  POSITIONS,
  XI_SLOTS,
  BENCH_SIZE,
  TOTAL_ROUNDS,
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
            ["team", "My XI"],
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
          <PlayerPool
            players={players}
            queue={queue}
            draftedIds={draftedIds}
            onToggleQueue={toggle}
            onDraft={draftPlayer}
            canDraft={canDraft}
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

        {/* ── My XI ── */}
        <TabsContent value="team" className="flex-1">
          {myTeam ? (
            <PitchView
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
                            size={28}
                          />
                        )}
                        {pl && (
                          <span
                            className={cn(
                              "grid w-8 shrink-0 place-items-center rounded-sm py-0.5 font-display text-[9px] ring-1",
                              POS_TAG[pl.position],
                            )}
                          >
                            {pl.position}
                          </span>
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

function PitchView({
  picks,
  playerById,
}: {
  picks: Pick[];
  playerById: Map<string, Player>;
}) {
  const slots: Record<Position, Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  const bench: Player[] = [];
  for (const pk of [...picks].sort((a, b) => a.pick_number - b.pick_number)) {
    const pl = playerById.get(pk.player_id);
    if (!pl) continue;
    if (slots[pl.position].length < XI_SLOTS[pl.position]) slots[pl.position].push(pl);
    else bench.push(pl);
  }
  const xiCount = POSITIONS.reduce((n, p) => n + slots[p].length, 0);
  const squadValue = picks.reduce(
    (sum, pk) => sum + (playerById.get(pk.player_id)?.value ?? 0),
    0,
  );

  const rows: Position[] = ["FWD", "MID", "DEF", "GK"];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="kicker text-foreground">Starting XI · 1-4-4-2</h3>
        <div className="flex items-center gap-2">
          <span className="kicker">{xiCount}/11 · {bench.length}/{BENCH_SIZE} bench</span>
          <ValueTag value={squadValue} />
        </div>
      </div>

      {/* Pitch */}
      <div
        className="relative flex flex-col justify-between gap-5 overflow-hidden rounded-md p-5 ring-1 ring-border"
        style={{
          background:
            "repeating-linear-gradient(to bottom, oklch(0.34 0.07 152) 0 36px, oklch(0.3 0.065 152) 36px 72px)",
        }}
      >
        {/* pitch markings */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />
        <div className="pointer-events-none absolute inset-x-6 top-1/2 h-px -translate-y-1/2 bg-white/15" />
        <div className="pointer-events-none absolute left-1/2 top-3 h-12 w-28 -translate-x-1/2 rounded-b-sm border border-t-0 border-white/15" />
        <div className="pointer-events-none absolute bottom-3 left-1/2 h-12 w-28 -translate-x-1/2 rounded-t-sm border border-b-0 border-white/15" />

        {rows.map((pos) => (
          <div key={pos} className="relative flex justify-around gap-2">
            {Array.from({ length: XI_SLOTS[pos] }).map((_, i) => (
              <Jersey key={`${pos}-${i}`} pos={pos} pl={slots[pos][i]} />
            ))}
          </div>
        ))}
      </div>

      {/* Bench */}
      <div>
        <div className="kicker mb-2">Bench</div>
        <div className="flex justify-around gap-2 rounded-md bg-card/60 p-3 ring-1 ring-border">
          {Array.from({ length: BENCH_SIZE }).map((_, i) => (
            <Jersey key={`bench-${i}`} pl={bench[i]} />
          ))}
        </div>
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
            size={46}
            className="shadow-lg shadow-black/40 ring-2 ring-white/25"
          />
          <span className="absolute -bottom-1 -right-1 grid h-4 min-w-4 place-items-center rounded-sm bg-background px-1 font-display text-[10px] tabular-nums ring-1 ring-border">
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
