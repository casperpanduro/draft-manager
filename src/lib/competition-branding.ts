// Branding resolution for a competition. The DB row is the source of truth;
// `competitions.ts` (COMPETITIONS) is only a fallback for the seeded static set.
// Admin-set accent colours are applied as inline CSS-var overrides on top of the
// `[data-theme]` skin, so a competition can deviate from its theme defaults.
import type { CSSProperties } from "react";
import type { Database } from "@/lib/database.types";
import { competitionMeta } from "@/lib/competitions";

type Competition = Database["public"]["Tables"]["competitions"]["Row"];

export type Accent = {
  brand?: string;
  brand2?: string;
  brandForeground?: string;
};

/** DB-first display metadata, falling back to the static COMPETITIONS map. */
export function displayMeta(comp: Pick<Competition, "slug" | "name" | "short" | "tagline" | "theme">) {
  const fb = competitionMeta(comp.slug);
  return {
    name: comp.name || fb.name,
    short: comp.short || fb.short,
    tagline: comp.tagline || fb.tagline,
    theme: comp.theme || fb.theme,
  };
}

/** Inline style applying admin accents to the CREST tokens only — the UI
    chrome stays on the green base for every competition. */
export function accentStyle(accent: Competition["accent"]): CSSProperties {
  const a = (accent ?? {}) as Accent;
  const s: Record<string, string> = {};
  if (a.brand) s["--crest-1"] = a.brand;
  if (a.brand2) s["--crest-2"] = a.brand2;
  if (a.brandForeground) s["--crest-foreground"] = a.brandForeground;
  return s as CSSProperties;
}
