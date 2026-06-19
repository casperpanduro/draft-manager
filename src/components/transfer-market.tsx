"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlayerAvatar } from "@/components/player-avatar";
import { ValueTag, fmtCoins, Coin } from "@/components/value-tag";
import { RatingBadge, ratingText } from "@/components/rating-badge";
import { cn } from "@/lib/utils";
import { type Position } from "@/lib/draft";
import { type ViewPlayer } from "@/components/season-room";

export function TransferMarket({
  squad,
  freeAgents,
  budget,
  freeLeft,
  transferFee,
  locked,
  busy,
  onTransfer,
}: {
  squad: ViewPlayer[];
  freeAgents: ViewPlayer[];
  budget: number;
  freeLeft: number;
  transferFee: number;
  locked: boolean;
  busy: boolean;
  onTransfer: (outId: string, inId: string) => Promise<boolean>;
}) {
  const [outId, setOutId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const out = outId ? squad.find((p) => p.id === outId) ?? null : null;
  const fee = freeLeft > 0 ? 0 : transferFee;
  const tooPoor = fee > budget;

  // Same-position free agents keep the formation valid by construction.
  const candidates = useMemo(() => {
    if (!out) return [];
    const q = query.trim().toLowerCase();
    return freeAgents
      .filter((p) => p.position === out.position)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.club.toLowerCase().includes(q))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 60);
  }, [out, freeAgents, query]);

  if (locked) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        This round has been played — transfers are closed until the next round
        opens.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm bg-card/60 px-4 py-3 ring-1 ring-border">
        <span className="inline-flex items-center gap-1.5 font-display text-lg tabular-nums text-amber-300">
          <Coin /> {fmtCoins(budget)}
        </span>
        <span className="kicker text-muted-foreground">
          {freeLeft > 0 ? (
            <span className="text-brand">{freeLeft} free</span>
          ) : (
            <>
              fee <span className="text-foreground">{transferFee}</span>/transfer
            </>
          )}{" "}
          this round
        </span>
      </div>

      {/* Step 1 — pick who to drop */}
      <div>
        <h3 className="kicker mb-2 text-foreground">1 · Drop a player</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[...squad]
            .sort((a, b) => a.position.localeCompare(b.position) || b.rating - a.rating)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setOutId(p.id === outId ? null : p.id)}
                className={cn(
                  "flex items-center gap-2 rounded-sm bg-card/60 p-2 text-left ring-1 transition",
                  p.id === outId ? "ring-brand bg-brand/10" : "ring-border hover:bg-card",
                )}
              >
                <PlayerAvatar
                  name={p.name}
                  club={p.club}
                  position={p.position}
                  crest={p.crest}
                  size={32}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium">{p.name}</span>
                  <span className="kicker text-[0.6rem] text-muted-foreground">
                    {p.club} ·{" "}
                    <span className={cn("font-display", ratingText(p.rating))}>
                      {p.rating}
                    </span>
                  </span>
                </span>
              </button>
            ))}
        </div>
      </div>

      {/* Step 2 — sign a free agent */}
      {out && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="kicker text-foreground">
              2 · Sign a {posLabel(out.position)}
            </h3>
            <span className="kicker text-muted-foreground">
              for {out.name}
            </span>
          </div>
          <Input
            placeholder="Search free agents…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-2 h-10"
          />
          {tooPoor && (
            <p className="mb-2 text-xs text-destructive">
              Not enough budget for the {transferFee}-coin fee.
            </p>
          )}
          <div className="clip-broadcast max-h-[22rem] divide-y divide-border overflow-y-auto bg-background/40 ring-1 ring-border">
            {candidates.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                No free agents match.
              </p>
            )}
            {candidates.map((p) => (
              <div key={p.id} className="flex items-center gap-2.5 px-3 py-2.5">
                <PlayerAvatar
                  name={p.name}
                  club={p.club}
                  position={p.position}
                  crest={p.crest}
                  size={34}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.club}
                  </span>
                </span>
                <RatingBadge rating={p.rating} />
                <ValueTag value={p.value} />
                <Button
                  size="sm"
                  disabled={busy || tooPoor}
                  onClick={async () => {
                    const ok = await onTransfer(out.id, p.id);
                    if (ok) {
                      setOutId(null);
                      setQuery("");
                    }
                  }}
                  className="h-8 font-display text-xs uppercase"
                >
                  {fee > 0 ? `Sign · ${fee}` : "Sign"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!out && (
        <p className="text-center text-xs text-muted-foreground">
          Pick a player to drop, then choose a free agent in the same position.
        </p>
      )}
    </div>
  );
}

function posLabel(p: Position): string {
  return { GK: "goalkeeper", DEF: "defender", MID: "midfielder", FWD: "forward" }[p];
}
