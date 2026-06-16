import type { CSSProperties } from "react";
import Link from "next/link";
import { competitionMeta } from "@/lib/competitions";
import { accentStyle } from "@/lib/competition-branding";
import { CompetitionCrest } from "@/components/competition-crest";
import { cn } from "@/lib/utils";

export type CompetitionCardData = {
  slug: string;
  name: string;
  playable: boolean;
  /** number of the user's leagues in this competition (0 = not joined) */
  joined: number;
  /** any of the user's leagues here currently drafting */
  live: boolean;
  /** resolved background image, or null to fall back to the CSS skin */
  bg: string | null;
  /** DB accent overrides — applied to the crest tokens only */
  accent: Parameters<typeof accentStyle>[0];
};

export function CompetitionCard({
  comp,
  index = 0,
}: {
  comp: CompetitionCardData;
  index?: number;
}) {
  const meta = competitionMeta(comp.slug);
  const joined = comp.joined > 0;

  const inner = (
    <article
      className={cn(
        "clip-broadcast group relative flex aspect-[4/5] flex-col justify-end overflow-hidden ring-1 transition-all",
        comp.playable
          ? "ring-border group-hover:ring-brand/60"
          : "ring-border/60",
      )}
    >
      {/* Branded fill: theme gradient + pitch texture, real image on top if present */}
      <div
        className="absolute inset-0"
        style={{ background: "var(--brand-gradient)", opacity: 0.5 }}
      />
      <div className="bg-pitch absolute inset-0 opacity-60" />
      <div className="bg-grain absolute inset-0 opacity-[0.1] mix-blend-overlay" />
      {comp.bg && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${comp.bg})` }}
        />
      )}
      {/* Crest, floated top-left */}
      <CompetitionCrest
        short={meta.short}
        className="absolute left-4 top-4 h-14 w-auto drop-shadow-lg"
      />
      {!comp.playable && (
        <span className="kicker absolute right-3 top-4 rounded-sm bg-black/45 px-2 py-1 text-[0.6rem] text-foreground/80 backdrop-blur-sm">
          Coming soon
        </span>
      )}

      {/* Dark branded panel at the bottom — the "card in the middle" feel */}
      <div className="relative mt-auto bg-gradient-to-t from-background via-background/92 to-transparent px-4 pb-4 pt-12">
        <div className="kicker text-foreground/60">{meta.short}</div>
        <h3 className="font-display text-xl uppercase leading-none">
          {comp.name}
        </h3>
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          {joined ? (
            <>
              <span className="size-1.5 rounded-full bg-brand" />
              <span className="kicker text-brand">Joined</span>
              {comp.joined > 1 && (
                <span className="text-muted-foreground">
                  · {comp.joined} leagues
                </span>
              )}
              {comp.live && (
                <span className="ml-1 flex items-center gap-1">
                  <span className="size-1.5 animate-[pulse-danger_1.2s_ease-in-out_infinite] rounded-full bg-destructive" />
                  <span className="kicker text-destructive">Live</span>
                </span>
              )}
            </>
          ) : comp.playable ? (
            <span className="kicker text-muted-foreground">Tap to enter</span>
          ) : (
            <span className="kicker text-muted-foreground">Not yet open</span>
          )}
        </div>
      </div>
    </article>
  );

  const wrapClass = "animate-rise block";
  const style: CSSProperties = {
    ...accentStyle(comp.accent),
    animationDelay: `${index * 60}ms`,
  };

  if (!comp.playable) {
    return (
      <div
        data-theme={meta.theme}
        className={cn(
          wrapClass,
          "cursor-not-allowed opacity-45 grayscale-[0.85] saturate-50",
        )}
        style={style}
        aria-disabled
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      href={`/competition/${comp.slug}`}
      data-theme={meta.theme}
      className={cn(wrapClass, "group")}
      style={style}
    >
      {inner}
    </Link>
  );
}
