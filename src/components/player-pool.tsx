"use client";

import { useMemo, useState } from "react";
import { Star, Plus, Search } from "lucide-react";
import { PlayerAvatar } from "@/components/player-avatar";
import { ValueTag } from "@/components/value-tag";
import { RatingBadge } from "@/components/rating-badge";
import { Button } from "@/components/ui/button";
import { type Position, POSITIONS } from "@/lib/draft";
import { cn } from "@/lib/utils";

export type PoolPlayer = {
  id: string;
  name: string;
  position: Position;
  club: string;
  rating: number;
  value: number;
  crest?: string | null;
};

export const POS_TAG: Record<Position, string> = {
  GK: "bg-amber-400/15 text-amber-300 ring-amber-400/30",
  DEF: "bg-sky-400/15 text-sky-300 ring-sky-400/30",
  MID: "bg-emerald-400/15 text-emerald-300 ring-emerald-400/30",
  FWD: "bg-rose-400/15 text-rose-300 ring-rose-400/30",
};

const LIMIT = 150;

/**
 * Browsable player pool: search + position filter, with a per-row queue toggle
 * (shows the player's 1-based queue rank) and an optional Draft action.
 * Drafted players are filtered out. Reused by the lobby and the draft room.
 */
export function PlayerPool({
  players,
  queue,
  draftedIds,
  onToggleQueue,
  onDraft,
  canDraft,
  busy,
}: {
  players: PoolPlayer[];
  queue: string[];
  draftedIds?: Set<string>;
  onToggleQueue: (id: string) => void;
  onDraft?: (id: string) => void;
  canDraft?: (p: PoolPlayer) => boolean;
  busy?: boolean;
}) {
  const [filter, setFilter] = useState<Position | "ALL">("ALL");
  const [q, setQ] = useState("");

  const rankById = useMemo(() => {
    const m = new Map<string, number>();
    queue.forEach((id, i) => m.set(id, i + 1));
    return m;
  }, [queue]);

  const term = q.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      players.filter(
        (p) =>
          !draftedIds?.has(p.id) &&
          (filter === "ALL" || p.position === filter) &&
          (term === "" ||
            p.name.toLowerCase().includes(term) ||
            p.club.toLowerCase().includes(term)),
      ),
    [players, draftedIds, filter, term],
  );

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 rounded-sm bg-card/70 px-3 ring-1 ring-border focus-within:ring-brand/50">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search players or clubs"
          className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="mb-3 flex gap-1.5">
        {(["ALL", ...POSITIONS] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "kicker rounded-sm px-3 py-1.5 ring-1 transition",
              filter === f
                ? "bg-foreground text-background ring-transparent"
                : "ring-border hover:ring-foreground/40",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        {filtered.slice(0, LIMIT).map((p) => {
          const rank = rankById.get(p.id);
          const queued = rank != null;
          const draftable = canDraft?.(p) ?? false;
          return (
            <div
              key={p.id}
              className={cn(
                "flex items-center gap-3 rounded-sm bg-card/60 py-2 pl-2.5 pr-2 ring-1 ring-border",
                queued && "ring-brand/40",
              )}
            >
              <PlayerAvatar
                name={p.name}
                club={p.club}
                position={p.position}
                crest={p.crest}
                size={42}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-base uppercase leading-tight">
                  {p.name}
                </div>
                <div className="truncate text-xs text-muted-foreground">{p.club}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <RatingBadge rating={p.rating} className="min-w-9 px-1.5 py-1 text-lg" />
                <ValueTag value={p.value} />
              </div>

              <button
                onClick={() => onToggleQueue(p.id)}
                aria-label={queued ? "Remove from queue" : "Add to queue"}
                title={queued ? `Queued #${rank}` : "Add to queue"}
                className={cn(
                  "relative grid size-9 shrink-0 place-items-center rounded-sm ring-1 transition",
                  queued
                    ? "bg-brand/15 text-brand ring-brand/40"
                    : "text-muted-foreground ring-border hover:text-foreground hover:ring-foreground/40",
                )}
              >
                {queued ? (
                  <>
                    <Star className="size-4 fill-current" />
                    <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-sm bg-brand px-0.5 font-display text-[9px] leading-none text-brand-foreground tabular-nums">
                      {rank}
                    </span>
                  </>
                ) : (
                  <Plus className="size-4" />
                )}
              </button>

              {onDraft && (
                <Button
                  size="sm"
                  disabled={!draftable || busy}
                  onClick={() => onDraft(p.id)}
                  className="kicker h-9 px-4 disabled:opacity-30"
                >
                  Draft
                </Button>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No players match.
          </p>
        )}
        {filtered.length > LIMIT && (
          <p className="py-3 text-center text-xs text-muted-foreground">
            Showing top {LIMIT} of {filtered.length}. Search or filter to narrow.
          </p>
        )}
      </div>
    </div>
  );
}
