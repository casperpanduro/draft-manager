import { cn } from "@/lib/utils";

/** Coins formatted compactly: 1480 → 1.5k. */
export const fmtCoins = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);

export function Coin({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn("size-3", className)}>
      <circle cx="8" cy="8" r="7" className="fill-current opacity-25" />
      <circle cx="8" cy="8" r="7" className="fill-none stroke-current" strokeWidth="1.4" />
      <path
        d="M8 4.2v7.6M6 6.1h3a1.6 1.6 0 010 3.2H6.4"
        className="fill-none stroke-current"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Value pill (a player's transfer value, in coins). Kept deliberately quiet —
 * money is secondary to the colour-coded rating, so it reads as a muted gold
 * coin rather than competing with the brand accent.
 */
export function ValueTag({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm bg-amber-200/[0.07] px-1.5 py-0.5 font-display text-[11px] leading-none tabular-nums text-amber-200/75 ring-1 ring-amber-200/15",
        className,
      )}
    >
      <Coin />
      {fmtCoins(value)}
    </span>
  );
}
