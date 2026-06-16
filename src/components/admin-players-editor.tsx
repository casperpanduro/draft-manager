"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updatePlayerAction } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Player = {
  id: string;
  name: string;
  club: string;
  position: string | null;
  rating: number;
};

export function PlayersEditor({
  players,
  positionOptions,
}: {
  players: Player[];
  positionOptions: string[];
}) {
  if (players.length === 0) {
    return <p className="text-sm text-muted-foreground">No players.</p>;
  }
  return (
    <div className="divide-y divide-border rounded-lg ring-1 ring-border">
      {players.map((p) => (
        <PlayerRow key={p.id} player={p} positionOptions={positionOptions} />
      ))}
    </div>
  );
}

function PlayerRow({
  player,
  positionOptions,
}: {
  player: Player;
  positionOptions: string[];
}) {
  const router = useRouter();
  const [rating, setRating] = useState(String(player.rating));
  const [position, setPosition] = useState(player.position ?? "");
  const [saving, setSaving] = useState(false);

  const dirty =
    Number(rating) !== player.rating || (position || null) !== (player.position ?? null);

  async function save() {
    setSaving(true);
    const r = await updatePlayerAction(player.id, Number(rating), position || null);
    setSaving(false);
    if (r.error) toast.error(r.error);
    else {
      toast.success(`${player.name} updated`);
      router.refresh();
    }
  }

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="truncate font-medium">{player.name}</div>
        <div className="truncate text-xs text-muted-foreground">{player.club}</div>
      </div>

      {positionOptions.length > 0 ? (
        <select
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring"
        >
          <option value="">—</option>
          {positionOptions.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      ) : (
        <span />
      )}

      <input
        type="number"
        min={1}
        max={99}
        value={rating}
        onChange={(e) => setRating(e.target.value)}
        className="h-8 w-16 rounded-lg border border-input bg-transparent px-2 text-center font-display tabular-nums outline-none focus-visible:border-ring"
      />

      <Button
        size="sm"
        variant={dirty ? "default" : "outline"}
        onClick={save}
        disabled={!dirty || saving}
      >
        {saving ? "…" : "Save"}
      </Button>
    </div>
  );
}
