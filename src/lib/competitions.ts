// Presentation metadata for competitions. The DB `competitions` table is the
// source of truth for which exist + are playable; this maps slug → UI bits
// (theme key, gradient label, short tag) used to brand the app.

export type CompetitionMeta = {
  slug: string;
  name: string;
  short: string;
  /** data-theme key in globals.css */
  theme: string;
  tagline: string;
};

export const COMPETITIONS: Record<string, CompetitionMeta> = {
  "world-cup": {
    slug: "world-cup",
    name: "World Cup 2026",
    short: "WC26",
    theme: "world-cup",
    tagline: "The world's game, on home soil.",
  },
  "premier-league": {
    slug: "premier-league",
    name: "Premier League",
    short: "PL",
    theme: "premier-league",
    tagline: "The best league in the world.",
  },
  "serie-a": {
    slug: "serie-a",
    name: "Serie A",
    short: "SA",
    theme: "serie-a",
    tagline: "Calcio, bellezza.",
  },
  "super-league": {
    slug: "super-league",
    name: "Super League",
    short: "SL",
    theme: "super-league",
    tagline: "Every match a final.",
  },
};

export function competitionMeta(slug: string): CompetitionMeta {
  return (
    COMPETITIONS[slug] ?? {
      slug,
      name: slug,
      short: slug.slice(0, 3).toUpperCase(),
      theme: "world-cup",
      tagline: "",
    }
  );
}
