"use client";

import { Reorder, useDragControls } from "motion/react";
import { GripVertical, X } from "lucide-react";
import { PlayerAvatar } from "@/components/player-avatar";
import { ValueTag } from "@/components/value-tag";
import { RatingBadge } from "@/components/rating-badge";
import { Button } from "@/components/ui/button";
import { type PoolPlayer } from "@/components/player-pool";
import { cn } from "@/lib/utils";

/**
 * The manager's ordered draft queue. Drag to reorder (motion Reorder, touch-
 * friendly), ✕ to remove. Drafted players are dimmed/struck but kept in place.
 * When `onPick` is supplied (live draft room), the top still-available player
 * gets a one-tap Pick action while it's the manager's turn.
 */
export function QueuePanel({
  queue,
  playerById,
  draftedIds,
  onReorder,
  onRemove,
  onPick,
  canPick,
  myTurn,
  busy,
}: {
  queue: string[];
  playerById: Map<string, PoolPlayer>;
  draftedIds?: Set<string>;
  onReorder: (ids: string[]) => void;
  onRemove: (id: string) => void;
  onPick?: (id: string) => void;
  canPick?: (p: PoolPlayer) => boolean;
  myTurn?: boolean;
  busy?: boolean;
}) {
  const items = queue.filter((id) => playerById.has(id));
  const topAvailable = items.find((id) => !draftedIds?.has(id));

  if (items.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-border bg-card/40 py-12 text-center">
        <p className="text-sm text-muted-foreground">Your queue is empty.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Add players from the Players tab to plan your draft.
        </p>
      </div>
    );
  }

  return (
    <Reorder.Group axis="y" values={items} onReorder={onReorder} className="space-y-1.5">
      {items.map((id, i) => {
        const pl = playerById.get(id)!;
        const drafted = draftedIds?.has(id) ?? false;
        const isNext = id === topAvailable;
        return (
          <QueueRow
            key={id}
            id={id}
            pl={pl}
            rank={i + 1}
            drafted={drafted}
            isNext={isNext}
            onRemove={onRemove}
            onPick={onPick}
            pickable={Boolean(myTurn) && !drafted && (canPick?.(pl) ?? false)}
            busy={busy}
          />
        );
      })}
    </Reorder.Group>
  );
}

function QueueRow({
  id,
  pl,
  rank,
  drafted,
  isNext,
  onRemove,
  onPick,
  pickable,
  busy,
}: {
  id: string;
  pl: PoolPlayer;
  rank: number;
  drafted: boolean;
  isNext: boolean;
  onRemove: (id: string) => void;
  onPick?: (id: string) => void;
  pickable: boolean;
  busy?: boolean;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={id}
      dragListener={false}
      dragControls={controls}
      className={cn(
        "flex items-center gap-2.5 rounded-sm bg-card/60 py-2 pl-1.5 pr-2 ring-1 ring-border",
        isNext && "ring-brand/50",
        drafted && "opacity-45",
      )}
    >
      <button
        onPointerDown={(e) => controls.start(e)}
        aria-label="Drag to reorder"
        className="shrink-0 cursor-grab touch-none p-1 text-muted-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <span className="grid size-6 shrink-0 place-items-center rounded-sm bg-muted font-display text-xs tabular-nums text-muted-foreground">
        {rank}
      </span>
      <PlayerAvatar
        name={pl.name}
        club={pl.club}
        position={pl.position}
        crest={pl.crest}
        size={34}
      />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate font-display text-sm uppercase leading-tight",
            drafted && "line-through",
          )}
        >
          {pl.name}
        </div>
        <div className="truncate text-xs text-muted-foreground">{pl.club}</div>
      </div>
      <RatingBadge rating={pl.rating} />
      <ValueTag value={pl.value} className="hidden sm:inline-flex" />
      {pickable && onPick ? (
        <Button
          size="sm"
          disabled={busy}
          onClick={() => onPick(id)}
          className="kicker h-8 px-3"
        >
          Pick
        </Button>
      ) : (
        <button
          onClick={() => onRemove(id)}
          aria-label="Remove from queue"
          className="grid size-8 shrink-0 place-items-center rounded-sm text-muted-foreground ring-1 ring-border transition hover:text-destructive hover:ring-destructive/40"
        >
          <X className="size-4" />
        </button>
      )}
    </Reorder.Item>
  );
}
