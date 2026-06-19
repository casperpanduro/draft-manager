import { SCORING_RULES, SCORING_VERSION } from "@/lib/scoring";
import { cn } from "@/lib/utils";

// Points-rules reference. Rendered straight from SCORING_RULES (the single
// source of truth in scoring.ts), so it can never drift from the actual scoring.
// Used in the season room "Scoring" tab and on the competition page.
export function ScoringRules({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <h3 className="font-display text-xl uppercase leading-none">How points work</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Every point comes from what a player actually did in their match — never
          from rating or luck. A player&apos;s nation plays once per round.
        </p>
      </div>

      <div className="clip-broadcast divide-y divide-border bg-background/40 ring-1 ring-border">
        {SCORING_RULES.map((r) => (
          <div key={r.event} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-display uppercase">{r.event}</span>
              {r.note && (
                <span className="block truncate text-xs text-muted-foreground">{r.note}</span>
              )}
            </span>
            <span className="shrink-0 font-display tabular-nums text-brand">{r.value}</span>
          </div>
        ))}
      </div>

      <p className="text-center text-[0.65rem] text-muted-foreground">
        Scoring v{SCORING_VERSION} · clean-sheet &amp; conceded points need 60+ minutes ·
        shots on target count only non-scoring efforts.
      </p>
    </div>
  );
}
