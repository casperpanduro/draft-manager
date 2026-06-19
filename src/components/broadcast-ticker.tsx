import { TeamCrest } from "@/components/team-crest";

/** A ticker entry: either a plain feature string or a structured matchup. */
export type TickerItem =
  | string
  | {
      home: string;
      away: string;
      /** "2–1" once played; omit for an upcoming fixture (renders "v"). */
      score?: string;
      homeLogo?: string;
      awayLogo?: string;
    };

function Entry({ item }: { item: TickerItem }) {
  if (typeof item === "string") {
    return (
      <span className="font-display text-xs uppercase tracking-wide text-foreground/85">
        {item}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 font-display text-xs uppercase tracking-wide text-foreground/85">
      <TeamCrest src={item.homeLogo} name={item.home} size={15} />
      <span>{item.home}</span>
      <span className="text-brand">{item.score ?? "v"}</span>
      <span>{item.away}</span>
      <TeamCrest src={item.awayLogo} name={item.away} size={15} />
    </span>
  );
}

/**
 * Broadcast lower-third ticker — a fixed category flag on the left, then a
 * seamlessly looping strip of items. Pure CSS (no client JS): the track holds
 * two identical copies and translates -50% on loop, so it tiles perfectly.
 * Hovering pauses it. Respects prefers-reduced-motion (animation neutralised in
 * globals.css), in which case it simply shows the static first copy.
 */
export function BroadcastTicker({
  tag,
  items,
}: {
  tag: string;
  items: TickerItem[];
}) {
  if (items.length === 0) return null;
  const loop = [...items, ...items];

  return (
    <div className="relative flex items-stretch overflow-hidden border-y border-border bg-background/50 backdrop-blur-sm">
      {/* Fixed category flag */}
      <div className="z-10 flex shrink-0 items-center gap-2 bg-brand px-4 text-brand-foreground">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-2 animate-ping rounded-full bg-brand-foreground/70" />
          <span className="relative inline-flex size-2 rounded-full bg-brand-foreground" />
        </span>
        <span className="font-display text-xs uppercase tracking-[0.15em]">
          {tag}
        </span>
      </div>

      {/* Scrolling track */}
      <div className="ticker-mask relative flex-1 overflow-hidden">
        <ul className="animate-ticker flex w-max items-center">
          {loop.map((item, i) => (
            <li
              key={i}
              aria-hidden={i >= items.length}
              className="flex items-center whitespace-nowrap"
            >
              <span className="mx-4 size-1 rounded-full bg-brand/70" />
              <Entry item={item} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
