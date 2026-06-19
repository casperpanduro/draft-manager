/**
 * Full-page competition art backdrop. Renders the competition photo (or the
 * default pitch texture) as fixed, atmospheric background behind page content.
 *
 * Two variants:
 *  - "content" (draft / lobby / season): the photo is desaturated + dimmed to a
 *    pure texture and held under an even, dark scrim so dense foreground content
 *    always reads. A soft brand glow at the top keeps it from feeling flat.
 *  - "hero" (competition landing): the photo stays photo-forward as the feature,
 *    with a vignette and a deep bottom fade so the content below it still reads.
 */
export function CompetitionBackdrop({
  bg,
  variant = "content",
}: {
  bg?: string | null;
  variant?: "content" | "hero";
}) {
  const isHero = variant === "hero";

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* Brand wash */}
      <div
        className="absolute inset-0"
        style={{ background: "var(--brand-gradient)", opacity: isHero ? 0.3 : 0.22 }}
      />

      {/* Photo (desaturated + dimmed to texture) or default pitch */}
      {bg ? (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url(${bg})`,
            filter: isHero
              ? "grayscale(0.15) brightness(0.85) contrast(1.05)"
              : "grayscale(0.55) brightness(0.6) contrast(1.05)",
          }}
        />
      ) : (
        <div className="bg-pitch absolute inset-0 opacity-70" />
      )}

      {/* Film grain */}
      <div className="bg-grain absolute inset-0 opacity-[0.08] mix-blend-overlay" />

      {/* Readability scrim — even & dark for content, photo-forward for hero */}
      <div
        className={
          isHero
            ? "absolute inset-0 bg-gradient-to-b from-background/70 via-background/35 to-background/95"
            : "absolute inset-0 bg-gradient-to-b from-background/88 via-background/82 to-background/94"
        }
      />

      {/* Brand glow behind the top hero */}
      <div
        className="absolute inset-x-0 top-0 h-72"
        style={{
          background:
            "radial-gradient(75% 100% at 50% 0%, var(--brand-glow), transparent 72%)",
        }}
      />

      {/* Corner vignette for depth */}
      <div className="bg-vignette absolute inset-0" />
    </div>
  );
}
