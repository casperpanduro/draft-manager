"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { startDraftAction, kickTeamAction } from "@/app/actions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Container } from "@/components/container";
import { PlayerPool, type PoolPlayer } from "@/components/player-pool";
import { QueuePanel } from "@/components/queue-panel";
import { useDraftQueue } from "@/components/use-draft-queue";
import { ROSTER_SIZE, TOTAL_ROUNDS } from "@/lib/draft";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Team = {
  id: string;
  name: string;
  user_id: string;
  profile: { display_name: string } | null;
};

export function LobbyClient({
  leagueId,
  joinCode,
  commissionerId,
  currentUserId,
  initialTeams,
  players,
  initialQueue,
}: {
  leagueId: string;
  joinCode: string;
  commissionerId: string;
  currentUserId: string;
  initialTeams: Team[];
  players: PoolPlayer[];
  initialQueue: string[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [pending, startTransition] = useTransition();

  const { queue, reorder, toggle, remove } = useDraftQueue(leagueId, initialQueue);
  const playerById = useMemo(
    () => new Map(players.map((p) => [p.id, p])),
    [players],
  );

  const isCommissioner = currentUserId === commissionerId;

  const refetchTeams = useCallback(async () => {
    const { data } = await supabase
      .from("teams")
      .select("id, name, user_id, profile:profiles(display_name)")
      .eq("league_id", leagueId)
      .order("created_at");
    if (data) setTeams(data as Team[]);
  }, [supabase, leagueId]);

  useEffect(() => {
    const channel = supabase
      .channel(`lobby:${leagueId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "teams",
          filter: `league_id=eq.${leagueId}`,
        },
        () => refetchTeams(),
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
          if ((payload.new as { status: string }).status === "drafting") {
            router.push(`/league/${leagueId}/draft`);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, leagueId, refetchTeams, router]);

  function copyCode() {
    navigator.clipboard.writeText(joinCode);
    toast.success("Invite code copied");
  }

  function handleStart() {
    startTransition(async () => {
      const res = await startDraftAction(leagueId);
      if (res?.error) toast.error(res.error);
    });
  }

  function handleKick(teamId: string) {
    startTransition(async () => {
      const res = await kickTeamAction(leagueId, teamId);
      if (res?.error) toast.error(res.error);
    });
  }

  return (
    <Container as="div" className="relative flex-1 px-5 pb-28">
      <div className="clip-broadcast bg-pitch animate-rise p-3 shadow-2xl shadow-black/40 ring-1 ring-border sm:p-4">
        <Tabs defaultValue="lobby" className="flex flex-1 flex-col">
        <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-sm bg-card/70 p-1 ring-1 ring-border backdrop-blur group-data-horizontal/tabs:h-auto">
          {[
            ["lobby", "Lobby"],
            ["players", "Players"],
            ["queue", `Queue${queue.length ? ` · ${queue.length}` : ""}`],
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

        {/* ── Lobby ── */}
        <TabsContent value="lobby" className="mt-4">
          <div className="clip-broadcast accent-bar relative flex items-end justify-between gap-4 bg-card/60 p-5 pl-6 ring-1 ring-border backdrop-blur">
            <div>
              <div className="kicker">Invite code</div>
              <div className="font-display text-4xl uppercase tracking-[0.18em] text-brand">
                {joinCode}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Share this to call up your managers.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={copyCode}
              className="kicker shrink-0 border-brand/40 text-foreground hover:bg-brand hover:text-brand-foreground"
            >
              Copy
            </Button>
          </div>

          <div className="mb-3 mt-6 flex items-center justify-between">
            <h2 className="kicker text-foreground">Managers · {teams.length}</h2>
            <span className="kicker">
              {ROSTER_SIZE} players · {TOTAL_ROUNDS} rounds
            </span>
          </div>

          <div className="space-y-1.5">
            {teams.map((t, i) => {
              const isMe = t.user_id === currentUserId;
              const isComm = t.user_id === commissionerId;
              return (
                <div
                  key={t.id}
                  className={cn(
                    "flex items-center gap-4 rounded-sm bg-card/60 py-3 pl-3 pr-4 ring-1 ring-border backdrop-blur",
                    isMe && "ring-brand/50",
                  )}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-sm bg-muted font-display text-base tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-base uppercase leading-tight">
                      {t.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t.profile?.display_name ?? "Manager"}
                      {isComm && " · Commissioner"}
                    </div>
                  </div>
                  {isMe && <span className="kicker text-brand">You</span>}
                  {isCommissioner && !isComm && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => handleKick(t.id)}
                      className="kicker text-destructive hover:bg-destructive/10"
                    >
                      Drop
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </TabsContent>

        {/* ── Players ── */}
        <TabsContent value="players" className="mt-4">
          <p className="mb-3 text-xs text-muted-foreground">
            Scout the pool and tap ＋ to build your draft queue. Auto-pick will
            follow your order if your clock runs out.
          </p>
          <PlayerPool players={players} queue={queue} onToggleQueue={toggle} />
        </TabsContent>

        {/* ── Queue ── */}
        <TabsContent value="queue" className="mt-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="kicker text-foreground">Your priorities · {queue.length}</h2>
            <span className="kicker">Drag to reorder</span>
          </div>
          <QueuePanel
            queue={queue}
            playerById={playerById}
            onReorder={reorder}
            onRemove={remove}
          />
        </TabsContent>
        </Tabs>
      </div>

      {/* Start CTA — pinned across tabs */}
      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/85 backdrop-blur-md">
        <Container className="px-5 py-4">
          {isCommissioner ? (
            <Button
              className="sheen h-13 w-full font-display text-base uppercase tracking-wider"
              disabled={pending || teams.length < 2}
              onClick={handleStart}
            >
              {teams.length < 2
                ? "Need at least 2 managers"
                : pending
                  ? "Starting…"
                  : `Start draft · ${teams.length} managers`}
            </Button>
          ) : (
            <p className="flex items-center justify-center gap-2 text-center text-sm text-muted-foreground">
              <span className="size-2 animate-[pulse-danger_1.2s_ease-in-out_infinite] rounded-full bg-brand" />
              Waiting for the commissioner to start the draft…
            </p>
          )}
        </Container>
      </div>
    </Container>
  );
}
