import { cn } from "@/lib/utils";

/**
 * Football-Manager-style quality heat. Every rating in the app is colour-coded
 * on one scale so squad quality reads at a glance — red (weak) → orange → yellow
 * → green (great) → gold (world-class). Calibrated to the live pool (ratings run
 * ~58–95, avg ~70, with 85+ genuinely rare).
 */
export type RatingTier = "elite" | "great" | "good" | "fair" | "weak";

export function ratingTier(r: number): RatingTier {
  if (r >= 85) return "elite";
  if (r >= 79) return "great";
  if (r >= 73) return "good";
  if (r >= 66) return "fair";
  return "weak";
}

const TONE: Record<RatingTier, { text: string; ring: string; bg: string }> = {
  elite: { text: "text-amber-200", ring: "ring-amber-300/50", bg: "bg-amber-300/20" },
  great: { text: "text-emerald-300", ring: "ring-emerald-400/35", bg: "bg-emerald-400/15" },
  good: { text: "text-lime-300", ring: "ring-lime-400/30", bg: "bg-lime-400/15" },
  fair: { text: "text-orange-300", ring: "ring-orange-400/30", bg: "bg-orange-400/12" },
  weak: { text: "text-rose-300", ring: "ring-rose-400/25", bg: "bg-rose-500/12" },
};

/** Full tinted chip (bg + text + ring) — for list rows. */
export function ratingClass(rating: number): string {
  const t = TONE[ratingTier(rating)];
  return cn(t.bg, t.text, t.ring);
}

/** Just text colour — for placing a rating on a custom surface (the pitch). */
export function ratingText(rating: number): string {
  return TONE[ratingTier(rating)].text;
}

/** Just the ring colour. */
export function ratingRing(rating: number): string {
  return TONE[ratingTier(rating)].ring;
}

/**
 * Standalone rating chip. `elite` gets a soft gold glow so world-class players
 * jump off the page like a special card.
 */
export function RatingBadge({
  rating,
  className,
}: {
  rating: number;
  className?: string;
}) {
  const tier = ratingTier(rating);
  return (
    <span
      className={cn(
        "grid min-w-7 place-items-center rounded-sm px-1 py-0.5 font-display text-sm leading-none tabular-nums ring-1",
        ratingClass(rating),
        tier === "elite" && "shadow-[0_0_12px_-3px_var(--color-amber-300)]",
        className,
      )}
    >
      {rating}
    </span>
  );
}
