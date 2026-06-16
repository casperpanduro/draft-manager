// Procedural broadcast crest — a shield filled with the theme gradient and
// stamped with the competition's short code (WC26, PL…). Stands in for a real
// logo until art is supplied; tints per `data-theme` via the brand tokens.

export function CompetitionCrest({
  short,
  className,
}: {
  short: string;
  className?: string;
}) {
  const id = `crest-${short.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg
      viewBox="0 0 100 120"
      className={className}
      role="img"
      aria-label={short}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--crest-1)" />
          <stop offset="100%" stopColor="var(--crest-2)" />
        </linearGradient>
      </defs>
      <path
        d="M50 3 L94 16 V56 Q94 95 50 117 Q6 95 6 56 V16 Z"
        fill={`url(#${id})`}
        stroke="oklch(1 0 0 / 0.25)"
        strokeWidth="2"
      />
      <path
        d="M50 3 L94 16 V56 Q94 95 50 117 Q6 95 6 56 V16 Z"
        fill="none"
        stroke="oklch(0 0 0 / 0.2)"
        strokeWidth="2"
        transform="translate(0 2) scale(0.92) translate(4.3 0)"
        opacity="0.4"
      />
      <text
        x="50"
        y="68"
        textAnchor="middle"
        textLength="62"
        lengthAdjust="spacingAndGlyphs"
        fontFamily="var(--font-display)"
        fontSize="34"
        fill="var(--crest-foreground)"
        style={{ textTransform: "uppercase" }}
      >
        {short}
      </text>
    </svg>
  );
}
