import type { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import type { TickerItem } from "@/components/broadcast-ticker";
import { getCrestMap, crestFor, type CrestMap } from "@/lib/crests";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type EventRow = Pick<
  Database["public"]["Tables"]["events"]["Row"],
  "label" | "starts_at" | "status" | "result"
>;

type FixtureResult = {
  home?: { name?: string | null; goals?: number | null };
  away?: { name?: string | null; goals?: number | null };
};

const FINISHED = new Set(["FT", "AET", "PEN"]);

// Static fallback when no fixtures are available (fresh DB, or a sport without
// a fixture catalog). Keeps the ticker populated rather than hidden.
const FALLBACK_ITEMS: TickerItem[] = [
  "Live snake draft",
  "2–20 managers",
  "60-second pick clock",
  "Randomised round-1 order",
  "Auto-pick covers no-shows",
];

/** A fixture counts as played once it's finished and carries both scores. */
function isPlayed(e: EventRow): boolean {
  const r = (e.result ?? {}) as FixtureResult;
  return (
    FINISHED.has(e.status ?? "") &&
    r.home?.goals != null &&
    r.away?.goals != null &&
    !!r.home?.name &&
    !!r.away?.name
  );
}

/** Turn an event into a structured matchup, attaching crests by team name. */
function toItem(e: EventRow, crests: CrestMap): TickerItem {
  const r = (e.result ?? {}) as FixtureResult;
  let home: string;
  let away: string;
  let score: string | undefined;

  if (isPlayed(e)) {
    home = r.home!.name!;
    away = r.away!.name!;
    score = `${r.home!.goals}–${r.away!.goals}`;
  } else {
    const [h, a] = e.label.split(" vs ");
    home = (r.home?.name ?? h ?? "").trim();
    away = (r.away?.name ?? a ?? "").trim();
    if (!home || !away) return e.label; // unparseable → plain string
  }

  return {
    home,
    away,
    score,
    homeLogo: crestFor(crests, home),
    awayLogo: crestFor(crests, away),
  };
}

function toItems(events: EventRow[], crests: CrestMap): TickerItem[] {
  return events.map((e) => toItem(e, crests));
}

/**
 * Ticker payload for the landing / dashboard: the playable competition's name as
 * the flag, its fixtures as the strip — recent results (with scores + crests)
 * first, then the soonest upcoming. Falls back to feature highlights when no
 * fixtures exist.
 */
export async function getTickerData(
  supabase: SupabaseServerClient,
): Promise<{ tag: string; items: TickerItem[] }> {
  const { data: comp } = await supabase
    .from("competitions")
    .select("id, name")
    .eq("playable", true)
    .order("sort")
    .limit(1)
    .maybeSingle();

  if (!comp) return { tag: "On the slate", items: FALLBACK_ITEMS };

  const crests = await getCrestMap(supabase, comp.id);
  const cols = "label, starts_at, status, result";

  // Lead with recent results (they carry scores — the broadcast money shot).
  const { data: playedRows } = await supabase
    .from("events")
    .select(cols)
    .eq("competition_id", comp.id)
    .in("status", [...FINISHED])
    .order("starts_at", { ascending: false })
    .limit(24);

  let items = toItems((playedRows ?? []).filter(isPlayed), crests);

  // Top up with the soonest upcoming fixtures if results are sparse.
  if (items.length < 8) {
    const { data: nextRows } = await supabase
      .from("events")
      .select(cols)
      .eq("competition_id", comp.id)
      .not("status", "in", `(${[...FINISHED].join(",")})`)
      .order("starts_at", { ascending: true })
      .limit(16);
    items = [...items, ...toItems(nextRows ?? [], crests)];
  }

  items = items.slice(0, 24);
  return { tag: comp.name, items: items.length ? items : FALLBACK_ITEMS };
}
