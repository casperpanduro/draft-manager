import { cn } from "@/lib/utils";

/**
 * Small team/nation crest. Renders nothing when no logo is available so callers
 * fall back cleanly to a name-only matchup. Plain <img> on purpose: these are
 * tiny remote PNGs from the data provider, not worth the next/image pipeline.
 */
export function TeamCrest({
  src,
  name,
  size = 16,
  className,
}: {
  src?: string | null;
  name: string;
  size?: number;
  className?: string;
}) {
  if (!src) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-label={`${name} crest`}
      loading="lazy"
      width={size}
      height={size}
      style={{ width: size, height: size }}
      className={cn(
        "inline-block shrink-0 object-contain drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]",
        className,
      )}
    />
  );
}
