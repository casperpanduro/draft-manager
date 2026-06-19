import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** Crest lookup keyed by normalised team name. */
export type CrestMap = Record<string, string>;

const norm = (name: string) => name.trim().toLowerCase();

export function crestFor(crests: CrestMap, name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  return crests[norm(name)];
}

/**
 * Build a team-name → logo_url map for a competition's clubs (real-world teams /
 * nations). Event matchup names match club names exactly, so a normalised-name
 * lookup resolves every crest. Returns an empty map on error so callers degrade
 * to name-only matchups.
 */
export async function getCrestMap(
  supabase: SupabaseServerClient,
  competitionId: string,
): Promise<CrestMap> {
  const { data } = await supabase
    .from("clubs")
    .select("name, logo_url")
    .eq("competition_id", competitionId);

  const map: CrestMap = {};
  for (const c of data ?? []) {
    if (c.logo_url) map[norm(c.name)] = c.logo_url;
  }
  return map;
}
